"use client"

import Link from "next/link"
import useSWR from "swr"
import { useAccount } from "wagmi"
import { ArrowUpRight, Lock, ShieldCheck, Store } from "lucide-react"

import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button"

/**
 * The borrower's home.
 *
 * Two questions bring someone here: what can I spend, and what is about to
 * leave my account. Everything else -- score, how the limit was built, what is
 * already committed -- is context for those two, and the previous layout gave
 * all five equal billing as identical cards, so nothing led.
 *
 * Here the balance leads at display scale, the next charge sits beside it
 * carrying the time, and the rest collapses into one capacity meter that shows
 * the limit's composition in the only form where composition is legible: a bar
 * you can compare against itself.
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
  used: string
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

const num = (s: string | undefined): number => Number.parseFloat((s ?? "0").replace(/,/g, "")) || 0

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
    <div className="pb-20 pt-8">
      {isConnected ? (
        <>
          <Balance credit={credit} error={creditError} />
          {limits && <Capacity limits={limits} score={credit?.score ?? limits.creditScore} />}
          <Plans plans={credit?.plans} loading={!(credit || creditError)} />
        </>
      ) : (
        <SignedOut stats={stats} />
      )}

      <Protocol stats={stats} />
    </div>
  )
}

/**
 * The lead. The balance is the answer to "what can I spend", so it gets display
 * scale and nothing competes with it at that size; the next charge sits beside
 * it because the two are read together, and it carries the time rather than the
 * amount alone -- "105.00" is a fact, "105.00, in 16 minutes" is a decision.
 */
function Balance({ credit, error }: { credit?: Credit; error?: Error }) {
  if (error) {
    // Not "from the chain": this fails when our own read fails, and naming the
    // wrong system sends a borrower to check Sepolia when Sepolia is fine.
    return (
      <section className="mb-14">
        <div className="surface border-amber-500/25 px-6 py-5">
          <p className="text-sm font-medium text-amber-300">Your credit is not loading</p>
          <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-foreground/55">
            {error.message}
          </p>
          <p className="mt-3 text-xs text-foreground/40">
            Nothing is wrong with your plans or your balance -- they live on chain and are
            unaffected. This page will pick them up as soon as the read succeeds.
          </p>
        </div>
      </section>
    )
  }

  const due = credit?.nextDueAt ? relative(credit.nextDueAt) : null
  const msUntil = credit?.nextDueAt ? new Date(credit.nextDueAt).getTime() - Date.now() : null

  // Past due is not the same news as due soon, and the accent colour reads as
  // approval wherever it lands. Late gets amber; imminent gets the accent.
  const overdue = msUntil !== null && msUntil < 0
  const soon = msUntil !== null && msUntil >= 0 && msUntil < 36 * 3600 * 1000

  return (
    <section className="mb-14 grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-16">
      <div>
        <p className="label">Available to spend</p>
        <p className="figure-lg mt-3 text-[clamp(3.25rem,9vw,5.5rem)] font-semibold">
          {credit ? (
            credit.availableDisplay
          ) : (
            <span className="inline-block h-[0.8em] w-[5ch] animate-pulse rounded bg-foreground/10 align-middle" />
          )}
        </p>
        <p className="mt-3 text-sm text-foreground/55">
          {credit ? (
            <>
              of <span className="figure text-foreground/80">{credit.limitDisplay}</span>, with{" "}
              <span className="figure text-foreground/80">{credit.usedDisplay}</span> committed to
              open plans
            </>
          ) : (
            "Reading your limit from the chain"
          )}
        </p>
      </div>

      <div className="flex flex-col justify-end lg:border-l lg:border-foreground/10 lg:pl-16">
        <p className="label">Next charge</p>
        {credit ? (
          credit.nextDueDisplay ? (
            <>
              <p className="figure mt-3 text-4xl font-semibold">{credit.nextDueDisplay}</p>
              <p
                className={`mt-2 flex items-center gap-2 text-sm ${
                  overdue ? "text-amber-400" : soon ? "text-primary" : "text-foreground/55"
                }`}
                title={new Date(credit.nextDueAt as string).toLocaleString()}
              >
                {(overdue || soon) && (
                  <span
                    className={`size-1.5 rounded-full ${
                      overdue ? "animate-pulse bg-amber-400" : "bg-primary"
                    }`}
                  />
                )}
                {overdue ? `Due ${due}` : due}
              </p>
              <p className="mt-4 max-w-xs text-xs leading-relaxed text-foreground/40">
                {overdue
                  ? "The keeper collects this on its next pass. Gas is sponsored, so it costs you nothing."
                  : "The keeper charges this automatically. Gas is sponsored, so it costs you nothing to let it run."}
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-4xl font-semibold text-foreground/70">Nothing due</p>
              <p className="mt-2 text-sm text-foreground/50">Every plan is settled.</p>
            </>
          )
        ) : (
          <span className="mt-3 inline-block h-9 w-[6ch] animate-pulse rounded bg-foreground/10" />
        )}
      </div>
    </section>
  )
}

/**
 * Where the limit came from, and how much of it is spoken for.
 *
 * Three numbers that only mean something in relation to each other, so they are
 * drawn in relation to each other. The meter carries earned and collateral as
 * segments and marks the committed portion, which is a comparison you cannot
 * make from three figures sitting in three boxes.
 */
function Capacity({ limits, score }: { limits: Limits; score: number }) {
  const total = num(limits.currentLimit) || 1
  const base = (num(limits.baseLimit) / total) * 100
  const boost = (num(limits.collateralBoost) / total) * 100
  const used = Math.min((num(limits.used) / total) * 100, 100)
  const locked = num(limits.collateralLocked)

  return (
    <section className="mb-14">
      <div className="surface px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
          <h2 className="text-base font-semibold">Your capacity</h2>
          <p className="text-sm text-foreground/50">
            Polaris score <span className="figure font-semibold text-foreground">{score}</span>
            <span className="mx-2 text-foreground/25">/</span>
            {limits.repaidLoans} plan{limits.repaidLoans === 1 ? "" : "s"} repaid
          </p>
        </div>

        {/*
         * Committed first and dark, headroom after it and lit.
         *
         * The obvious drawing -- fill the track with the limit's two sources --
         * is the wrong one: a bar filled end to end reads as "spent", by the
         * convention every progress bar has taught. Here the lit portion is
         * what is still available, so a mostly-lime bar means mostly free,
         * which is what the numbers actually say. Composition survives as the
         * tone split inside the headroom.
         */}
        <div className="relative mt-6 flex h-2.5 w-full overflow-hidden rounded-full bg-foreground/10">
          {used > 0 && (
            <div
              className="h-full shrink-0 bg-foreground/35"
              style={{ width: `${used}%` }}
              aria-hidden
            />
          )}
          <div
            className="h-full shrink-0 bg-primary/90"
            style={{ width: `${Math.max(base - used, 0)}%` }}
            aria-hidden
          />
          <div
            className="h-full shrink-0 bg-primary/40"
            style={{ width: `${boost}%` }}
            aria-hidden
          />
        </div>

        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <Segment swatch="bg-primary/90" term="Earned on history" value={limits.baseLimit} />
          {num(limits.collateralBoost) > 0 && (
            <Segment swatch="bg-primary/40" term="From collateral" value={limits.collateralBoost} />
          )}
          <Segment swatch="bg-foreground/35" term="Committed" value={limits.used} />
        </dl>

        {locked > 0 && (
          <p className="mt-6 flex items-start gap-2.5 border-t border-foreground/8 pt-5 text-sm text-foreground/60">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              <span className="figure font-medium text-foreground">{limits.collateralLocked}</span>{" "}
              locked, worth{" "}
              <span className="figure font-medium text-foreground">{limits.collateralBoost}</span> of
              extra credit.{" "}
              <Link href="/limits" className="text-primary underline-offset-4 hover:underline">
                Manage collateral
              </Link>
            </span>
          </p>
        )}
      </div>
    </section>
  )
}

function Segment({ swatch, term, value }: { swatch: string; term: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`size-2 shrink-0 rounded-full ${swatch}`} />
      <dt className="text-foreground/50">{term}</dt>
      <dd className="figure font-medium">{value}</dd>
    </div>
  )
}

/**
 * The plans, drawn as the schedules they are.
 *
 * A plan is four dated charges, so the useful shape is a track you read left to
 * right, not four equal chips. Paid segments link to the transaction that paid
 * them, which is the claim the whole product rests on.
 */
function Plans({ plans, loading }: { plans?: Credit["plans"]; loading: boolean }) {
  if (loading) {
    return (
      <section className="mb-14">
        <SectionHead>Plans</SectionHead>
        <div className="surface h-32 animate-pulse" />
      </section>
    )
  }

  if (!plans || plans.length === 0) {
    return (
      <section className="mb-14">
        <SectionHead>Plans</SectionHead>
        <div className="surface flex flex-col items-center gap-4 px-6 py-14 text-center">
          <Store className="size-6 text-foreground/25" />
          <div className="space-y-1.5">
            <p className="font-medium">No plans yet</p>
            <p className="mx-auto max-w-sm text-sm text-foreground/50">
              Buy something at a Polaris merchant and split it into four. Nothing is locked up
              front.
            </p>
          </div>
          <Link
            href="/merchants"
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98]"
          >
            Browse merchants <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </section>
    )
  }

  const open = plans.filter((p) => p.status === "active")
  const closed = plans.filter((p) => p.status !== "active")

  return (
    <section className="mb-14">
      <SectionHead count={open.length}>Plans</SectionHead>
      <div className="space-y-3">
        {open.map((p) => (
          <Plan key={p.loanId} plan={p} />
        ))}
      </div>

      {closed.length > 0 && (
        <>
          <p className="label mt-10 mb-4">Settled</p>
          <div className="space-y-px overflow-hidden rounded-[var(--radius)] border border-foreground/8">
            {closed.map((p) => (
              <div
                key={p.loanId}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 bg-card/40 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground/80">
                    {p.merchantName}
                  </p>
                  <p className="font-mono text-xs text-foreground/35">{p.orderId}</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-foreground/45">
                  <span className="size-1.5 rounded-full bg-foreground/30" />
                  Paid in full
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Plan({ plan }: { plan: Credit["plans"][number] }) {
  const paid = plan.installments.filter((i) => i.state === "paid").length
  const total = plan.installments.length

  return (
    <article className="surface surface-interactive px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight">{plan.merchantName}</h3>
          <p className="mt-1 font-mono text-xs text-foreground/40">{plan.orderId}</p>
        </div>
        <div className="text-right">
          <p className="figure text-xl font-semibold">{plan.outstandingDisplay}</p>
          <p className="mt-0.5 text-xs text-foreground/45">
            left of {total} · {paid} paid
          </p>
        </div>
      </div>

      {/* One segment per charge, in order. The track reads as a schedule; the
          chips it replaced read as four unrelated badges. */}
      <div className="mt-5 flex gap-1.5">
        {plan.installments.map((i) => (
          <Segment_ key={i.index} inst={i} />
        ))}
      </div>
    </article>
  )
}

const STATE: Record<string, { bar: string; label: string }> = {
  paid: { bar: "bg-primary", label: "Paid" },
  dunning: { bar: "bg-amber-400", label: "Retrying" },
  failed: { bar: "bg-destructive", label: "Failed" },
  scheduled: { bar: "bg-foreground/25", label: "Scheduled" },
}

function Segment_({ inst }: { inst: Credit["plans"][number]["installments"][number] }) {
  const s = STATE[inst.state] ?? STATE.scheduled!
  const when = new Date(inst.dueAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })

  const body = (
    <span className="block w-full">
      <span className={`block h-[3px] w-full rounded-full ${s.bar}`} />
      <span className="mt-2 block figure text-[13px] font-medium text-foreground/85">
        {inst.amountDisplay.replace(/\s*pUSDC$/, "")}
      </span>
      <span className="mt-0.5 block text-[11px] text-foreground/40">
        {s.label} · {when}
      </span>
    </span>
  )

  return inst.transactionHash ? (
    <a
      href={`https://sepolia.etherscan.io/tx/${inst.transactionHash}`}
      target="_blank"
      rel="noreferrer"
      className="group flex-1 rounded transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
      title="View the transaction that paid this"
    >
      {body}
    </a>
  ) : (
    <span className="flex-1">{body}</span>
  )
}

function SectionHead({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="mb-5 flex items-baseline gap-3">
      <h2 className="text-base font-semibold">{children}</h2>
      {count !== undefined && count > 0 && (
        <span className="figure text-sm text-foreground/40">{count} open</span>
      )}
    </div>
  )
}

function SignedOut({ stats }: { stats?: Stats }) {
  return (
    <section className="mb-14 max-w-2xl">
      <ShieldCheck className="size-7 text-primary" />
      <h1 className="mt-6 text-[clamp(2rem,5vw,3rem)] font-semibold leading-[1.05] tracking-tight">
        Credit underwritten by
        <br />
        your own history.
      </h1>
      <p className="mt-5 max-w-lg text-base leading-relaxed text-foreground/55">
        Split any checkout into four. No application and no credit bureau — a new wallet starts at a
        500 baseline and earns its way up by repaying on time. Instalments collect themselves, with
        gas sponsored.
      </p>

      <div className="mt-8">
        <ConnectWalletButton />
      </div>

      {stats && (
        <dl className="mt-12 flex flex-wrap gap-x-10 gap-y-5 border-t border-foreground/8 pt-7">
          <Figure term="Originated" value={stats.totalOriginated} />
          <Figure term="Repaid" value={stats.totalRepaid} />
          <Figure
            term="Collected on time"
            value={`${stats.collectionRate.toFixed(0)}%`}
            accent={stats.collectionRate >= 95}
          />
        </dl>
      )}
    </section>
  )
}

function Protocol({ stats }: { stats?: Stats }) {
  if (!stats) return null

  return (
    <section className="border-t border-foreground/8 pt-7">
      <dl className="flex flex-wrap gap-x-10 gap-y-5">
        <Figure term="Originated" value={stats.totalOriginated} />
        <Figure term="Repaid" value={stats.totalRepaid} />
        <Figure term="Outstanding" value={stats.outstanding} />
        <Figure
          term="Collected on time"
          value={`${stats.collectionRate.toFixed(0)}%`}
          accent={stats.collectionRate >= 95}
        />
        <Figure term="Liquidated" value={String(stats.liquidatedLoans)} />
      </dl>
    </section>
  )
}

function Figure({ term, value, accent }: { term: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="label">{term}</dt>
      <dd className={`figure mt-1.5 text-lg font-semibold ${accent ? "text-primary" : ""}`}>
        {value}
      </dd>
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
