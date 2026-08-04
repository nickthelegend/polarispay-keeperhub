'use client';

export const dynamic = 'force-dynamic';

import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ArrowUpRight, Loader2 } from 'lucide-react';

type Plan = {
    loanId: string;
    orderId: string;
    borrower: string;
    status: 'active' | 'repaid' | 'liquidated' | 'defaulted';
    principalDisplay: string;
    outstandingDisplay: string;
    installmentsPaid: number;
    installmentCount: number;
    nextDueAt: string | null;
    state: 'scheduled' | 'dunning' | 'paid' | 'written_off';
    attempts: number;
    lastTxHash?: string;
};

type Overview = {
    settledDisplay: string;
    outstandingDisplay: string;
    atRiskDisplay: string;
    collectedThisWeekDisplay: string;
    activePlans: number;
    dunningPlans: number;
    collectionRate: number;
    plans: Plan[];
};

const fetcher = (wallet: string) => async (url: string) => {
    const res = await fetch(url, { headers: { 'x-wallet-address': wallet } });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
};

export default function Dashboard() {
    const { user, authenticated, login, ready } = usePrivy();
    const wallet = user?.wallet?.address ?? '';
    const [filter, setFilter] = useState<'all' | 'collecting' | 'dunning' | 'closed'>('all');

    useEffect(() => {
        if (authenticated && wallet) {
            fetch('/api/auth/sync', {
                method: 'POST',
                body: JSON.stringify({ wallet_address: wallet, email: user?.email?.address }),
            }).catch(() => undefined);
        }
    }, [authenticated, wallet, user]);

    const { data, error, isLoading } = useSWR<Overview>(
        authenticated && wallet ? '/api/merchant/overview' : null,
        fetcher(wallet),
        { refreshInterval: 20_000 }
    );

    const plans = useMemo(() => {
        const all = data?.plans ?? [];
        if (filter === 'collecting') return all.filter((p) => p.status === 'active' && p.state !== 'dunning');
        if (filter === 'dunning') return all.filter((p) => p.state === 'dunning');
        if (filter === 'closed') return all.filter((p) => p.status !== 'active');
        return all;
    }, [data, filter]);

    if (!ready) return null;

    if (!authenticated) return <SignIn onSignIn={login} />;

    return (
        <div className="min-h-screen bg-background text-foreground font-display selection:bg-primary/25">
            <main className="mx-auto max-w-[1180px] px-6 py-14 md:px-10">
                <Ledger
                    data={data}
                    error={error}
                    isLoading={isLoading}
                    plans={plans}
                    filter={filter}
                    onFilter={setFilter}
                />
            </main>
        </div>
    );
}

/* ------------------------------------------------------------------ */

export function Ledger({
    data,
    error,
    isLoading,
    plans,
    filter,
    onFilter,
}: {
    data?: Overview;
    error?: Error;
    isLoading: boolean;
    plans: Plan[];
    filter: string;
    onFilter: (f: 'all' | 'collecting' | 'dunning' | 'closed') => void;
}) {
    if (error) return <ErrorState message={error.message} />;

    return (
        <>
            {/* The one number a merchant opens this page for: what is still owed to
                them. Everything else is context ruled off beneath it. */}
            <header className="border-b border-white/10 pb-10">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
                    Outstanding across active plans
                </p>
                <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
                    <span className="font-mono text-[clamp(2.75rem,7vw,4.5rem)] font-medium leading-none tabular-nums tracking-[-0.03em]">
                        {isLoading ? <Skeleton w="9ch" /> : data?.outstandingDisplay ?? '0.00'}
                    </span>
                    <span className="font-mono text-lg text-white/45">USDC</span>
                </div>

                <dl className="mt-9 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
                    <Figure label="Settled to you" value={data?.settledDisplay} loading={isLoading} />
                    <Figure label="Collected this week" value={data?.collectedThisWeekDisplay} loading={isLoading} />
                    <Figure label="At risk" value={data?.atRiskDisplay} loading={isLoading} tone="warn" />
                    <Figure
                        label="Collection rate"
                        value={data ? `${data.collectionRate.toFixed(1)}%` : undefined}
                        loading={isLoading}
                    />
                </dl>
            </header>

            <KeeperStrip />

            <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-lg font-semibold tracking-tight">Payment plans</h2>
                <nav className="flex items-center gap-1" aria-label="Filter plans">
                    {(['all', 'collecting', 'dunning', 'closed'] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => onFilter(f)}
                            aria-pressed={filter === f}
                            className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                                filter === f
                                    ? 'bg-primary text-black'
                                    : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </nav>
            </div>

            <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-white/10 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                            <th className="pb-3 pr-4 font-normal">Order</th>
                            <th className="pb-3 pr-4 font-normal">Borrower</th>
                            <th className="pb-3 pr-4 text-right font-normal">Plan</th>
                            <th className="pb-3 pr-4 text-right font-normal">Outstanding</th>
                            <th className="pb-3 pr-4 font-normal">Next collection</th>
                            <th className="pb-3 font-normal">State</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            [0, 1, 2, 3, 4].map((i) => <RowSkeleton key={i} />)
                        ) : plans.length === 0 ? (
                            <tr>
                                <td colSpan={6}>
                                    <EmptyState filter={filter} />
                                </td>
                            </tr>
                        ) : (
                            plans.map((p) => <PlanRow key={p.loanId} plan={p} />)
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

type Health = {
    status: 'healthy' | 'degraded' | 'down' | 'unknown';
    jobs: Array<{ job: string; status: string; minutesSinceLastRun: number | null }>;
    incidents: string[];
};

/**
 * Whether anything is collecting right now.
 *
 * A merchant's real question is not "is the API up" but "is my money being
 * chased". Silence is the failure that costs the most, so a stopped keeper has
 * to be visible here rather than simply showing nothing.
 */
function KeeperStrip() {
    const { data } = useSWR<Health>('/api/keeper/health', (u: string) => fetch(u).then((r) => r.json()), {
        refreshInterval: 30_000,
    });
    if (!data?.jobs) return null;

    const tone = {
        healthy: 'text-primary',
        degraded: 'text-amber-300',
        down: 'text-rose-300',
        unknown: 'text-white/35',
    }[data.status];

    const label = {
        healthy: 'Collections running',
        degraded: 'Collections degraded',
        down: 'Collections stopped',
        unknown: 'No keeper activity yet',
    }[data.status];

    const collection = data.jobs.find((j) => j.job === 'collection');
    const ago =
        collection?.minutesSinceLastRun === null || collection?.minutesSinceLastRun === undefined
            ? null
            : collection.minutesSinceLastRun < 1
              ? 'just now'
              : `${collection.minutesSinceLastRun}m ago`;

    return (
        <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-white/[0.06] pt-5">
            <span className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] ${tone}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {label}
            </span>
            {ago && <span className="font-mono text-[11px] text-white/35">last pass {ago}</span>}
            {data.incidents.length > 0 && (
                <span className="font-mono text-[11px] text-amber-300/80">{data.incidents[0]}</span>
            )}
        </div>
    );
}

function PlanRow({ plan }: { plan: Plan }) {
    const progress = plan.installmentCount === 0 ? 0 : plan.installmentsPaid / plan.installmentCount;

    return (
        <tr className="group border-b border-white/[0.06] transition-colors hover:bg-white/[0.025]">
            <td className="py-4 pr-4">
                <span className="font-mono text-[13px] text-white/85">{plan.orderId}</span>
            </td>
            <td className="py-4 pr-4">
                <span className="font-mono text-[13px] text-white/55">
                    {plan.borrower.slice(0, 6)}&hellip;{plan.borrower.slice(-4)}
                </span>
            </td>
            <td className="py-4 pr-4 text-right">
                {/* Installment progress reads as discrete ticks because the count is
                    small and exact -- "3 of 4 collected", not an approximate bar. */}
                <span className="inline-flex items-center gap-[3px] align-middle" aria-hidden>
                    {Array.from({ length: plan.installmentCount }).map((_, i) => (
                        <span
                            key={i}
                            className={`h-3.5 w-[3px] rounded-full ${
                                i < plan.installmentsPaid ? 'bg-primary' : 'bg-white/15'
                            }`}
                        />
                    ))}
                </span>
                <span className="ml-2.5 font-mono text-[13px] tabular-nums text-white/55">
                    {plan.installmentsPaid}/{plan.installmentCount}
                </span>
                <span className="sr-only">
                    {plan.installmentsPaid} of {plan.installmentCount} installments collected
                </span>
            </td>
            <td className="py-4 pr-4 text-right font-mono text-[13px] tabular-nums text-white/85">
                {plan.outstandingDisplay}
            </td>
            <td className="py-4 pr-4 font-mono text-[13px] text-white/55">
                {plan.nextDueAt ? formatDue(plan.nextDueAt) : <span className="text-white/25">&mdash;</span>}
            </td>
            <td className="py-4">
                <div className="flex items-center justify-between gap-3">
                    <StateBadge plan={plan} />
                    {plan.lastTxHash && (
                        <a
                            href={`https://sepolia.etherscan.io/tx/${plan.lastTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                            aria-label={`View last transaction for order ${plan.orderId} on Basescan`}
                        >
                            <ArrowUpRight className="h-3.5 w-3.5 text-white/40 hover:text-primary" />
                        </a>
                    )}
                </div>
            </td>
        </tr>
    );
}

function StateBadge({ plan }: { plan: Plan }) {
    if (plan.status === 'liquidated' || plan.status === 'defaulted') {
        return <Badge tone="danger">Liquidated</Badge>;
    }
    if (plan.status === 'repaid') return <Badge tone="muted">Repaid</Badge>;
    if (plan.state === 'dunning') {
        return <Badge tone="warn">Retry {plan.attempts}</Badge>;
    }
    return <Badge tone="live">Collecting</Badge>;
}

function Badge({ tone, children }: { tone: 'live' | 'warn' | 'danger' | 'muted'; children: React.ReactNode }) {
    const tones = {
        // Lime is reserved for "the keeper is actively working this plan".
        live: 'text-primary before:bg-primary',
        warn: 'text-amber-300 before:bg-amber-300',
        danger: 'text-rose-300 before:bg-rose-300',
        muted: 'text-white/40 before:bg-white/30',
    } as const;

    return (
        <span
            className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] before:h-1.5 before:w-1.5 before:rounded-full before:content-[''] ${tones[tone]}`}
        >
            {children}
        </span>
    );
}

function Figure({
    label,
    value,
    loading,
    tone,
}: {
    label: string;
    value?: string;
    loading: boolean;
    tone?: 'warn';
}) {
    return (
        <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</dt>
            <dd
                className={`mt-2 font-mono text-xl tabular-nums tracking-tight ${
                    tone === 'warn' ? 'text-amber-300' : 'text-white/90'
                }`}
            >
                {loading ? <Skeleton w="6ch" /> : value ?? '—'}
            </dd>
        </div>
    );
}

function EmptyState({ filter }: { filter: string }) {
    const copy: Record<string, { head: string; body: string }> = {
        all: {
            head: 'No payment plans yet',
            body: 'Plans appear here the moment a customer splits a purchase at your checkout. Each one is collected automatically.',
        },
        collecting: { head: 'Nothing collecting right now', body: 'Every active plan is either paid up or in retry.' },
        dunning: { head: 'No plans in retry', body: 'Every installment has collected on the first attempt.' },
        closed: { head: 'No closed plans', body: 'Repaid and liquidated plans are kept here for your records.' },
    };
    const { head, body } = copy[filter] ?? copy.all;

    return (
        <div className="py-20 text-center">
            <p className="text-base font-medium text-white/85">{head}</p>
            <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-white/45">{body}</p>
        </div>
    );
}

function ErrorState({ message }: { message: string }) {
    return (
        <div className="rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-6">
            <p className="text-sm font-medium text-rose-200">We could not load your plans</p>
            <p className="mt-1.5 font-mono text-[13px] text-rose-200/70">{message}</p>
            <button
                onClick={() => location.reload()}
                className="mt-4 rounded-md border border-rose-300/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-rose-100 transition-colors hover:bg-rose-400/10"
            >
                Try again
            </button>
        </div>
    );
}

function Skeleton({ w }: { w: string }) {
    return (
        <span
            className="inline-block h-[0.75em] animate-pulse rounded bg-white/10 align-middle"
            style={{ width: w }}
        />
    );
}

function RowSkeleton() {
    return (
        <tr className="border-b border-white/[0.06]">
            {[0, 1, 2, 3, 4, 5].map((i) => (
                <td key={i} className="py-4 pr-4">
                    <Skeleton w={i === 1 ? '12ch' : '7ch'} />
                </td>
            ))}
        </tr>
    );
}

function SignIn({ onSignIn }: { onSignIn: () => void }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
            <div className="w-full max-w-[26rem]">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">PolarisPay</p>
                <h1 className="mt-4 text-[2rem] font-semibold leading-[1.1] tracking-[-0.02em]">
                    Your collections ledger
                </h1>
                <p className="mt-4 text-[15px] leading-relaxed text-white/55">
                    Every plan you have originated, what it has collected, and what is still owed to you. Settlement
                    lands the moment a customer checks out.
                </p>
                <button
                    onClick={onSignIn}
                    className="mt-9 flex w-full items-center justify-center gap-2.5 rounded-lg bg-primary px-6 py-3.5 text-sm font-semibold text-black transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-px hover:shadow-[0_6px_24px_-6px_rgba(166,242,74,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-0"
                >
                    Connect wallet
                </button>
            </div>
        </div>
    );
}

function formatDue(iso: string): string {
    const due = new Date(iso);
    const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
    if (days < -1) return `${Math.abs(days)}d overdue`;
    if (days === -1 || days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 14) return `In ${days} days`;
    return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
