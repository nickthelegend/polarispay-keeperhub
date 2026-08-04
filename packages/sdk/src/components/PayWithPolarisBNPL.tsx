'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { BrowserProvider, Contract, formatUnits, parseUnits } from 'ethers';

/**
 * Drop-in BNPL checkout for the Polaris LoanEngine.
 *
 * The buyer does exactly one on-chain action: a single ERC-20 approval for the
 * full repayment amount. That approval is what every later instalment is drawn
 * against, and it is the reason a keeper can collect on schedule without the
 * buyer ever coming back. Nothing is escrowed and no funds move at checkout --
 * the buyer keeps their balance and can revoke the approval at any time.
 *
 * Opening the plan is a server call, because `createLoan` is originator-gated:
 * the merchant's backend signs it, not the buyer. The buyer therefore pays no
 * gas to start a plan.
 *
 */

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const SCORE_ABI = [
  'function scoreOf(address) view returns (uint16)',
  'function creditLimitOf(address) view returns (uint256)',
];

/** Public Sepolia deployment. Override for your own. */
export const POLARIS_SEPOLIA = {
  chainId: 11155111,
  loanEngine: '0x5d6F049f791C40b09701129b3663d1A8ce9eAB86',
  stablecoin: '0x49C86277a91002c4943837bf20F6ED41976Db09F',
  scoreManager: '0x13C5af8f4c6E7f3b26998451Cf4FD65a6Ca268e2',
};

export interface PayWithPolarisBNPLProps {
  /** Merchant API key, forwarded to your backend to authorise the plan. */
  apiKey: string;
  /** Your endpoint that calls createLoan. Defaults to /api/checkout. */
  endpoint?: string;
  /** Order total in human units, e.g. "200.00". */
  amount: string;
  orderId: string;
  installments?: number;
  intervalSeconds?: number;
  chainId?: number;
  contracts?: { loanEngine: string; stablecoin: string; scoreManager: string };
  onSuccess?: (result: { loanId?: string; transactionHash?: string }) => void;
  onError?: (message: string) => void;
}

type Phase =
  | 'idle'
  | 'connecting'
  | 'checking'
  | 'approving'
  | 'opening'
  | 'done'
  | 'error';

export function PayWithPolarisBNPL({
  apiKey,
  endpoint = '/api/checkout',
  amount,
  orderId,
  installments = 4,
  intervalSeconds = 14 * 24 * 60 * 60,
  chainId = POLARIS_SEPOLIA.chainId,
  contracts = POLARIS_SEPOLIA,
  onSuccess,
  onError,
}: PayWithPolarisBNPLProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [account, setAccount] = useState<string>();
  const [credit, setCredit] = useState<{
    score: number;
    limit: string;
    symbol: string;
    eligible: boolean;
  }>();

  const perInstallment = useMemo(() => {
    const n = Number.parseFloat(amount);
    return Number.isFinite(n) ? (n / installments).toFixed(2) : '--';
  }, [amount, installments]);

  const fail = useCallback(
    (msg: string) => {
      setPhase('error');
      setMessage(msg);
      onError?.(msg);
    },
    [onError]
  );

  const connect = useCallback(async () => {
    const eth = (globalThis as { ethereum?: any }).ethereum;
    if (!eth) {
      fail('No wallet found. Install a browser wallet to pay with Polaris.');
      return;
    }
    try {
      setPhase('connecting');
      setMessage('Connecting your wallet...');
      const provider = new BrowserProvider(eth);
      const [address] = await provider.send('eth_requestAccounts', []);
      setAccount(address);

      const net = await provider.getNetwork();
      if (net.chainId !== BigInt(chainId)) {
        await provider.send('wallet_switchEthereumChain', [
          { chainId: `0x${chainId.toString(16)}` },
        ]);
      }

      // Read the buyer's standing before offering the plan, so an ineligible
      // buyer is told why rather than hitting a revert at origination.
      setPhase('checking');
      setMessage('Checking your credit line...');
      const scores = new Contract(contracts.scoreManager, SCORE_ABI, provider);
      const token = new Contract(contracts.stablecoin, ERC20_ABI, provider);
      const [score, limitRaw, decimals, symbol] = await Promise.all([
        scores.scoreOf(address),
        scores.creditLimitOf(address),
        token.decimals(),
        token.symbol(),
      ]);

      const eligible = limitRaw >= parseUnits(amount, decimals);
      setCredit({
        score: Number(score),
        limit: formatUnits(limitRaw, decimals),
        symbol,
        eligible,
      });
      setPhase('idle');
      setMessage(
        eligible
          ? ''
          : `This order is above your current limit of ${formatUnits(limitRaw, decimals)} ${symbol}. Paying instalments on time raises it.`
      );
    } catch (err) {
      fail(readableError(err));
    }
  }, [amount, chainId, contracts, fail]);

  const pay = useCallback(async () => {
    const eth = (globalThis as { ethereum?: any }).ethereum;
    if (!eth || !account) return;
    try {
      const provider = new BrowserProvider(eth);
      const signer = await provider.getSigner();
      const token = new Contract(contracts.stablecoin, ERC20_ABI, signer);
      const decimals = await token.decimals();

      // Approve slightly above the order total to cover accrued interest. This
      // is an allowance, not a transfer: nothing leaves the wallet until an
      // instalment is actually due.
      const total = parseUnits(amount, decimals);
      const withInterest = (total * 105n) / 100n;

      const current: bigint = await token.allowance(account, contracts.loanEngine);
      if (current < withInterest) {
        setPhase('approving');
        setMessage('Approve the repayment allowance in your wallet...');
        const tx = await token.approve(contracts.loanEngine, withInterest);
        await tx.wait();
      }

      setPhase('opening');
      setMessage('Opening your payment plan...');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          borrower: account,
          amount,
          orderId,
          installments,
          intervalSeconds,
          chainId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Could not open the plan (${res.status})`);
      }
      const result = await res.json();

      setPhase('done');
      setMessage(`Plan open. Instalments of ${perInstallment} are collected automatically.`);
      onSuccess?.(result);
    } catch (err) {
      fail(readableError(err));
    }
  }, [
    account,
    amount,
    apiKey,
    chainId,
    contracts,
    endpoint,
    installments,
    intervalSeconds,
    onSuccess,
    orderId,
    perInstallment,
    fail,
  ]);

  const busy =
    phase === 'connecting' || phase === 'checking' || phase === 'approving' || phase === 'opening';

  return (
    <div style={S.root}>
      <div style={S.head}>
        <span style={S.label}>Pay in {installments}</span>
        <span style={S.total}>
          {perInstallment}
          <span style={S.per}> x {installments}</span>
        </span>
      </div>

      <p style={S.sub}>
        {amount} total. Nothing is locked up front -- instalments are collected from your wallet on
        schedule, and you can revoke the allowance at any time.
      </p>

      {credit && (
        <div style={S.credit}>
          Polaris score {credit.score}
          <span style={S.dot}>·</span>
          {credit.limit} {credit.symbol} limit
        </div>
      )}

      <button
        onClick={account ? pay : connect}
        disabled={busy || phase === 'done' || credit?.eligible === false}
        style={{ ...S.button, opacity: busy || credit?.eligible === false ? 0.6 : 1 }}
      >
        {phase === 'done'
          ? 'Plan open'
          : busy
            ? message || 'Working...'
            : account
              ? `Pay ${perInstallment} now`
              : 'Continue with Polaris'}
      </button>

      {message && !busy && (
        <p style={phase === 'error' ? S.error : phase === 'done' ? S.success : S.status}>
          {message}
        </p>
      )}
    </div>
  );
}

/** Turn wallet and RPC noise into something a buyer can act on. */
function readableError(err: unknown): string {
  const raw =
    (err as { shortMessage?: string })?.shortMessage ?? (err as Error)?.message ?? String(err);
  if (/user rejected|user denied/i.test(raw)) return 'You cancelled the request.';
  if (/insufficient funds/i.test(raw)) return 'Not enough ETH to cover the network fee.';
  if (/unrecognized chain/i.test(raw)) return 'Add the network to your wallet, then try again.';
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
}

const S: Record<string, React.CSSProperties> = {
  root: {
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: 20,
    background: 'rgba(255,255,255,0.02)',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 380,
  },
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' },
  label: {
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
  },
  total: { fontSize: 28, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' },
  per: { fontSize: 14, color: 'rgba(255,255,255,0.45)' },
  sub: { marginTop: 10, fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,0.5)' },
  credit: {
    marginTop: 14,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    fontVariantNumeric: 'tabular-nums',
  },
  dot: { margin: '0 8px', color: 'rgba(255,255,255,0.25)' },
  button: {
    marginTop: 18,
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#A6F24A',
    color: '#000',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  status: { marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  error: { marginTop: 12, fontSize: 12, color: '#fda4af' },
  success: { marginTop: 12, fontSize: 12, color: '#A6F24A' },
};

export default PayWithPolarisBNPL;
