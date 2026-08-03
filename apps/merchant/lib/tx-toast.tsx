"use client";

import { toast } from "sonner";

const EXPLORER = "https://sepolia.etherscan.io";

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function txPending(label = "Confirm in your wallet…"): string | number {
  return toast.loading(label);
}

export function txSubmitted(hash: string, label = "Transaction confirmed", id?: string | number) {
  const url = explorerTxUrl(hash);
  const open = () => {
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  };
  return toast.success(label, {
    id,
    duration: 9000,
    description: (
      <span
        onClick={open}
        className="cursor-pointer font-mono text-xs text-teal-400 hover:text-teal-300 underline-offset-2 hover:underline"
        title="View on Etherscan"
      >
        {shortHash(hash)} · tap to view on explorer ↗
      </span>
    ),
    action: { label: "View ↗", onClick: open },
  });
}

export function txError(err: any, id?: string | number) {
  const msg = err?.shortMessage || err?.reason || err?.message || String(err);
  return toast.error("Transaction failed", { id, description: String(msg).slice(0, 160), duration: 7000 });
}
