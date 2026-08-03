/**
 * Mongo-backed LoanBook and ReceiptStore.
 *
 * Same interfaces the keeper already targets, so swapping the file-backed
 * implementation for this one is a one-line change in the keeper's wiring.
 */

import { collections } from "./client.ts";
import type { InstallmentDoc, LoanDoc } from "./schema.ts";

export type BookLoan = {
  loanId: string;
  borrower: string;
  merchantId?: string;
  liquidationCandidate?: boolean;
  installments: Array<{
    index: number;
    dueAt: string;
    amountRaw: string;
    amountDisplay: string;
    state: string;
    attempts: number;
    nextAttemptAt?: string;
    lastFailureKind?: string;
  }>;
};

function toBookLoan(doc: LoanDoc): BookLoan {
  return {
    loanId: doc.loanId,
    borrower: doc.borrower,
    merchantId: doc.merchantId,
    liquidationCandidate: doc.liquidationCandidate,
    installments: doc.installments.map((i) => ({
      index: i.index,
      dueAt: i.dueAt.toISOString(),
      amountRaw: i.amountRaw,
      amountDisplay: i.amountDisplay,
      state: i.state,
      attempts: i.attempts,
      nextAttemptAt: i.nextAttemptAt?.toISOString(),
      lastFailureKind: i.lastFailureKind,
    })),
  };
}

export class MongoLoanBook {
  async dueInstallments(
    now: Date
  ): Promise<Array<{ loan: BookLoan; installment: BookLoan["installments"][number] }>> {
    const { loans } = await collections();

    // Filter on the server: an elemMatch narrows to loans with at least one
    // collectable installment, so we never pull the whole active book into
    // memory just to discard most of it.
    const docs = await loans
      .find({
        status: "active",
        installments: {
          $elemMatch: {
            state: { $in: ["scheduled", "dunning"] },
            dueAt: { $lte: now },
          },
        },
      })
      .toArray();

    const out: Array<{ loan: BookLoan; installment: BookLoan["installments"][number] }> = [];
    for (const doc of docs) {
      const loan = toBookLoan(doc);
      for (const inst of loan.installments) {
        if (inst.state !== "scheduled" && inst.state !== "dunning") continue;
        if (new Date(inst.dueAt) > now) continue;
        // Honour the dunning back-off. This cannot be pushed into the query
        // above because elemMatch already selected the loan, not the element.
        if (inst.nextAttemptAt && new Date(inst.nextAttemptAt) > now) continue;
        out.push({ loan, installment: inst });
      }
    }
    return out;
  }

  async liquidationCandidates(): Promise<BookLoan[]> {
    const { loans } = await collections();
    const docs = await loans
      .find({ liquidationCandidate: true, status: "active" })
      .toArray();
    return docs.map(toBookLoan);
  }

  async recordAttempt(
    loanId: string,
    index: number,
    patch: Partial<{
      state: string;
      attempts: number;
      nextAttemptAt?: string;
      lastFailureKind?: string;
      transactionHash?: string;
    }>
  ): Promise<void> {
    const { loans } = await collections();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const unset: Record<string, ""> = {};

    for (const [key, value] of Object.entries(patch)) {
      const path = `installments.$[el].${key}`;
      if (value === undefined) {
        unset[path] = "";
        continue;
      }
      set[path] =
        key === "nextAttemptAt" ? new Date(value as string) : value;
    }
    if (patch.state === "paid") {
      set["installments.$[el].paidAt"] = new Date();
    }

    await loans.updateOne(
      { loanId },
      Object.keys(unset).length > 0 ? { $set: set, $unset: unset } : { $set: set },
      { arrayFilters: [{ "el.index": index }] }
    );
  }

  async markLiquidationCandidate(loanId: string): Promise<void> {
    const { loans } = await collections();
    await loans.updateOne(
      { loanId },
      { $set: { liquidationCandidate: true, updatedAt: new Date() } }
    );
  }

  async all(): Promise<BookLoan[]> {
    const { loans } = await collections();
    return (await loans.find({}).toArray()).map(toBookLoan);
  }
}

export class MongoReceiptStore {
  async put(receipt: Record<string, unknown>): Promise<void> {
    const { receipts } = await collections();
    // Upsert on (actionId, attempt): the keeper may write the same receipt
    // twice if a pass is interrupted after execution but before the write, and
    // a duplicate row would corrupt the reconciliation totals.
    await receipts.updateOne(
      { actionId: receipt.actionId as string, attempt: receipt.attempt as number },
      { $set: { ...receipt, createdAt: new Date(receipt.createdAt as string) } },
      { upsert: true }
    );
  }

  async list(filter: { loanId?: string; kind?: string } = {}): Promise<unknown[]> {
    const { receipts } = await collections();
    const query: Record<string, unknown> = {};
    if (filter.loanId) query.loanId = filter.loanId;
    if (filter.kind) query.kind = filter.kind;
    return await receipts.find(query).sort({ createdAt: -1 }).limit(500).toArray();
  }
}

/** Append to the audit log. Never updated, never deleted. */
export async function recordEvent(event: {
  type: string;
  loanId?: string;
  merchantId?: string;
  borrower?: string;
  payload?: Record<string, unknown>;
  chainId: number;
  transactionHash?: string;
  blockNumber?: number;
}): Promise<void> {
  const { events } = await collections();
  await events.insertOne({
    ...event,
    payload: event.payload ?? {},
    createdAt: new Date(),
  });
}

/** Build the installment schedule for a new plan. */
export function buildInstallments(params: {
  totalOwedRaw: bigint;
  count: number;
  intervalSeconds: number;
  startAt: Date;
  decimals?: number;
  symbol?: string;
}): InstallmentDoc[] {
  const decimals = params.decimals ?? 6;
  const symbol = params.symbol ?? "USDC";
  const per = params.totalOwedRaw / BigInt(params.count);
  // The final installment absorbs the rounding remainder so the sum is exact.
  const remainder = params.totalOwedRaw - per * BigInt(params.count);

  const out: InstallmentDoc[] = [];
  for (let i = 0; i < params.count; i++) {
    const amount = i === params.count - 1 ? per + remainder : per;
    out.push({
      index: i + 1,
      dueAt: new Date(params.startAt.getTime() + (i + 1) * params.intervalSeconds * 1000),
      amountRaw: amount.toString(),
      amountDisplay: `${formatUnits(amount, decimals)} ${symbol}`,
      state: "scheduled",
      attempts: 0,
    });
  }
  return out;
}

export function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").slice(0, 2);
  return `${whole}.${frac}`;
}
