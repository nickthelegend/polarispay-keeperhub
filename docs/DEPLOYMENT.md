# Live deployment

**Ethereum Sepolia (11155111).** Deployed and exercised on 2026-08-03.

## Contracts

| Contract | Address |
|---|---|
| PolarisLoanEngine | [`0xF8DA73d32778f623D33C5D75c7359CbA1DA584ED`](https://sepolia.etherscan.io/address/0xF8DA73d32778f623D33C5D75c7359CbA1DA584ED) |
| ScoreManager | [`0x4e9e7EEF855BFE2c44608A9613E955fC67035312`](https://sepolia.etherscan.io/address/0x4e9e7EEF855BFE2c44608A9613E955fC67035312) |
| MerchantRegistry | [`0xb2eCAD5bE07971deE1be161C39569705186AdFD6`](https://sepolia.etherscan.io/address/0xb2eCAD5bE07971deE1be161C39569705186AdFD6) |
| MockUSDC (pUSDC, 6dp) | [`0x49C86277a91002c4943837bf20F6ED41976Db09F`](https://sepolia.etherscan.io/address/0x49C86277a91002c4943837bf20F6ED41976Db09F) |

Deployer / originator: [`0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67`](https://sepolia.etherscan.io/address/0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67)

The LoanEngine holds 100,000 pUSDC of protocol liquidity so merchants can be paid up front. `MockUSDC.faucet()` dispenses 1,000 pUSDC per address per hour.

## Proven on chain

`pnpm contracts:e2e` drives the full lifecycle against the live deployment and asserts state at each step. Every assertion passed:

| Step | Transaction |
|---|---|
| Merchant registered | [`0x28bf9a1b…`](https://sepolia.etherscan.io/tx/0x28bf9a1b39454a13929964981b502a0aebbe0983a5bbc112d034ca378ac47230) |
| Merchant activated | [`0x6a79d83d…`](https://sepolia.etherscan.io/tx/0x6a79d83da0fcf3bd18e6a8f30ec2e7e7765d644e16d9b1fbcaef078bfe31b11d) |
| Checkout approval | [`0x1723ff03…`](https://sepolia.etherscan.io/tx/0x1723ff03de9f6257faa04b81ea6a3097f61759709909964484bf020b73bbff15) |
| Plan opened (loan #1, 200 pUSDC / 4 instalments) | [`0x455c957e…`](https://sepolia.etherscan.io/tx/0x455c957e7414f7556009f4a0ba55287428352fd875482114d9de69637d4fe750) |
| Instalment 1 collected by a third party | [`0xee2ec476…`](https://sepolia.etherscan.io/tx/0xee2ec476acf4ba9ab6e9499da17bf931c01d96e95dea995f673aa69e622c7570) |
| Instalment 2 collected | [`0x786e9b5d…`](https://sepolia.etherscan.io/tx/0x786e9b5decc5f13f31a3159e269b6b142f6cdbed4f588964805dd112f0168255) |

What that run asserted, not merely printed:

- The merchant received the full 200.00 principal **at origination**, before any instalment was collected.
- `checkLiquidatable` returned **false** on a current loan, so a keeper correctly takes no action.
- Instalment collection succeeded when called by **a third party**, not the borrower — the keeper path, pulling against the single checkout approval.
- The borrower's balance moved by exactly the instalment amount.
- The credit score rose on each on-time payment: **600 → 612 → 624**, and the derived credit limit read back from chain.
- The loan stayed un-liquidatable after payment.

Live state after the run: loan #1, **2 of 4** instalments collected, 100.00 pUSDC outstanding.

## Reproducing

```bash
pnpm contracts:deploy
```

```bash
pnpm contracts:e2e
```

```bash
pnpm db:sync
```

`db:sync` reads every loan from the LoanEngine and reconciles MongoDB to it. The chain is the source of truth for what is owed; Mongo carries the instalment schedule and dunning state the contract does not store. A re-sync preserves any in-flight retry schedule rather than wiping it.

## Not yet exercised on chain

**Liquidation.** `GRACE_PERIOD` is 3 days, so a live demonstration needs a loan left unpaid for that long. The path is covered by contract tests using time travel — including the case that motivates the design, where a last-second repayment makes a loan un-liquidatable again — but no liquidation transaction exists on Sepolia yet.

**Execution through KeeperHub.** Every transaction above was signed directly with ethers. Routing them through KeeperHub needs an organization API key (`kh_…`), which is not configured. Until that key exists, `packages/keeperhub` is exercised only by its own test suite against stubbed transport, and the keeper runs in dry-run mode.
