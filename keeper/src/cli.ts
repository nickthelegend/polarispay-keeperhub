#!/usr/bin/env node
/**
 * PolarisPay keeper CLI.
 *
 *   pnpm keeper:collect      collect every installment that is due
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

import { loadConfig, sponsorshipNote } from "./config.ts";
import { FileLoanBook } from "./loanbook.ts";
import {
  runCollection,
  runLiquidation,
  runSettlement,
  summarize,
  type JobResult,
} from "./jobs.ts";

const LOAN_BOOK_PATH = resolve(
  process.env.POLARIS_LOAN_BOOK ?? "keeper/data/loanbook.json"
);

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
  const receipts = new InMemoryReceiptStore();
  const keeper = new PolarisKeeper(
    client,
    { chainId: config.chainId, loanEngine: config.loanEngine },
    receipts
  );
  const book = new FileLoanBook(LOAN_BOOK_PATH);
  return { config, client, keeper, book, receipts };
}

async function doctor(): Promise<void> {
  const { config } = build();
  console.log("PolarisPay keeper configuration");
  console.log(`  KeeperHub:      ${config.baseUrl}`);
  console.log(`  API key:        ${config.apiKey.slice(0, 6)}… (${config.apiKey.length} chars)`);
  console.log(`  Chain:          ${config.chainId}`);
  console.log(`  LoanEngine:     ${config.loanEngine}`);
  console.log(`  Merchant escrow:${config.merchantEscrow ?? " (unset)"}`);
  console.log(`  Loan book:      ${LOAN_BOOK_PATH}`);
  console.log(`  Dry run:        ${config.dryRun}`);
  console.log(`  Gas:            ${sponsorshipNote(config.chainId)}`);
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

async function liquidate(): Promise<JobResult> {
  const { keeper, book, config } = build();
  return await runLiquidation({ keeper, book, dryRun: config.dryRun });
}

async function settle(): Promise<JobResult> {
  const { keeper, config } = build();
  // Settlement queue lives in the merchant app; nothing pending is the normal
  // state for a fresh checkout, so an empty run is a success not an error.
  return await runSettlement({ keeper, pending: [], dryRun: config.dryRun });
}

async function loop(): Promise<void> {
  const { config } = build();
  console.log(
    `keeper running every ${config.intervalSeconds}s (dryRun=${config.dryRun}). Ctrl-C to stop.`
  );
  for (;;) {
    const started = Date.now();
    try {
      const results = [await collect(), await liquidate(), await settle()];
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

const COMMANDS: Record<string, () => Promise<unknown>> = {
  doctor,
  collect,
  liquidate,
  settle,
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
  process.exit(1);
}
