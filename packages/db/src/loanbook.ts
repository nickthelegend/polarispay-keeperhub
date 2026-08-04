/**
 * Mongo-backed LoanBook and ReceiptStore.
 *
 * Same interfaces the keeper already targets, so swapping the file-backed
 * implementation for this one is a one-line change in the keeper's wiring.
 */

import { collections } from "./client.js";
import type {
  InstallmentDoc,
  InstallmentState,
  LoanDoc,
  ReceiptDoc,
} from "./schema.js";

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
    // The union, not a bare string: the keeper branches on these values, and a
    // widened type here is what forced a cast at the keeper boundary.
    state: InstallmentState;
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
      state: InstallmentState;
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

/** A receipt as the keeper produces it: dates as ISO strings. */
export type StoredReceipt = Omit<ReceiptDoc, "_id" | "createdAt" | "completedAt"> & {
  createdAt: string;
  completedAt?: string;
};

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

  /**
   * Return receipts in the same shape the keeper writes them.
   *
   * Mongo stores `createdAt`/`completedAt` as Date; the keeper's Receipt type
   * carries ISO strings. Converting here rather than at the call site is what
   * lets MongoReceiptStore genuinely satisfy ReceiptStore -- previously this
   * returned `unknown[]` and the keeper papered over the gap with a cast,
   * which disabled type safety at exactly the boundary where a shape mismatch
   * would corrupt reconciliation.
   */
  async list(
    filter: { loanId?: string; kind?: string } = {}
  ): Promise<StoredReceipt[]> {
    const { receipts } = await collections();
    const query: Record<string, unknown> = {};
    if (filter.loanId) query.loanId = filter.loanId;
    if (filter.kind) query.kind = filter.kind;

    const docs = await receipts.find(query).sort({ createdAt: -1 }).limit(500).toArray();
    return docs.map(({ _id, createdAt, completedAt, ...rest }) => ({
      ...rest,
      createdAt: createdAt.toISOString(),
      completedAt: completedAt?.toISOString(),
    })) as StoredReceipt[];
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
