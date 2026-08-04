/**
 * The whole SDK, headless.
 *
 * Three payment modes behind one object, each a single call:
 *
 *   const polaris = createPolaris({ apiKey });
 *   await polaris.pay({ amount: "25.00", orderId: "ORD-1", merchant });
 *   await polaris.subscribe({ planId: 1 });
 *   await polaris.payLater({ amount: "200.00", orderId: "ORD-2" });
 *
 * The React component in `./components` is a thin shell over this, so anyone
 * who wants their own UI never has to reimplement decimals, approvals, chain
 * switching, or error handling.
 *
 * Decimals are read from the token, never assumed. The previous component
 * hardcoded 18 against a 6-decimal stablecoin, which overcharged by 10^12.
 */

import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers";

export const SEPOLIA = {
  chainId: 11155111,
  explorer: "https://sepolia.etherscan.io",
  stablecoin: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
  loanEngine: "0x5d6F049f791C40b09701129b3663d1A8ce9eAB86",
  scoreManager: "0x13C5af8f4c6E7f3b26998451Cf4FD65a6Ca268e2",
  collateralVault: "0xDb6781ed843Ba07Af3321bB8C3952db643324b98",
  payments: "0x3BD1609abDC915eA9e01A399a26e2B8A2a06243f",
} as const;

export type PolarisContracts = typeof SEPOLIA;

const ERC20 = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
const PAYMENTS = [
  "function pay(address,uint256,string) returns (bytes32)",
  "function subscribe(uint256) returns (uint256)",
  "function cancel(uint256)",
  "function getPlan(uint256) view returns (tuple(address merchant,uint128 pricePerPeriod,uint64 periodSeconds,bool active,string name))",
];
const SCORES = [
  "function scoreOf(address) view returns (uint16)",
  "function creditLimitOf(address) view returns (uint256)",
  "function baseLimitOf(address) view returns (uint256)",
];
const VAULT = [
  "function lock(uint256)",
  "function withdraw(uint256)",
  "function lockedOf(address) view returns (uint256)",
  "function withdrawable(address) view returns (uint256)",
  "function creditBoostOf(address) view returns (uint256)",
];

export type PolarisOptions = {
  /** Merchant API key, forwarded to your backend for BNPL origination. */
  apiKey?: string;
  /** Your endpoint that calls createLoan. Only needed for `payLater`. */
  endpoint?: string;
  contracts?: PolarisContracts;
  /** Injected provider. Defaults to `window.ethereum`. */
  provider?: unknown;
};

export type Result = {
  ok: boolean;
  transactionHash?: string;
  explorerUrl?: string;
  error?: string;
};

export type CreditProfile = {
  address: string;
  score: number;
  limit: string;
  baseLimit: string;
  collateralLocked: string;
  collateralBoost: string;
  withdrawable: string;
  symbol: string;
};

export function createPolaris(options: PolarisOptions = {}) {
  const c = options.contracts ?? SEPOLIA;
  const endpoint = options.endpoint ?? "/api/checkout";

  async function connect() {
    const eth = (options.provider ?? (globalThis as { ethereum?: unknown }).ethereum) as
      | { request: (a: unknown) => Promise<unknown> }
      | undefined;
    if (!eth) throw new Error("No wallet found. Install a browser wallet to pay with Polaris.");

    const provider = new BrowserProvider(eth as never);
    const [address] = (await provider.send("eth_requestAccounts", [])) as string[];

    const net = await provider.getNetwork();
    if (net.chainId !== BigInt(c.chainId)) {
      await provider.send("wallet_switchEthereumChain", [
        { chainId: `0x${c.chainId.toString(16)}` },
      ]);
    }
    return { provider, signer: await provider.getSigner(), address: address! };
  }

  /** Read decimals from the token rather than assuming them. */
  async function scale(provider: BrowserProvider, amount: string): Promise<bigint> {
    const token = new Contract(c.stablecoin, ERC20, provider);
    return parseUnits(amount, await token.decimals());
  }

  /** Approve only when the current allowance is short. */
  async function ensureAllowance(signer: never, spender: string, need: bigint, owner: string) {
    const token = new Contract(c.stablecoin, ERC20, signer);
    const current: bigint = await token.allowance(owner, spender);
    if (current >= need) return;
    await (await token.approve(spender, need)).wait();
  }

  function ok(hash?: string): Result {
    return { ok: true, transactionHash: hash, explorerUrl: hash ? `${c.explorer}/tx/${hash}` : undefined };
  }

  function fail(err: unknown): Result {
    const raw =
      (err as { shortMessage?: string })?.shortMessage ?? (err as Error)?.message ?? String(err);
    if (/user rejected|user denied/i.test(raw)) return { ok: false, error: "You cancelled the request." };
    if (/insufficient funds/i.test(raw)) return { ok: false, error: "Not enough ETH for the network fee." };
    if (/ExceedsCreditLimit/i.test(raw)) return { ok: false, error: "This order is above your credit limit." };
    if (/DuplicatePayment/i.test(raw)) return { ok: false, error: "This order has already been paid." };
    if (/MerchantNotEligible/i.test(raw)) return { ok: false, error: "This merchant cannot accept the order." };
    return { ok: false, error: raw.length > 160 ? `${raw.slice(0, 157)}…` : raw };
  }

  return {
    contracts: c,

    /** Pay a merchant in full, now. */
    async pay(p: { merchant: string; amount: string; orderId: string }): Promise<Result> {
      try {
        const { provider, signer, address } = await connect();
        const value = await scale(provider, p.amount);
        await ensureAllowance(signer as never, c.payments, value, address);
        const tx = await new Contract(c.payments, PAYMENTS, signer).pay(
          p.merchant,
          value,
          p.orderId
        );
        await tx.wait();
        return ok(tx.hash);
      } catch (err) {
        return fail(err);
      }
    },

    /** Start a subscription. The first period is charged immediately. */
    async subscribe(p: { planId: number | bigint }): Promise<Result> {
      try {
        const { provider, signer, address } = await connect();
        const payments = new Contract(c.payments, PAYMENTS, signer);
        const plan = await payments.getPlan(p.planId);
        if (!plan.active) return { ok: false, error: "This plan is no longer available." };

        // Approve a year of periods so the keeper can collect unattended, and
        // no more -- the subscriber can revoke at any time, and this bounds
        // what a compromised contract could ever draw.
        const periodsPerYear = BigInt(Math.ceil(31_536_000 / Number(plan.periodSeconds)));
        await ensureAllowance(
          signer as never,
          c.payments,
          BigInt(plan.pricePerPeriod) * periodsPerYear,
          address
        );

        const tx = await payments.subscribe(p.planId);
        await tx.wait();
        return ok(tx.hash);
      } catch (err) {
        return fail(err);
      }
    },

    /** Cancel a subscription. Unilateral -- no merchant cooperation needed. */
    async cancelSubscription(p: { subscriptionId: number | bigint }): Promise<Result> {
      try {
        const { signer } = await connect();
        const tx = await new Contract(c.payments, PAYMENTS, signer).cancel(p.subscriptionId);
        await tx.wait();
        return ok(tx.hash);
      } catch (err) {
        return fail(err);
      }
    },

    /**
     * Split a purchase into instalments.
     *
     * The buyer signs one approval covering the full repayment; your backend
     * opens the plan, because createLoan is originator-gated. The buyer pays no
     * gas to start it.
     */
    async payLater(p: {
      amount: string;
      orderId: string;
      installments?: number;
      intervalSeconds?: number;
    }): Promise<Result & { loanId?: string }> {
      try {
        const { provider, signer, address } = await connect();
        const value = await scale(provider, p.amount);
        // Headroom for interest accrued over the term.
        await ensureAllowance(signer as never, c.loanEngine, (value * 110n) / 100n, address);

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.apiKey ? { "x-api-key": options.apiKey } : {}),
          },
          body: JSON.stringify({
            borrower: address,
            amount: p.amount,
            orderId: p.orderId,
            installments: p.installments ?? 4,
            intervalSeconds: p.intervalSeconds ?? 14 * 86_400,
            chainId: c.chainId,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: body.error ?? `Could not open the plan (${res.status})` };

        return { ...ok(body.transactionHash), loanId: body.loanId };
      } catch (err) {
        return fail(err);
      }
    },

    /** Lock collateral to raise the credit limit. */
    async lockCollateral(p: { amount: string }): Promise<Result> {
      try {
        const { provider, signer, address } = await connect();
        const value = await scale(provider, p.amount);
        await ensureAllowance(signer as never, c.collateralVault, value, address);
        const tx = await new Contract(c.collateralVault, VAULT, signer).lock(value);
        await tx.wait();
        return ok(tx.hash);
      } catch (err) {
        return fail(err);
      }
    },

    async withdrawCollateral(p: { amount: string }): Promise<Result> {
      try {
        const { provider, signer } = await connect();
        const tx = await new Contract(c.collateralVault, VAULT, signer).withdraw(
          await scale(provider, p.amount)
        );
        await tx.wait();
        return ok(tx.hash);
      } catch (err) {
        return fail(err);
      }
    },

    /** Read-only. Safe to call before the buyer commits to anything. */
    async getCredit(address?: string): Promise<CreditProfile> {
      const { provider, address: connected } = await connect();
      const who = address ?? connected;

      const token = new Contract(c.stablecoin, ERC20, provider);
      const scores = new Contract(c.scoreManager, SCORES, provider);
      const vault = new Contract(c.collateralVault, VAULT, provider);

      const [decimals, symbol, score, limit, base, locked, boost, free] = await Promise.all([
        token.decimals(),
        token.symbol(),
        scores.scoreOf(who),
        scores.creditLimitOf(who),
        scores.baseLimitOf(who),
        vault.lockedOf(who),
        vault.creditBoostOf(who),
        vault.withdrawable(who),
      ]);

      const fmt = (v: bigint) => formatUnits(v, decimals);
      return {
        address: who,
        score: Number(score),
        limit: fmt(limit),
        baseLimit: fmt(base),
        collateralLocked: fmt(locked),
        collateralBoost: fmt(boost),
        withdrawable: fmt(free),
        symbol,
      };
    },

    /** Whether this buyer can afford a given order on credit. */
    async canPayLater(amount: string): Promise<{ eligible: boolean; limit: string; symbol: string }> {
      const credit = await this.getCredit();
      return {
        eligible: Number.parseFloat(credit.limit) >= Number.parseFloat(amount),
        limit: credit.limit,
        symbol: credit.symbol,
      };
    },
  };
}

export type Polaris = ReturnType<typeof createPolaris>;
