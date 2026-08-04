'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserProvider, Contract, formatUnits, parseUnits } from 'ethers';

import { useWallet } from '@/components/WalletProvider';

/**
 * A real storefront on the live contracts.
 *
 * The point of this page is to be the actual buyer journey, not a mock of one:
 * connect a wallet, have the chain tell you what you can afford, approve once,
 * and open a plan the keeper then collects on schedule. Every number on screen
 * is read from Sepolia and every button sends a real transaction.
 */

const CHAIN_ID = 11155111;
const CONTRACTS = {
  stablecoin: '0x49C86277a91002c4943837bf20F6ED41976Db09F',
  loanEngine: '0x5d6F049f791C40b09701129b3663d1A8ce9eAB86',
  scoreManager: '0x13C5af8f4c6E7f3b26998451Cf4FD65a6Ca268e2',
  payments: '0x3BD1609abDC915eA9e01A399a26e2B8A2a06243f',
};

const ERC20 = [
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function faucet()',
];
const SCORES = [
  'function scoreOf(address) view returns (uint16)',
  'function creditLimitOf(address) view returns (uint256)',
];
const PAYMENTS = ['function pay(address,uint256,string) returns (bytes32)'];

type Product = { id: string; name: string; blurb: string; price: number };

const CATALOGUE: Product[] = [
  { id: 'SKU-KEYS', name: 'Mechanical keyboard', blurb: 'Hot-swap, tactile', price: 180 },
  { id: 'SKU-CANS', name: 'Studio headphones', blurb: 'Closed-back, 250Ω', price: 240 },
  { id: 'SKU-DESK', name: 'Standing desk', blurb: 'Electric, 120×70', price: 420 },
];

type Wallet = {
  address: string;
  balance: string;
  symbol: string;
  score: number;
  limit: string;
};

export default function Store() {
  const { address, connect, connecting, getProvider } = useWallet();
  const [wallet, setWallet] = useState<Wallet>();
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<{ kind: 'ok' | 'err' | 'info'; text: string; url?: string }>();
  const [selected, setSelected] = useState<Product>(CATALOGUE[0]!);
  const [mode, setMode] = useState<'now' | 'later'>('later');

  const perInstalment = useMemo(() => (selected.price / 4).toFixed(2), [selected]);

  const readWallet = useCallback(async (address: string, provider: BrowserProvider) => {
    const token = new Contract(CONTRACTS.stablecoin, ERC20, provider);
    const scores = new Contract(CONTRACTS.scoreManager, SCORES, provider);
    const [decimals, symbol, balance, score, limit] = await Promise.all([
      token.decimals(),
      token.symbol(),
      token.balanceOf(address),
      scores.scoreOf(address),
      scores.creditLimitOf(address),
    ]);
    setWallet({
      address,
      // formatUnits gives full precision, which renders a balance as
      // "9789145.412883" -- technically right and unreadable. Money is shown
      // the way money is written.
      balance: money(formatUnits(balance, decimals)),
      symbol,
      score: Number(score),
      limit: money(formatUnits(limit, decimals)),
    });
  }, []);

  // Whatever the connected address is -- connected here, connected from the
  // header, or switched in the wallet itself -- the panel re-reads the chain for
  // it. Account switching mid-session is the case that otherwise silently shows
  // one address's credit next to another address's balance.
  useEffect(() => {
    if (!address) {
      setWallet(undefined);
      return;
    }
    const provider = getProvider();
    if (!provider) return;
    let live = true;
    readWallet(address, provider).catch((err) => {
      if (live) setNote({ kind: 'err', text: readable(err) });
    });
    return () => {
      live = false;
    };
  }, [address, getProvider, readWallet]);

  /** Test tokens, so the flow is reachable without asking anyone for funds. */
  const claim = useCallback(async () => {
    const provider = getProvider();
    if (!provider || !wallet) return;
    try {
      setBusy('faucet');
      const signer = await provider.getSigner();
      const tx = await new Contract(CONTRACTS.stablecoin, ERC20, signer).faucet();
      await tx.wait();
      await readWallet(wallet.address, provider);
      setNote({ kind: 'ok', text: 'Claimed 1,000 test tokens.', url: explorer(tx.hash) });
    } catch (err) {
      setNote({ kind: 'err', text: readable(err) });
    } finally {
      setBusy(undefined);
    }
  }, [wallet, readWallet]);

  const buy = useCallback(async () => {
    const provider = getProvider();
    if (!provider || !wallet) return;
    const orderId = `${selected.id}-${Date.now()}`;

    try {
      const signer = await provider.getSigner();
      const token = new Contract(CONTRACTS.stablecoin, ERC20, signer);
      const decimals = await token.decimals();
      const total = parseUnits(String(selected.price), decimals);

      if (mode === 'now') {
        setBusy('buy');
        setNote({ kind: 'info', text: 'Approving the payment…' });
        if ((await token.allowance(wallet.address, CONTRACTS.payments)) < total) {
          await (await token.approve(CONTRACTS.payments, total)).wait();
        }
        setNote({ kind: 'info', text: 'Paying the merchant…' });
        const tx = await new Contract(CONTRACTS.payments, PAYMENTS, signer).pay(
          await merchantAddress(),
          total,
          orderId
        );
        await tx.wait();
        await readWallet(wallet.address, provider);
        setNote({ kind: 'ok', text: `Paid ${selected.price} in full.`, url: explorer(tx.hash) });
        return;
      }

      // Pay later. The buyer's only on-chain action is one approval covering
      // the full repayment; the plan itself is opened by the merchant's
      // backend, because createLoan is originator-gated on chain.
      setBusy('buy');
      const withInterest = (total * 110n) / 100n;
      if ((await token.allowance(wallet.address, CONTRACTS.loanEngine)) < withInterest) {
        setNote({ kind: 'info', text: 'Approve the repayment allowance in your wallet…' });
        await (await token.approve(CONTRACTS.loanEngine, withInterest)).wait();
      }

      setNote({ kind: 'info', text: 'Opening your payment plan…' });
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'demo' },
        body: JSON.stringify({
          borrower: wallet.address,
          amount: String(selected.price),
          orderId,
          installments: 4,
          // The engine enforces a one-hour floor -- the guard that closed the
          // intervalSeconds=0 exploit, where a loan was interest-free and due
          // in full at origination. Hourly is the shortest demonstrable term.
          intervalSeconds: 3600,
          chainId: CHAIN_ID,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Checkout failed (${res.status})`);

      await readWallet(wallet.address, provider);
      setNote({
        kind: 'ok',
        text: `Plan open — loan #${body.loanId}. Instalments of ${perInstalment} are collected automatically.`,
        url: body.transactionHash ? explorer(body.transactionHash) : undefined,
      });
    } catch (err) {
      setNote({ kind: 'err', text: readable(err) });
    } finally {
      setBusy(undefined);
    }
  }, [wallet, selected, mode, perInstalment, readWallet]);

  const affordable = wallet
    ? Number.parseFloat(wallet.limit.replace(/,/g, '')) >= selected.price
    : true;

  return (
    <div className="min-h-screen bg-background font-display text-foreground">
      <main className="mx-auto max-w-[1000px] px-6 py-14 md:px-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
          Demo store · live Sepolia
        </p>
        <h1 className="mt-3 text-[2rem] font-semibold leading-tight tracking-[-0.02em]">
          Buy something on credit
        </h1>
        <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-white/50">
          Real contracts, real transactions. Pay in full, or split into four —
          nothing is locked up front and instalments collect themselves.
        </p>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          {CATALOGUE.map((p) => {
            const active = p.id === selected.id;
            return (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                aria-pressed={active}
                className={`rounded-lg border p-5 text-left transition-colors ${
                  active
                    ? 'border-primary/60 bg-primary/[0.06]'
                    : 'border-white/10 hover:border-white/25'
                }`}
              >
                <p className="text-sm font-medium text-white/90">{p.name}</p>
                <p className="mt-1 text-[13px] text-white/45">{p.blurb}</p>
                <p className="mt-4 font-mono text-xl tabular-nums text-white">
                  {p.price.toFixed(2)}
                </p>
                <p className="mt-1 font-mono text-[11px] text-white/40">
                  or {(p.price / 4).toFixed(2)} × 4
                </p>
              </button>
            );
          })}
        </section>

        <section className="mt-10 border-t border-white/10 pt-8">
          {!wallet ? (
            <div>
              <button
                onClick={connect}
                disabled={connecting}
                className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-black transition-transform hover:-translate-y-px disabled:opacity-60"
              >
                {connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
              <p className="mt-3 font-mono text-[11px] text-white/40">
                Sepolia. Your balance and credit limit are read from chain once connected.
              </p>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
                <Figure label="Wallet" value={`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`} mono />
                <Figure label="Balance" value={`${wallet.balance} ${wallet.symbol}`} mono />
                <Figure label="Polaris score" value={String(wallet.score)} mono />
                <Figure label="Credit limit" value={wallet.limit} mono />
              </dl>

              <div className="mt-8 flex flex-wrap items-center gap-2">
                {(['later', 'now'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={`rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                      mode === m ? 'bg-primary text-black' : 'text-white/50 hover:bg-white/5'
                    }`}
                  >
                    {m === 'later' ? `Pay ${perInstalment} × 4` : 'Pay in full'}
                  </button>
                ))}
              </div>

              {mode === 'later' && !affordable && (
                <p className="mt-4 text-[13px] text-amber-300">
                  {selected.name} is above your {wallet.limit} {wallet.symbol} limit. Lock collateral to raise it,
                  or pay in full.
                </p>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={buy}
                  disabled={Boolean(busy) || (mode === 'later' && !affordable)}
                  className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-black transition-transform hover:-translate-y-px disabled:opacity-50"
                >
                  {busy === 'buy'
                    ? 'Working…'
                    : mode === 'later'
                      ? `Pay ${perInstalment} now, rest later`
                      : `Pay ${selected.price.toFixed(2)} now`}
                </button>
                <button
                  onClick={claim}
                  disabled={Boolean(busy)}
                  className="rounded-lg border border-white/15 px-5 py-3 text-sm text-white/70 transition-colors hover:border-white/30 disabled:opacity-50"
                >
                  {busy === 'faucet' ? 'Claiming…' : 'Get test tokens'}
                </button>
              </div>
            </>
          )}

          {note && (
            <p
              className={`mt-5 text-[13px] ${
                note.kind === 'err'
                  ? 'text-rose-300'
                  : note.kind === 'ok'
                    ? 'text-primary'
                    : 'text-white/55'
              }`}
            >
              {note.text}{' '}
              {note.url && (
                <a
                  href={note.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  View transaction
                </a>
              )}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

function Figure({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</dt>
      <dd className={`mt-1.5 text-white/90 ${mono ? 'font-mono tabular-nums text-sm' : 'text-sm'}`}>
        {value}
      </dd>
    </div>
  );
}

const explorer = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

/** Two decimals, thousands separated. */
function money(raw: string): string {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : raw;
}

async function merchantAddress(): Promise<string> {
  const res = await fetch('/api/merchant/address');
  if (res.ok) {
    const body = await res.json();
    if (body.address) return body.address;
  }
  // Burn address, so a misconfigured demo cannot silently pay the wrong party.
  return '0x000000000000000000000000000000000000dEaD';
}

function readable(err: unknown): string {
  const raw =
    (err as { shortMessage?: string })?.shortMessage ?? (err as Error)?.message ?? String(err);
  if (/user rejected|user denied/i.test(raw)) return 'You cancelled the request.';
  if (/insufficient funds/i.test(raw)) return 'Not enough Sepolia ETH for the network fee.';
  if (/ExceedsCreditLimit/i.test(raw)) return 'This order is above your credit limit.';
  if (/DuplicatePayment/i.test(raw)) return 'This order has already been paid.';
  if (/FaucetCooldown/i.test(raw)) return 'The faucet allows one claim per hour.';
  if (/InsufficientAllowance/i.test(raw)) return 'Approve the allowance first, then try again.';
  return raw.length > 150 ? `${raw.slice(0, 147)}…` : raw;
}
