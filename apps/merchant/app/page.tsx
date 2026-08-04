'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import Image from 'next/image';
import useSWR from 'swr';
import { ArrowRight, ShoppingBag } from 'lucide-react';

/**
 * The front door.
 *
 * What stood here was a splash: a logo, a tagline about "the complete payment
 * stack", three same-size feature cards, and a code sample importing a
 * component that does not exist from a package that is not ours. It named no
 * product and offered no evidence, and the one concrete thing on it would not
 * have compiled.
 *
 * A merchant deciding whether to integrate wants three answers: what this does
 * for my checkout, whether it actually works, and what I have to write. Those,
 * in that order -- and the middle one is answered from the live book rather
 * than with an adjective.
 */

const fetcher = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
};

type Health = {
    status: string;
    book: {
        activeLoans: number;
        overdueInstalments: number;
        inDunning: number;
        liquidationCandidates: number;
        collectionRate: number;
    };
};

const SNIPPET = `import { PayWithPolarisBNPL } from "@polarispay/sdk";

// Reads the shopper's limit from the chain, shows the
// four-payment schedule, and opens the plan.
<PayWithPolarisBNPL
  merchant="0xYourPayoutAddress"
  amount="180.00"
  orderId="ORDER-1042"
  onSuccess={(r) => console.log(r.transactionHash)}
/>`;

export default function Home() {
    const { data: health } = useSWR<Health>('/api/keeper/health', fetcher, {
        refreshInterval: 60_000,
        shouldRetryOnError: false,
    });

    return (
        <div className="min-h-screen bg-background font-display text-foreground selection:bg-primary/30">
            <main className="mx-auto max-w-[1180px] px-6 pb-28 md:px-10">
                {/* The claim is specific -- split a checkout into four -- because
                    "complete payment stack" is what every one of these says. */}
                <section className="pt-24 pb-20 md:pt-32">
                    <Image
                        src="/logo.png"
                        alt="Polaris"
                        width={180}
                        height={48}
                        className="h-10 w-auto"
                        priority
                    />
                    <h1 className="mt-10 max-w-[16ch] text-[clamp(2.5rem,6.5vw,4.5rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
                        Let shoppers pay in four.
                    </h1>
                    <p className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-foreground/55">
                        A buy-now-pay-later checkout for on-chain stores. Your shopper&apos;s limit
                        is underwritten from their own wallet history, the instalments collect
                        themselves, and you are settled without chasing anyone.
                    </p>

                    <div className="mt-10 flex flex-wrap gap-3">
                        <Link
                            href="/store"
                            className="inline-flex items-center gap-2 rounded-[calc(var(--radius)-2px)] bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.99]"
                        >
                            <ShoppingBag className="size-4" />
                            Try the store
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center gap-2 rounded-[calc(var(--radius)-2px)] border border-foreground/12 px-6 py-3.5 text-sm font-medium text-foreground/75 transition-colors hover:border-foreground/28 hover:text-foreground"
                        >
                            Merchant console
                            <ArrowRight className="size-4" />
                        </Link>
                    </div>
                </section>

                {/* Proof before persuasion, taken from the running keeper rather
                    than written down here. */}
                {health && (
                    <section className="border-y border-foreground/8 py-10">
                        <dl className="flex flex-wrap gap-x-14 gap-y-8">
                            <Proof
                                term="Collected on time"
                                value={`${health.book.collectionRate.toFixed(0)}%`}
                                accent={health.book.collectionRate >= 95}
                            />
                            <Proof term="Plans collecting" value={String(health.book.activeLoans)} />
                            <Proof term="In dunning" value={String(health.book.inDunning)} />
                            <Proof
                                term="Written off"
                                value={String(health.book.liquidationCandidates)}
                            />
                        </dl>
                        <p className="mt-7 max-w-[62ch] text-sm leading-relaxed text-foreground/45">
                            Read from the live book, not a marketing figure. Every instalment behind
                            these was charged by a keeper running on KeeperHub, with gas sponsored,
                            and each one has a transaction you can open.
                        </p>
                    </section>
                )}

                {/* Sequence, so the numbering carries real order rather than
                    decorating three interchangeable cards. */}
                <section className="py-20">
                    <h2 className="text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-[-0.02em]">
                        What happens at checkout
                    </h2>
                    <ol className="mt-10 space-y-px overflow-hidden rounded-[var(--radius)] border border-foreground/8">
                        <Step
                            n={1}
                            title="The chain underwrites the shopper"
                            body="No application and no bureau. The limit comes from the wallet's own repayment history, so a first-time shopper starts at a baseline and earns their way up."
                        />
                        <Step
                            n={2}
                            title="They approve once, and the plan opens"
                            body="One signature covers the whole schedule. Nothing is locked up front, and the shopper never pays gas to start a plan."
                        />
                        <Step
                            n={3}
                            title="The keeper collects, and you are settled"
                            body="Each instalment is charged on its due date. A charge that fails enters a retry ladder rather than being written off, and what is collected is paid out to you on schedule."
                        />
                    </ol>
                </section>

                {/* The integration, in the code that actually ships. */}
                <section className="grid gap-10 border-t border-foreground/8 pt-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
                    <div>
                        <h2 className="text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-[-0.02em]">
                            One component
                        </h2>
                        <p className="mt-5 max-w-[46ch] leading-relaxed text-foreground/55">
                            It reads the shopper&apos;s limit itself and falls back to paying in full
                            when the limit will not stretch. If you want your own UI, the same
                            operations are available headless, and to an agent over MCP.
                        </p>
                        <Link
                            href="/store"
                            className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                            See it running
                            <ArrowRight className="size-3.5" />
                        </Link>
                    </div>

                    <div className="surface overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-foreground/8 px-4 py-3">
                            <span className="size-2 rounded-full bg-foreground/15" />
                            <span className="size-2 rounded-full bg-foreground/15" />
                            <span className="size-2 rounded-full bg-foreground/15" />
                            <span className="ml-2 font-mono text-[11px] text-foreground/40">
                                checkout.tsx
                            </span>
                        </div>
                        <pre className="overflow-x-auto px-4 py-4">
                            <code className="font-mono text-[12.5px] leading-relaxed text-foreground/75">
                                {SNIPPET}
                            </code>
                        </pre>
                    </div>
                </section>
            </main>

            <footer className="border-t border-foreground/8">
                <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-6 py-8 md:px-10">
                    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/30">
                        Polaris · Sepolia
                    </p>
                    <a
                        href="https://sepolia.etherscan.io/address/0x5d6F049f791C40b09701129b3663d1A8ce9eAB86"
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/30 transition-colors hover:text-foreground/60"
                    >
                        Contracts
                    </a>
                </div>
            </footer>
        </div>
    );
}

function Proof({ term, value, accent }: { term: string; value: string; accent?: boolean }) {
    return (
        <div>
            <dt className="label">{term}</dt>
            <dd
                className={`figure mt-2 text-[clamp(1.5rem,3vw,2rem)] font-semibold ${
                    accent ? 'text-primary' : ''
                }`}
            >
                {value}
            </dd>
        </div>
    );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
    return (
        <li className="flex gap-5 bg-card/40 px-5 py-6 sm:gap-7 sm:px-7">
            <span className="figure shrink-0 font-mono text-sm text-primary/70">
                {String(n).padStart(2, '0')}
            </span>
            <div className="min-w-0">
                <h3 className="font-medium leading-tight">{title}</h3>
                <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-foreground/50">
                    {body}
                </p>
            </div>
        </li>
    );
}
