import { NextRequest, NextResponse } from "next/server";
import { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";

export async function getPositionsFromDb(db: Db, wallet: string) {
  return db
    .collection("positions")
    .find({ walletAddress: wallet.toLowerCase(), status: "active" })
    .toArray();
}

export async function upsertPosition(
  db: Db,
  payload: {
    walletAddress: string;
    type: "SUPPLY" | "BORROW";
    symbol: string;
    entryAmount: number;
    txHash: string;
  }
) {
  const now = new Date();
  const status = payload.entryAmount === 0 ? "closed" : "active";

  return db.collection("positions").updateOne(
    { txHash: payload.txHash },
    {
      $set: {
        walletAddress: payload.walletAddress.toLowerCase(),
        type: payload.type,
        symbol: payload.symbol,
        entryAmount: payload.entryAmount,
        status,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json(
      { error: "wallet address required" },
      { status: 400 }
    );
  }

  try {
    const db = await getDb();
    const raw = await getPositionsFromDb(db, wallet);

    // Aggregate by symbol + type so multiple txs for same asset show as one position
    const agg: Record<string, { type: string; symbol: string; totalAmount: number; latestTx: string; latestTime: Date }> = {};
    for (const p of raw) {
      const key = `${p.type}-${p.symbol}`;
      if (!agg[key]) {
        agg[key] = { type: p.type, symbol: p.symbol, totalAmount: 0, latestTx: p.txHash || "", latestTime: p.updatedAt || p.createdAt };
      }
      agg[key].totalAmount += p.entryAmount || 0;
      if (p.updatedAt > agg[key].latestTime) {
        agg[key].latestTime = p.updatedAt;
        agg[key].latestTx = p.txHash || "";
      }
    }

    const TOKEN_NAMES: Record<string, string> = { USDC: "USD Coin", WETH: "Wrapped Ether", BNB: "BNB", USDT: "Tether", ETH: "Ether" };
    /*
     * APY is not published on chain by these pools, and inventing a rate that
     * a user might act on is worse than admitting we do not have it. `apy` is
     * null until a real rate source is wired; the UI renders that as "--"
     * rather than a plausible-looking number.
     */

    const positions = Object.values(agg)
      .filter(p => p.totalAmount > 0)
      .map(p => ({
        type: p.type,
        symbol: p.symbol,
        name: TOKEN_NAMES[p.symbol] || p.symbol,
        amount: p.totalAmount.toFixed(2),
        value: `$${p.totalAmount.toFixed(2)}`,
        apy: null,
        txHash: p.latestTx,
      }));

    return NextResponse.json(positions);
  } catch (err) {
    console.error("[GET /api/positions] DB error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { walletAddress, type, symbol, entryAmount, txHash } = body;

    const db = await getDb();
    await upsertPosition(db, { walletAddress, type, symbol, entryAmount, txHash });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/positions] DB error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
