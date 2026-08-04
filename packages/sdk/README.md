# @polarispay/sdk

Three payment modes, one object. Pay now, subscribe, or split into instalments.

```bash
pnpm add @polarispay/sdk ethers
```

```ts
import { createPolaris } from "@polarispay/sdk";

const polaris = createPolaris();
```

That is the setup. It defaults to the live Sepolia deployment, reads the token's
decimals from the token, approves only when the allowance is short, switches the
wallet to the right chain, and returns a plain result object instead of throwing.

## Pay now

```ts
const result = await polaris.pay({
  merchant: "0x…",
  amount: "25.00",
  orderId: "ORD-1042",
});

if (result.ok) console.log(result.explorerUrl);
else console.log(result.error);
```

The same `orderId` can never be charged twice — a retrying checkout gets a clean
rejection rather than a second charge.

## Subscribe

```ts
await polaris.subscribe({ planId: 1 });
await polaris.cancelSubscription({ subscriptionId: 1 });
```

The first period is charged on subscribe, so a plan is never active having
collected nothing. Cancelling is unilateral: it needs no merchant cooperation,
and collection stops immediately.

The approval covers one year of periods, not an unlimited allowance. That is the
difference between a subscription and handing a merchant your wallet.

## Split into instalments

```ts
const { eligible, limit, symbol } = await polaris.canPayLater("200.00");

if (eligible) {
  const result = await polaris.payLater({
    amount: "200.00",
    orderId: "ORD-1043",
    installments: 4,
  });
}
```

Check eligibility first and a buyer who is over their limit is told so, rather
than watching a wallet popup fail. The buyer signs one approval; your backend
opens the plan, so the buyer pays no gas to start it. A keeper collects each
instalment on schedule without them coming back.

`payLater` posts to `/api/checkout` by default — point `endpoint` at your own.

## Credit and collateral

```ts
const credit = await polaris.getCredit();
// { score: 612, limit: "950.00", baseLimit: "500.00",
//   collateralLocked: "300.00", collateralBoost: "450.00", … }

await polaris.lockCollateral({ amount: "300.00" });
await polaris.withdrawCollateral({ amount: "300.00" });
```

Locking collateral raises the limit by 150% of what is locked. Withdrawal is
blocked while a loan is outstanding, and `withdrawable` tells you when it is not.

## React

```tsx
import { PayWithPolarisBNPL } from "@polarispay/sdk";

<PayWithPolarisBNPL apiKey={key} amount="200.00" orderId="ORD-1" />
```

A thin shell over the same functions. Building your own UI never means
reimplementing decimals, approvals, or chain switching.

## Errors

Every method returns `{ ok, transactionHash?, explorerUrl?, error? }`. Nothing
throws for an expected failure, and contract reverts arrive as sentences a buyer
can act on:

| Revert | What the buyer sees |
|---|---|
| `ExceedsCreditLimit` | This order is above your credit limit. |
| `DuplicatePayment` | This order has already been paid. |
| `MerchantNotEligible` | This merchant cannot accept the order. |
| user rejected | You cancelled the request. |

## Another deployment

```ts
import { createPolaris, SEPOLIA } from "@polarispay/sdk";

createPolaris({ contracts: { ...SEPOLIA, loanEngine: "0x…" } });
```

## Note on decimals

Decimals are read from the token on every call. An earlier version of this SDK
hardcoded 18 against a 6-decimal stablecoin, which overcharged by a factor of
10^12 — the kind of bug that only surfaces in production, so the assumption is
gone rather than corrected.
