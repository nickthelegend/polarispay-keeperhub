#!/usr/bin/env node
/**
 * PolarisPay keeper CLI.
 *
 *   pnpm keeper:collect      collect every installment that is due
 *   pnpm keeper:subscriptions charge every subscription period that is due
 *   pnpm keeper:liquidate    liquidate loans the protocol says are unhealthy
 *   pnpm keeper:settle       pay merchants
 *   pnpm keeper:all          run all three on a loop
 *   ... doctor               check credentials and configuration
 */

import { resolve } from "node:path";

import {
  InMemoryReceiptStore,
  KeeperHubClient,
  PolarisKeeper,
  isKeeperHubError,
} from "@polarispay/keeperhub";
import {
  closeDb,
  deliverWebhook,
  type KeeperJob,
  markSettled,
  MongoLoanBook,
  MongoReceiptStore,
  pendingSettlements,
  ping,
  healthReport,
  recordHeartbeat,
  renderHealth,
} from "@polarispay/db";

import { loadConfig, sponsorshipNote } from "./config.ts";
import { FileLoanBook } from "./loanbook.ts";
import type { LoanBook } from "./loanbook.ts";
import {
  runCollection,
  runLiquidation,
  runSettlement,
  runCloseOut,
  runSubscriptions,
  summarize,
  type JobResult,
} from "./jobs.ts";
import { activeSubscriptions, jsonRpc, residualLoans } from "./subscriptions.ts";

const LOAN_BOOK_PATH = resolve(
  process.env.POLARIS_LOAN_BOOK ?? "keeper/data/loanbook.json"
);

/**
 * Mongo is the store when MONGODB_URI is set, and the file-backed book is the
 * fallback. That is not just convenience: the file book keeps `doctor` and a
 * dry run working on a fresh clone with no database, which is the difference
 * between a new contributor seeing the keeper run in one command or hitting a
 * connection error before they have read anything.
 */
function storage(): {
  book: LoanBook;
  receipts: InstanceType<typeof InMemoryReceiptStore> | MongoReceiptStore;
  backend: "mongodb" | "file";
} {
  if (process.env.MONGODB_URI) {
    return {
      book: new MongoLoanBook(),
      receipts: new MongoReceiptStore(),
      backend: "mongodb",
    };
  }
  return {
    book: new FileLoanBook(LOAN_BOOK_PATH),
    receipts: new InMemoryReceiptStore(),
    backend: "file",
  };
}

function build() {
  const config = loadConfig();
  const client = new KeeperHubClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    onEvent: (e) => {
      if (e.type === "retry") {
        console.log(`  retry ${e.path} after ${e.delayMs}ms (${e.reason})`);
      }
      if (e.type === "simulated" && !e.ok) {
        console.log(`  simulation says this would fail: ${e.revertReason}`);
      }
    },
  });
  const { book, receipts, backend } = storage();
  const keeper = new PolarisKeeper(
    client,
    { chainId: config.chainId, loanEngine: config.loanEngine, payments: config.payments },
    receipts
  );
  return { config, client, keeper, book, receipts, backend };
}

async function doctor(): Promise<void> {
  const { config, backend, book } = build();
  console.log("PolarisPay keeper configuration");
  console.log(`  KeeperHub:      ${config.baseUrl}`);
  console.log(`  API key:        ${config.apiKey.slice(0, 6)}… (${config.apiKey.length} chars)`);
  console.log(`  Chain:          ${config.chainId}`);
  console.log(`  LoanEngine:     ${config.loanEngine}`);
  console.log(`  Merchant escrow:${config.merchantEscrow ?? " (unset)"}`);
  console.log(`  Payments:       ${config.payments ?? "(unset -- subscriptions will be skipped)"}`);
  console.log(`  Store:          ${backend}${backend === "file" ? ` (${LOAN_BOOK_PATH})` : ""}`);
  console.log(`  Dry run:        ${config.dryRun}`);
  console.log(`  Gas:            ${sponsorshipNote(config.chainId)}`);

  if (backend === "mongodb") {
    try {
      const health = await ping();
      const loans = await book.all();
      console.log(`  MongoDB:        reachable in ${health.ms}ms, ${loans.length} loans`);
    } catch (err) {
      console.log(`  MongoDB:        UNREACHABLE -- ${(err as Error).message}`);
    }
  }

  console.log("");
  console.log(
    "Reminder: a sponsored execution runs through a smart account, so the keeper wallet's nonce, balance and explorer tx list will NOT change. Confirm charges with the execution status, never with the wallet."
  );
}

async function collect(): Promise<JobResult> {
  const { keeper, book, config } = build();
  return await runCollection({
    keeper,
    book,
    dryRun: config.dryRun,
    notify: (m) => console.log(`  notify borrower: ${m}`),
  });
}

async function subscriptions(): Promise<JobResult> {
  const { keeper, config } = build();

  if (!config.payments) {
    console.log("POLARIS_PAYMENTS is not set; nothing to charge.");
    return { job: "subscriptions", considered: 0, acted: 0, succeeded: 0, failed: 0, skipped: 0, receipts: [] };
  }

  const active = await activeSubscriptions(config.payments, jsonRpc(config.rpcUrl));
  return await runSubscriptions({ keeper, subscriptions: active, dryRun: config.dryRun });
}

async function closeOut(): Promise<JobResult> {
  const { keeper, config } = build();
  const residuals = await residualLoans(config.loanEngine, jsonRpc(config.rpcUrl));
  if (residuals.length === 0) console.log("no loans left hanging on a rounding residue");
  return await runCloseOut({ keeper, residuals, dryRun: config.dryRun });
}

async function liquidate(): Promise<JobResult> {
  const { keeper, book, config } = build();
  return await runLiquidation({ keeper, book, dryRun: config.dryRun });
}

async function settle(): Promise<JobResult> {
  const { keeper, config, backend } = build();

  // This used to be hardcoded to `[]`, which meant settleMerchant had never
  // executed and merchants were never actually paid out. The queue is derived
  // from instalments already collected and not yet settled.
  const pending =
    backend === "mongodb" ? await pendingSettlements({ chainId: config.chainId }) : [];

  if (pending.length === 0) {
    console.log("nothing pending to settle");
  }

  const result = await runSettlement({ keeper, pending, dryRun: config.dryRun });

  if (!config.dryRun) {
    for (const receipt of result.receipts) {
      if (receipt.outcome !== "succeeded") continue;
      const settlement = pending.find((p) => receipt.actionId.includes(p.merchantId));
      if (!settlement) continue;

      await markSettled(settlement, receipt.execution?.transactionHash);
      await deliverWebhook(settlement.merchantId, "settlement.paid", {
        amount: settlement.amountDisplay,
        orderIds: settlement.orderId,
        transactionHash: receipt.execution?.transactionHash,
      });
    }
  }

  return result;
}

async function loop(): Promise<void> {
  const { config } = build();
  console.log(
    `keeper running every ${config.intervalSeconds}s (dryRun=${config.dryRun}). Ctrl-C to stop.`
  );
  for (;;) {
    const started = Date.now();
    try {
      const results = [
        await withHeartbeat("collection", collect),
        await withHeartbeat("subscriptions", subscriptions),
        await withHeartbeat("close-out", closeOut),
        await withHeartbeat("liquidation", liquidate),
        await withHeartbeat("settlement", settle),
      ];
      console.log(`\n--- pass complete ---\n${summarize(results)}\n`);
    } catch (err) {
      // A pass failing must never kill the keeper: the next pass re-reads state
      // and everything in flight is idempotent.
      reportError(err);
    }
    const elapsed = Date.now() - started;
    const wait = Math.max(0, config.intervalSeconds * 1000 - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }
}

function reportError(err: unknown): void {
  if (isKeeperHubError(err)) {
    console.error(`KeeperHub error [${err.kind}] ${err.message}`);
    if (err.field) {
      console.error(`  field: ${err.field}`);
    }
    if (err.details) {
      console.error(`  details: ${err.details}`);
    }
    if (err.kind === "auth") {
      console.error(
        "  hint: organization API keys start with `kh_` and are created in the KeeperHub dashboard."
      );
    }
  } else {
    console.error(err);
  }
}

/**
 * Every pass writes a heartbeat, successful or not. The health check reads
 * those rather than anything the keeper claims about itself, so a keeper that
 * has stopped is visible as silence rather than being invisible.
 */
async function withHeartbeat(
  job: KeeperJob,
  fn: () => Promise<JobResult>
): Promise<JobResult> {
  const started = Date.now();
  const result = await fn();
  if (process.env.MONGODB_URI) {
    await recordHeartbeat({
      job,
      at: new Date(),
      considered: result.considered,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
      durationMs: Date.now() - started,
    }).catch(() => undefined);
  }
  return result;
}

async function health(): Promise<void> {
  const { config } = build();
  console.log(renderHealth(await healthReport(config.chainId)));
}

const COMMANDS: Record<string, () => Promise<unknown>> = {
  doctor,
  health,
  collect: () => withHeartbeat("collection", collect),
  subscriptions: () => withHeartbeat("subscriptions", subscriptions),
  "close-out": () => withHeartbeat("close-out", closeOut),
  liquidate: () => withHeartbeat("liquidation", liquidate),
  settle: () => withHeartbeat("settlement", settle),
  run: loop,
};

const command = process.argv[2] ?? "doctor";
const handler = COMMANDS[command];

if (!handler) {
  console.error(
    `Unknown command "${command}". Available: ${Object.keys(COMMANDS).join(", ")}`
  );
  process.exit(1);
}

try {
  const result = await handler();
  if (result && typeof result === "object" && "job" in result) {
    console.log(`\n${summarize([result as JobResult])}`);
  }
} catch (err) {
  reportError(err);
  process.exitCode = 1;
} finally {
  // An open Mongo pool keeps the event loop alive, so a one-shot command would
  // hang forever after printing its result. `run` never reaches here.
  await closeDb().catch(() => undefined);
}
