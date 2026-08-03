/**
 * The three keeper jobs.
 *
 * Each one is a pure pass over the loan book: read what is due, act through
 * KeeperHub, write back what happened. They are safe to run repeatedly and
 * safe to run concurrently with each other.
 */

import {
  type KeeperHubErrorKind,
  type PolarisKeeper,
  type Receipt,
  formatReceipt,
  nextDunningStep,
  dunningMessage,
} from "@polarispay/keeperhub";

import type { LoanBook } from "./loanbook.ts";

export type JobResult = {
  job: string;
  considered: number;
  acted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  receipts: Receipt[];
};

export type Notifier = (message: string) => void | Promise<void>;

/**
 * Collect every installment that is due.
 *
 * The interesting part is the failure branch. A charge that fails is not
 * retried here -- it is handed to the dunning ladder, which decides whether
 * waiting will help, whether the borrower should hear about it, and whether the
 * loan has run out of road and should be liquidated instead.
 */
export async function runCollection(opts: {
  keeper: PolarisKeeper;
  book: LoanBook;
  now?: Date;
  dryRun?: boolean;
  notify?: Notifier;
  log?: (line: string) => void;
}): Promise<JobResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const due = await opts.book.dueInstallments(now);

  const result: JobResult = {
    job: "collection",
    considered: due.length,
    acted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    receipts: [],
  };

  for (const { loan, installment } of due) {
    const attempt = installment.attempts + 1;

    if (opts.dryRun) {
      log(
        `[dry-run] would collect ${installment.amountDisplay} for loan ${loan.loanId} installment ${installment.index} (attempt ${attempt})`
      );
      result.skipped++;
      continue;
    }

    const receipt = await opts.keeper.collectInstallment({
      loanId: loan.loanId,
      installment: installment.index,
      amountRaw: installment.amountRaw,
      amountDisplay: installment.amountDisplay,
      attempt,
    });
    result.acted++;
    result.receipts.push(receipt);
    log(formatReceipt(receipt));

    if (receipt.outcome === "succeeded") {
      result.succeeded++;
      await opts.book.recordAttempt(loan.loanId, installment.index, {
        state: "paid",
        attempts: attempt,
        nextAttemptAt: undefined,
        lastFailureKind: undefined,
      });
      continue;
    }

    result.failed++;
    const kind = (receipt.error?.kind ?? "unknown") as KeeperHubErrorKind;
    const decision = nextDunningStep({ attemptsMade: attempt, failureKind: kind, now });

    if (decision.action === "retry") {
      await opts.book.recordAttempt(loan.loanId, installment.index, {
        state: "dunning",
        attempts: attempt,
        nextAttemptAt: decision.at.toISOString(),
        lastFailureKind: kind,
      });
      if (decision.stage.notify && opts.notify) {
        await opts.notify(
          dunningMessage(decision.stage, {
            amount: installment.amountDisplay,
            loanId: loan.loanId,
          })
        );
      }
      log(
        `  -> dunning: ${decision.stage.label}, next attempt ${decision.at.toISOString()}`
      );
    } else if (decision.action === "escalate") {
      await opts.book.recordAttempt(loan.loanId, installment.index, {
        state: "dunning",
        attempts: attempt,
        lastFailureKind: kind,
      });
      await opts.book.markLiquidationCandidate(loan.loanId);
      log(`  -> escalated to liquidation: ${decision.reason}`);
    } else {
      await opts.book.recordAttempt(loan.loanId, installment.index, {
        attempts: attempt,
        lastFailureKind: kind,
      });
      log(`  -> abandoned: ${decision.reason}`);
    }
  }

  return result;
}

/**
 * Test every liquidation candidate and liquidate the ones the protocol agrees
 * are liquidatable.
 *
 * The decision is never made here. `checkLiquidatable` is evaluated on chain
 * inside the same KeeperHub call that would liquidate, so a borrower who repays
 * a second before this runs is not liquidated by a stale read.
 */
export async function runLiquidation(opts: {
  keeper: PolarisKeeper;
  book: LoanBook;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<JobResult> {
  const log = opts.log ?? console.log;
  const candidates = await opts.book.liquidationCandidates();

  const result: JobResult = {
    job: "liquidation",
    considered: candidates.length,
    acted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    receipts: [],
  };

  for (const loan of candidates) {
    if (opts.dryRun) {
      log(`[dry-run] would test loan ${loan.loanId} for liquidation`);
      result.skipped++;
      continue;
    }
    const receipt = await opts.keeper.liquidateIfUnhealthy({ loanId: loan.loanId });
    result.acted++;
    result.receipts.push(receipt);
    log(formatReceipt(receipt));

    if (receipt.outcome === "succeeded") {
      result.succeeded++;
    } else if (receipt.outcome === "skipped") {
      result.skipped++;
    } else {
      result.failed++;
    }
  }

  return result;
}

export type PendingSettlement = {
  merchantId: string;
  escrowAddress: string;
  amountRaw: string;
  amountDisplay: string;
  orderId: string;
  details?: string;
};

/** Pay merchants what they are owed. */
export async function runSettlement(opts: {
  keeper: PolarisKeeper;
  pending: PendingSettlement[];
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<JobResult> {
  const log = opts.log ?? console.log;
  const result: JobResult = {
    job: "settlement",
    considered: opts.pending.length,
    acted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    receipts: [],
  };

  for (const p of opts.pending) {
    if (opts.dryRun) {
      log(`[dry-run] would settle ${p.amountDisplay} to merchant ${p.merchantId}`);
      result.skipped++;
      continue;
    }
    const receipt = await opts.keeper.settleMerchant(p);
    result.acted++;
    result.receipts.push(receipt);
    log(formatReceipt(receipt));
    receipt.outcome === "succeeded" ? result.succeeded++ : result.failed++;
  }

  return result;
}

export function summarize(results: JobResult[]): string {
  return results
    .map(
      (r) =>
        `${r.job}: ${r.considered} considered, ${r.succeeded} succeeded, ${r.failed} failed, ${r.skipped} skipped`
    )
    .join("\n");
}
