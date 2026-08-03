'use client';

import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { useWallets } from '@privy-io/react-auth';
import { BarChart3, Receipt, Clock, Lock, ShieldCheck, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';
import ConfidentialMerchantEscrow from '@/lib/abis/ConfidentialMerchantEscrow.json';
import { getCoFHEClient, decryptView } from '@/lib/cofhe';
import { FheTypes } from '@cofhe/sdk';
import { txPending, txSubmitted, txError } from '@/lib/tx-toast';

const ESCROW = process.env.NEXT_PUBLIC_CONF_MERCHANT_ESCROW || '';

interface Tx {
  amount: number;
  asset: string;
  status: string;
  tx_hash: string | null;
  created_at: string;
  paid_at: string | null;
}

export default function MerchantAnalytics({ transactions, walletAddress }: { transactions: Tx[]; walletAddress?: string }) {
  const { wallets } = useWallets();
  const wallet = wallets[0];

  const [onchain, setOnchain] = useState<{ registered: boolean; payments: number; lastPayment: number } | null>(null);
  const [registering, setRegistering] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [received, setReceived] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Off-chain (MongoDB bills) analytics — the merchant's own data (they know their prices).
  const stats = useMemo(() => {
    const paid = transactions.filter((t) => t.status === 'paid');
    const pending = transactions.filter((t) => t.status === 'pending');
    const revenue = paid.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    return { paidCount: paid.length, pendingCount: pending.length, revenue, recent: transactions.slice(0, 6) };
  }, [transactions]);

  const getProvider = async () => {
    if (!wallet) throw new Error('Connect your wallet');
    return new ethers.BrowserProvider(await wallet.getEthereumProvider());
  };

  const loadOnchain = async () => {
    if (!ESCROW || !walletAddress || !wallet) return;
    setLoading(true);
    try {
      const provider = await getProvider();
      const escrow = new ethers.Contract(ESCROW, ConfidentialMerchantEscrow as any, provider);
      const [registered, payments, lastPayment] = await escrow.getMerchantStats(walletAddress);
      setOnchain({ registered, payments: Number(payments), lastPayment: Number(lastPayment) });
    } catch (e) {
      // escrow not deployed / not on Sepolia — leave onchain null
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOnchain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, wallet?.address]);

  const register = async () => {
    setRegistering(true);
    const id = txPending('Registering as a confidential merchant…');
    try {
      const signer = await (await getProvider()).getSigner();
      const escrow = new ethers.Contract(ESCROW, ConfidentialMerchantEscrow as any, signer);
      const hash = (await (await escrow.registerMerchant()).wait()).hash;
      txSubmitted(hash, 'Registered for confidential payments', id);
      await loadOnchain();
    } catch (e) {
      txError(e, id);
    } finally {
      setRegistering(false);
    }
  };

  const decryptTotal = async () => {
    setDecrypting(true);
    try {
      const signer = await (await getProvider()).getSigner();
      const client = await getCoFHEClient(signer);
      const escrow = new ethers.Contract(ESCROW, ConfidentialMerchantEscrow as any, signer);
      const handle = await escrow.getReceived(walletAddress);
      const ZERO = '0x' + '0'.repeat(64);
      if (!handle || handle === ZERO) { setReceived('0.00'); return; }
      const val = await decryptView(client, BigInt(handle), FheTypes.Uint64);
      setReceived((Number(val) / 1e6).toFixed(2));
    } catch (e) {
      txError(e);
    } finally {
      setDecrypting(false);
    }
  };

  const fmtDate = (d: string) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-teal-400" />
          <h3 className="text-sm font-black uppercase tracking-tighter">Store Analytics</h3>
        </div>
        <button onClick={loadOnchain} disabled={loading} className="text-white/40 hover:text-white transition-colors">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Receipt className="w-4 h-4 text-teal-400" />} label="Payments" value={String(onchain?.payments ?? stats.paidCount)} sub="settled" />
        <StatCard icon={<BarChart3 className="w-4 h-4 text-teal-400" />} label="Revenue" value={`$${stats.revenue.toFixed(2)}`} sub="from your bills" />
        <StatCard icon={<Clock className="w-4 h-4 text-yellow-400" />} label="Pending" value={String(stats.pendingCount)} sub="awaiting" />
        <StatCard
          icon={<Lock className="w-4 h-4 text-teal-400" />}
          label="On-chain (enc.)"
          value={received !== null ? `$${received}` : '••••'}
          sub={received !== null ? 'decrypted' : 'encrypted'}
        />
      </div>

      {/* Confidential controls */}
      <div className="flex flex-wrap items-center gap-3">
        {ESCROW ? (
          onchain?.registered ? (
            <span className="flex items-center gap-2 text-[11px] font-bold text-teal-400 bg-teal-500/10 border border-teal-500/20 px-3 py-1.5 rounded">
              <CheckCircle2 className="w-3.5 h-3.5" /> Registered for confidential payments
            </span>
          ) : (
            <button
              onClick={register}
              disabled={registering}
              className="flex items-center gap-2 bg-teal-500 text-black font-black uppercase text-[11px] tracking-tighter px-4 py-2 rounded disabled:opacity-50"
            >
              {registering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Register for confidential payments
            </button>
          )
        ) : (
          <span className="text-[11px] text-white/30">Confidential escrow not configured (set NEXT_PUBLIC_CONF_MERCHANT_ESCROW).</span>
        )}
        {ESCROW && onchain?.registered && (
          <button
            onClick={decryptTotal}
            disabled={decrypting}
            className="flex items-center gap-2 bg-white/5 border border-white/10 text-white font-bold uppercase text-[11px] tracking-tighter px-4 py-2 rounded hover:bg-white/10 disabled:opacity-50"
          >
            {decrypting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
            Decrypt total received
          </button>
        )}
      </div>

      {/* Recent payments */}
      <div>
        <div className="text-[10px] uppercase font-bold text-white/30 tracking-widest mb-2">Recent Payments</div>
        {stats.recent.length === 0 ? (
          <div className="text-[11px] text-white/30 py-4 text-center border border-dashed border-white/5 rounded">No payments yet</div>
        ) : (
          <div className="divide-y divide-white/5">
            {stats.recent.map((t, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 text-xs">
                <div className="flex items-center gap-3">
                  <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'paid' ? 'bg-teal-400' : 'bg-yellow-400'}`} />
                  <span className="font-bold">${Number(t.amount).toFixed(2)} {t.asset || 'cUSDC'}</span>
                  <span className="text-white/30 uppercase text-[10px]">{t.status}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-white/30">{fmtDate(t.paid_at || t.created_at)}</span>
                  {t.tx_hash && (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${t.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal-400 hover:text-teal-300 font-mono text-[10px]"
                    >
                      {t.tx_hash.slice(0, 8)}… ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="bg-black/30 border border-white/5 rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-2">{icon}<span className="text-[9px] uppercase font-bold text-white/40 tracking-widest">{label}</span></div>
      <div className="text-xl font-black tracking-tight">{value}</div>
      <div className="text-[9px] text-white/30 uppercase tracking-widest mt-0.5">{sub}</div>
    </div>
  );
}
