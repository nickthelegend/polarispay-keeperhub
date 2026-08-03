# PolarisPay × KeeperHub

**Undercollateralized BNPL for crypto — with KeeperHub as the execution and reliability layer.**

Polaris issues credit. KeeperHub makes sure the money actually moves: installments get collected on the day they are due, defaulted loans get liquidated the moment they qualify, and merchants get paid. Every one of those is a transaction that has to land, exactly once, or somebody loses money.

Submission for the **KeeperHub Agents Onchain** hackathon.

---

## The problem

Credit is easy to issue and hard to collect.

A BNPL provider's real operational risk is not the lending decision — it is the four hundred installments due on the first of the month, the borrower whose balance moved between approval and collection, the gas spike that leaves a repayment unmined for three hours, and the defaulted loan that has to be liquidated before the position rots.

Every one of those is an execution problem. Not a credit problem.

**The question that kills a credit book is "did installment 3 collect?"** — and that is precisely the question KeeperHub exists to make always answerable.

## What runs through KeeperHub

| Lifecycle event | KeeperHub primitive | Why it has to be this way |
|---|---|---|
| Installment due | Schedule trigger → `simulate` → `execute_contract_call` on `LoanEngine.repay` | Dry-run first: a borrower who is short becomes a dunning event, not a burnt transaction |
| Loan unhealthy | `check-and-execute` on `checkLiquidatable` → `liquidate` | Read and write in **one atomic call** — no window for a last-second repayment to be liquidated on a stale read |
| Charge failed | Typed failure → dunning ladder | Retrying an insufficient-funds revert on a network schedule is worse than useless |
| Merchant payable | `execute_contract_call` on `PolarisMerchantEscrow.settlePayment` | Same reliability guarantees as collection |
| Any charge | `Idempotency-Key`, scoped per attempt | A retry storm must never double-charge a customer |
| Everything | Terminal status reconciliation + receipts | Disputable evidence for every movement of money |

`LoanEngine.checkLiquidatable(loanId) → liquidate(loanId)` maps **1:1** onto KeeperHub's `check-and-execute`. That is not a convenient coincidence — a conditional on-chain action is exactly what a keeper platform is for.

## Repository layout

```
packages/keeperhub    @polarispay/keeperhub — the execution engine (19 tests)
packages/protocol     Solidity: LoanEngine, ScoreManager, CreditOracle, PoolManager…
packages/sdk          <PayWithPolaris /> drop-in checkout component
keeper/               The runnable keeper: collect, liquidate, settle
apps/core             Main app — lending pools, FHEVM private vaults
apps/merchant         Merchant portal + PolarisMerchantEscrow
apps/shopify          Shopify payments app + checkout extension
docs/                 Architecture and the KeeperHub surface map
```

## Quick start

```bash
pnpm install
```

```bash
cp keeper/.env.example keeper/.env
```

Set `KEEPERHUB_API_KEY` (organization key from the KeeperHub dashboard, starts with `kh_`) and `POLARIS_LOAN_ENGINE`, then check your setup:

```bash
pnpm --filter @polarispay/keeper doctor
```

Run a pass without sending anything (`KEEPER_DRY_RUN=true`):

```bash
pnpm keeper:collect
```

Run the full loop:

```bash
pnpm keeper:all
```

## Three details worth knowing

**A sponsored execution is invisible to the wallet.** KeeperHub's Gas Station runs sponsored sends through a smart account, so the keeper wallet's nonce, native balance and explorer transaction list never change. Verifying a charge by checking the wallet reports every success as a failure. The execution status route is the only source of truth — the client enforces this.

**Idempotency keys are scoped per attempt, not per action.** KeeperHub caches responses for a key *including failures* and replays them for 24h. That protects against double-charging and actively prevents recovery: a retry with the same key returns the original error while the chain has moved on. Keys are `${actionId}-a${attempt}`, so transport duplicates still collapse while a genuine retry gets a fresh execution. Double-repayment is guarded where it belongs — in `LoanEngine`.

**Failures branch on cause, not on count.** `insufficient_funds` waits on a business ladder measured in days. `would_revert` is abandoned, because protocol state will not fix itself. `auth` and `spend_cap` are operator problems and never notify the borrower. This is in [`dunning.ts`](packages/keeperhub/src/dunning.ts).

## Tests

```bash
pnpm test
```

19 tests over the paths where a bug costs real money: argument encoding, idempotency scoping, simulate-gating (proving no broadcast happens when simulation fails), terminal reconciliation, the atomic liquidation call, the dunning branch, and transport retry classification.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [KeeperHub surface map](docs/KEEPERHUB.md)

## License

MIT
