# Feature map

100 features across the PolarisPay stack. **Shipped** means the code is in this repo and exercised by a test or a run. **Wired** means the plumbing exists and needs data or a deployment to be live. **Planned** means designed but not built.

Status counts: **38 shipped · 21 wired · 41 planned**

---

## Credit engine (on chain)

| # | Feature | Status |
|---|---|---|
| 1 | Undercollateralized BNPL loans with equal installments | Shipped |
| 2 | Merchant paid in full at origination from protocol liquidity | Shipped |
| 3 | Pull-based collection — one approval at checkout funds every installment | Shipped |
| 4 | Permissionless `repay` so any keeper can collect, funds only ever move borrower → contract | Shipped |
| 5 | `checkLiquidatable` as a pure view returning a plain bool, for use as a keeper condition | Shipped |
| 6 | `liquidate` re-checks the condition, so a stale read can never liquidate a healthy loan | Shipped |
| 7 | Last-payment rounding absorption — loans close at exactly zero, no dust | Shipped |
| 8 | Configurable grace period before a missed installment becomes liquidatable | Shipped |
| 9 | Interest accrued pro-rata over the actual term, not a flat fee | Shipped |
| 10 | Protocol fee split on interest, swept to treasury | Shipped |
| 11 | Per-borrower active debt tracking enforced at origination | Shipped |
| 12 | Credit limit check blocks a plan that exceeds the borrower's score-derived limit | Shipped |
| 13 | Originator allowlist so only the API signer can open plans | Shipped |
| 14 | Reentrancy guards on every value-moving path | Shipped |
| 15 | Custom errors throughout for cheap, decodable reverts | Shipped |
| 16 | Partial early repayment | Planned |
| 17 | Plan refinancing / term extension for a borrower in good standing | Planned |
| 18 | Merchant-funded 0% APR promotional plans | Planned |
| 19 | Multi-token collateral support | Planned |
| 20 | Secondary market for performing loan books | Planned |

## Credit scoring

| # | Feature | Status |
|---|---|---|
| 21 | FICO-style 300–850 score, on chain | Shipped |
| 22 | Asymmetric adjustment — trust slow to earn, fast to lose | Shipped |
| 23 | Score floor and ceiling clamping | Shipped |
| 24 | On-time / late / liquidation event counters per borrower | Shipped |
| 25 | Piecewise credit limits, legible to a user ("reach 700 and your limit doubles") | Shipped |
| 26 | Writer allowlist — only the LoanEngine can move a score | Shipped |
| 27 | New borrowers seeded at a starting score rather than zero | Shipped |
| 28 | `ScoreChanged` event carrying the reason, for a user-facing history | Shipped |
| 29 | Score decay for dormancy | Planned |
| 30 | Cross-protocol credit import (Aave / Morpho / Compound positions) | Planned |
| 31 | Score portability as an attestation other protocols can read | Planned |
| 32 | Explainable score breakdown in the borrower UI | Planned |

## Execution layer (KeeperHub)

| # | Feature | Status |
|---|---|---|
| 33 | Typed KeeperHub client with auth, backoff and retry classification | Shipped |
| 34 | Simulate before every broadcast | Shipped |
| 35 | Revert-reason classification into typed failure kinds | Shipped |
| 36 | Per-attempt idempotency keys, so a retry is never served a cached failure | Shipped |
| 37 | Terminal status reconciliation — never infers success from wallet state | Shipped |
| 38 | Sponsored-execution awareness (nonce/balance/tx-list do not move) | Shipped |
| 39 | Atomic `check-and-execute` liquidation | Shipped |
| 40 | Route-correct argument encoding (stringified scalars, stringified arg array) | Shipped |
| 41 | Spend-cap 403 distinguished from auth 403 | Shipped |
| 42 | `Retry-After` honoured on rate limits | Shipped |
| 43 | Structured receipts joining execution to loan and installment | Shipped |
| 44 | Gas-sponsorship eligibility check at startup | Shipped |
| 45 | KeeperHub workflow JSON for collection and liquidation | Wired |
| 46 | Private mempool routing for liquidations | Planned |
| 47 | Tempo atomic batch payout for merchant settlement | Planned |
| 48 | x402 monetization — sell the collection workflow to other credit protocols | Planned |
| 49 | MCP server so an agent can open and manage plans | Planned |
| 50 | Multi-chain keeper fleet with per-chain spend caps | Planned |

## Collections and risk

| # | Feature | Status |
|---|---|---|
| 51 | Dunning ladder: 6h → 24h → 72h → 168h → escalate | Shipped |
| 52 | Failure branches on cause, not attempt count | Shipped |
| 53 | Operator-side failures never notify the borrower | Shipped |
| 54 | Protocol reverts abandoned for reconciliation rather than retried | Shipped |
| 55 | Automatic escalation to liquidation candidate when the ladder is exhausted | Shipped |
| 56 | Back-off respected at query time so a short borrower is not re-charged hourly | Shipped |
| 57 | Borrower-facing dunning copy per ladder stage | Shipped |
| 58 | Per-merchant configurable ladders | Wired |
| 59 | Collection-rate metric on the merchant ledger | Shipped |
| 60 | At-risk exposure figure | Shipped |
| 61 | Retry on a smaller partial amount when the balance is short but non-zero | Planned |
| 62 | Borrower self-cure flow ("top up and retry now") | Planned |
| 63 | Merchant-configurable risk appetite driving approval thresholds | Planned |
| 64 | Portfolio-level exposure limits per merchant category | Planned |
| 65 | Early-warning signal from wallet balance trend before an installment falls due | Planned |

## Data layer

| # | Feature | Status |
|---|---|---|
| 66 | MongoDB Atlas persistence | Shipped |
| 67 | Money stored as base-unit strings, never floats | Shipped |
| 68 | Fourteen indexes covering every hot query | Shipped |
| 69 | Server-side `$elemMatch` filtering so the keeper never pulls the whole book | Shipped |
| 70 | Receipt upsert on (actionId, attempt) — no duplicate rows on an interrupted pass | Shipped |
| 71 | Append-only event log, never updated or deleted | Shipped |
| 72 | Cached connection pool safe for hot-reload and long-lived processes | Shipped |
| 73 | Idempotent index migration | Shipped |
| 74 | Installment schedule builder with exact remainder handling | Shipped |
| 75 | On-chain event indexer backfilling the event log | Planned |
| 76 | Read replica for merchant analytics | Planned |
| 77 | Automated reconciliation job comparing chain state to the book | Planned |

## Merchant experience

| # | Feature | Status |
|---|---|---|
| 78 | Collections ledger as the dashboard — money and risk, not app cards | Shipped |
| 79 | Discrete installment tick marks instead of an approximate progress bar | Shipped |
| 80 | Live/retry/liquidated state vocabulary with a reserved accent for "keeper working" | Shipped |
| 81 | Filter by collecting / dunning / closed | Shipped |
| 82 | Per-filter empty states with distinct copy | Shipped |
| 83 | Error state naming the problem and the recovery | Shipped |
| 84 | Skeleton rows matching the real table geometry | Shipped |
| 85 | Deep link to the settlement transaction on Basescan | Shipped |
| 86 | Tabular numerals throughout so figures align down the column | Shipped |
| 87 | Auto-refresh every 20s | Shipped |
| 88 | Merchant onboarding and API key issuance | Wired |
| 89 | Webhook delivery with signature and replay | Wired |
| 90 | Settlement export (CSV / accounting) | Planned |
| 91 | Refund and partial-refund flow | Planned |
| 92 | Dispute handling backed by the receipt trail | Planned |

## Checkout and distribution

| # | Feature | Status |
|---|---|---|
| 93 | `<PayWithPolaris />` drop-in React component | Wired |
| 94 | Shopify payments app and checkout UI extension | Wired |
| 95 | Base Sepolia deployment scripts with address output | Shipped |
| 96 | Faucet-enabled test stablecoin so a demo borrower can self-fund | Shipped |
| 97 | Merchant registry with per-merchant origination caps | Shipped |
| 98 | Hosted checkout page | Planned |
| 99 | WooCommerce / Stripe-compatible adapter | Planned |
| 100 | Agent checkout — an AI agent opens a plan via MCP and pays through x402 | Planned |

---

## What the 38 shipped features are proven by

- **19 Solidity tests** — origination, credit limits, collection by a third party, score movement, exact loan closure, and every liquidation edge including a last-second repayment making a loan un-liquidatable again.
- **19 TypeScript tests** — argument encoding, idempotency scoping, no-broadcast-on-failed-simulation, terminal reconciliation with the sponsored flag, atomic liquidation, dunning branches, and retry classification.
- **A live MongoDB Atlas connection** with all 14 indexes created.
- **A running keeper** — `doctor` and `collect` execute end to end against the loan book.
- **A design detector pass** with zero findings on the redesigned dashboard.
