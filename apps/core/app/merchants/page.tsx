"use client"

import { useState } from "react"
import useSWR from "swr"
import { ArrowUpRight, Search, Store } from "lucide-react"

import { ConnectGate } from "@/components/connect-gate"

/**
 * Merchants accepting Polaris.
 *
 * The version of this page it replaced advertised "VENDORS: 1,248" and
 * "UPTIME: 99.99%" as literals, filtered on a `category` field the merchant
 * records do not have, and rendered `$NaN` for a `credit_limit` that does not
 * exist either. It described a network that was not there.
 *
 * The registry is small and real. Showing it honestly is more persuasive than
 * inventing a directory, and every merchant here has a payout address you can
 * go and look at.
 */

type Merchant = {
  merchantId: string
  chainId: number
  name: string
  payoutAddress: string
  createdAt: string
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

/** The storefront that ships with the project, so the list is never a dead end. */
const DEMO_STORE = "http://localhost:3111/store"

export default function MerchantsPage() {
  return (
    <ConnectGate>
      <Merchants />
    </ConnectGate>
  )
}

function Merchants() {
  const { data, error } = useSWR<Merchant[]>("/api/merchants", fetcher, {
    refreshInterval: 60_000,
  })
  const [search, setSearch] = useState("")

  const merchants = (data ?? []).filter((m) =>
    m.name.toLowerCase().includes(search.trim().toLowerCase())
  )

  return (
    <div className="space-y-8 pt-6">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Merchants</h1>
        <p className="text-sm text-foreground/50 max-w-2xl">
          Shops accepting Polaris. Any merchant can register and start splitting checkouts into
          four. Settlement lands in their payout address on schedule.
        </p>
      </header>

      <div className="relative max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-foreground/30" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search merchants"
          className="w-full rounded-xl border border-primary/20 bg-black/40 py-3 pl-11 pr-4 text-sm outline-none transition-colors focus:border-primary/50"
        />
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load the merchant registry: {error.message}
        </p>
      )}

      {!data && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-36 rounded-2xl border border-primary/10 bg-primary/[0.02] animate-pulse"
            />
          ))}
        </div>
      )}

      {data && merchants.length === 0 && (
        <div className="rounded-2xl border border-primary/10 px-5 py-10 text-center space-y-2">
          <Store className="size-6 text-foreground/30 mx-auto" />
          <p className="text-sm text-foreground/50">
            {search ? `No merchant matches "${search}".` : "No merchants registered yet."}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {merchants.map((m) => (
          <article
            key={m.merchantId}
            className="rounded-2xl border border-primary/15 bg-[#05080f]/40 p-5 flex flex-col gap-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="size-10 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-center shrink-0">
                <Store className="size-4 text-primary" />
              </div>
              <span className="text-[10px] uppercase tracking-widest text-foreground/30">
                since {new Date(m.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
              </span>
            </div>

            <div className="space-y-1">
              <h2 className="font-semibold leading-tight">{m.name}</h2>
              <p className="text-xs text-foreground/40 font-mono">{m.merchantId}</p>
            </div>

            <div className="mt-auto space-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-foreground/30">
                  Settles to
                </p>
                <a
                  href={`https://sepolia.etherscan.io/address/${m.payoutAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono text-foreground/60 hover:text-primary transition-colors inline-flex items-center gap-1"
                >
                  {m.payoutAddress.slice(0, 10)}…{m.payoutAddress.slice(-8)}
                  <ArrowUpRight className="size-3" />
                </a>
              </div>

              <a
                href={DEMO_STORE}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-black transition-all hover:brightness-110 active:scale-[0.98]"
              >
                Shop <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
