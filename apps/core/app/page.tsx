"use client"

import Link from "next/link"
import useSWR from "swr"
import { useAccount } from "wagmi"
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Gauge,
  Lock,
  ShieldCheck,
  Store,
  TrendingUp,
  Wallet,
} from "lucide-react"

import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button"

/**
 * The borrower's home.
 *
 * This replaced a confidential-lending dashboard inherited from an earlier
 * version of the project: encrypted-balance placeholders, a Fhenix FHEVM
 * banner, and a health factor hardcoded to 185%, all pointed at contracts that
 * are not deployed here. None of it could ever show a real number.
 *
 * Everything below comes from the deployed Sepolia contracts, through the
 * endpoints that read them. When a figure is not available it says so rather
 * than substituting a plausible-looking one.
 */

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`)
  }
  return res.json()
}

type Credit = {
  score: number
  scoreDelta: number
  limitDisplay: string
  availableDisplay: string
  usedDisplay: string
  onTimePayments: number
  latePayments: number
  nextDueAt: string | null
  nextDueDisplay: string | null
  plans: Array<{
    loanId: string
    orderId: string
    merchantName: string
    status: string
    outstandingDisplay: string
    installments: Array<{
      index: number
      dueAt: string
      amountDisplay: string
      state: string
      transactionHash: string | null
    }>
  }>
}

type Limits = {
  creditScore: number
  currentLimit: string
  baseLimit: string
  collateralBoost: string
  collateralLocked: string
  available: string
  activeLoans: number
  repaidLoans: number
}

type Stats = {
  totalOriginated: string
  totalRepaid: string
  outstanding: string
  activeLoans: number
  repaidLoans: number
  liquidatedLoans: number
  uniqueBorrowers: number
  activeMerchants: number
  collectionRate: number
}

export default function Home() {
  const { address, isConnected } = useAccount()

  const { data: stats } = useSWR<Stats>("/api/global-stats", fetcher, { refreshInterval: 30_000 })
  const { data: credit, error: creditError } = useSWR<Credit>(
    address ? `/api/credit/me?address=${address}` : null,
    fetcher,
    { refreshInterval: 20_000 }
  )
  const { data: limits } = useSWR<Limits>(
    address ? `/api/limits?address=${address}` : null,
    fetcher,
    { refreshInterval: 20_000 }
  )

  return (
    <div className="space-y-10 pt-6">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Your credit</h1>
        <p className="text-sm text-foreground/50 max-w-2xl">
          Buy now, pay later on Sepolia. Instalments collect themselves — a keeper charges each one
          when it comes due, with gas sponsored, so repaying costs you nothing.
        </p>
      </header>

      {!isConnected ? (
        <SignedOut stats={stats} />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={<Gauge className="size-4" />}
              label="Polaris score"
              value={credit ? String(credit.score) : undefined}
              hint={
                credit && credit.scoreDelta > 0
                  ? `+${credit.scoreDelta} from on-time repayment`
                  : "Repay on time to build it"
              }
            />
            <Stat
              icon={<CircleDollarSign className="size-4" />}
              label="Credit limit"
              value={credit?.limitDisplay}
              hint={
                limits && Number(limits.collateralBoost) > 0
                  ? `${limits.baseLimit} base + ${limits.collateralBoost} from collateral`
                  : "Lock collateral to raise it"
              }
            />
            <Stat
              icon={<Wallet className="size-4" />}
              label="Available to spend"
              value={credit?.availableDisplay}
              hint={credit ? `${credit.usedDisplay} in use` : undefined}
            />
            <Stat
              icon={<CalendarClock className="size-4" />}
              label="Next payment"
              value={credit?.nextDueDisplay ?? (credit ? "None due" : undefined)}
              hint={credit?.nextDueAt ? relative(credit.nextDueAt) : "Nothing scheduled"}
            />
          </section>

          {creditError && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Could not read your credit from the chain: {creditError.message}
            </p>
          )}

          {limits && Number(limits.collateralLocked) > 0 && (
            <section className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 flex items-center gap-3">
              <Lock className="size-4 text-primary shrink-0" />
              <p className="text-sm text-foreground/70">
                <span className="font-semibold text-foreground">{limits.collateralLocked}</span>{" "}
                locked as collateral, raising your limit by{" "}
                <span className="font-semibold text-foreground">{limits.collateralBoost}</span>. It
                unlocks once every plan is closed.
              </p>
            </section>
          )}

          <Plans plans={credit?.plans} loading={!credit && !creditError} />
        </>
      )}

      <ProtocolStats stats={stats} />
    </div>
  )
}

function SignedOut({ stats }: { stats?: Stats }) {
  return (
    <section className="rounded-2xl border border-primary/20 bg-[#05080f]/60 px-6 py-10 text-center space-y-5">
      <ShieldCheck className="size-8 text-primary mx-auto" />
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Connect a wallet to see your credit</h2>
        <p className="text-sm text-foreground/50 max-w-md mx-auto">
          Your limit is underwritten from your own chain history — no application, no credit
          bureau. A new wallet starts at a 500 baseline and earns its way up.
        </p>
      </div>
      <div className="flex justify-center">
        <ConnectWalletButton />
      </div>
      {stats && (
        <p className="text-xs text-foreground/40 pt-2">
          {stats.uniqueBorrowers} borrower{stats.uniqueBorrowers === 1 ? "" : "s"} ·{" "}
          {stats.totalOriginated} originated · {stats.collectionRate.toFixed(0)}% collected on time
        </p>
      )}
    </section>
  )
}

function Plans({ plans, loading }: { plans?: Credit["plans"]; loading: boolean }) {
  if (loading) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/40">Plans</h2>
        <div className="h-24 rounded-2xl border border-primary/10 bg-primary/[0.02] animate-pulse" />
      </section>
    )
  }

  if (!plans || plans.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/40">Plans</h2>
        <div className="rounded-2xl border border-primary/10 px-5 py-8 text-center space-y-3">
          <Store className="size-6 text-foreground/30 mx-auto" />
          <p className="text-sm text-foreground/50">
            No plans yet. Buy something at a Polaris merchant and split it into four.
          </p>
          <Link
            href="/merchants"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Browse merchants <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/40">Plans</h2>
      <div className="space-y-3">
        {plans.map((p) => (
          <article
            key={p.loanId}
            className="rounded-2xl border border-primary/15 bg-[#05080f]/40 p-5 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{p.merchantName}</p>
                <p className="text-xs text-foreground/40 font-mono">{p.orderId}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">{p.outstandingDisplay}</p>
                <p className="text-xs text-foreground/40">outstanding</p>
              </div>
            </div>

            {/* One tile per instalment: the schedule at a glance, showing the
                state the keeper actually recorded rather than a progress bar
                that implies more certainty than the book has. */}
            <div className="flex flex-wrap gap-2">
              {p.installments.map((i) => (
                <InstalmentPip key={i.index} inst={i} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

const PIP: Record<string, { ring: string; label: string }> = {
  paid: { ring: "border-primary bg-primary/20 text-primary", label: "Paid" },
  dunning: { ring: "border-amber-500 bg-amber-500/10 text-amber-400", label: "Retrying" },
  failed: { ring: "border-destructive bg-destructive/10 text-destructive", label: "Failed" },
  scheduled: { ring: "border-foreground/20 text-foreground/50", label: "Scheduled" },
}

function InstalmentPip({ inst }: { inst: Credit["plans"][number]["installments"][number] }) {
  const style = PIP[inst.state] ?? PIP.scheduled!
  const body = (
    <div className={`rounded-xl border px-3 py-2 text-xs ${style.ring}`}>
      <p className="font-semibold tabular-nums">{inst.amountDisplay}</p>
      <p className="opacity-70">
        {style.label} · {new Date(inst.dueAt).toLocaleDateString()}
      </p>
    </div>
  )
  // A collected instalment has a transaction behind it, so it should be
  // possible to go and check -- that is the whole claim the product makes.
  return inst.transactionHash ? (
    <a
      href={`https://sepolia.etherscan.io/tx/${inst.transactionHash}`}
      target="_blank"
      rel="noreferrer"
      className="hover:opacity-80 transition-opacity"
    >
      {body}
    </a>
  ) : (
    body
  )
}

function ProtocolStats({ stats }: { stats?: Stats }) {
  return (
    <section className="space-y-3 border-t border-primary/10 pt-8">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/40">Protocol</h2>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<TrendingUp className="size-4" />}
          label="Originated"
          value={stats?.totalOriginated}
        />
        <Stat
          icon={<CircleDollarSign className="size-4" />}
          label="Repaid"
          value={stats?.totalRepaid}
        />
        <Stat icon={<Wallet className="size-4" />} label="Outstanding" value={stats?.outstanding} />
        <Stat
          icon={<ShieldCheck className="size-4" />}
          label="Collected on time"
          value={stats ? `${stats.collectionRate.toFixed(0)}%` : undefined}
          hint={stats ? `${stats.liquidatedLoans} liquidated` : undefined}
        />
      </div>
    </section>
  )
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value?: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-primary/15 bg-[#05080f]/40 px-4 py-4 space-y-1.5">
      <div className="flex items-center gap-2 text-foreground/40">
        {icon}
        <span className="text-[11px] uppercase tracking-widest">{label}</span>
      </div>
      {value === undefined ? (
        <div className="h-7 w-24 rounded bg-primary/10 animate-pulse" />
      ) : (
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      )}
      {hint && <p className="text-[11px] text-foreground/35">{hint}</p>}
    </div>
  )
}

/** "in 3 days" / "2 hours ago", so a due date reads as urgency rather than arithmetic. */
function relative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(ms)
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ]
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  for (const [size, unit] of units) {
    if (abs >= size) return fmt.format(Math.round(ms / size), unit)
  }
  return "now"
}
