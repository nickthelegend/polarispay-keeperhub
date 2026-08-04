import { NextResponse } from "next/server";

import { collections } from "@polarispay/db";

export const dynamic = "force-dynamic";

/**
 * Record a credit-limit increase request.
 *
 * This previously computed `target > 0 ? "under-review" : "invalid"` and
 * returned it without persisting anything, so "under review" described no
 * actual review and nothing was ever queued. Requests are now written where an
 * operator can see them.
 *
 * The honest answer for a borrower is that the fastest route is not a request
 * at all: paying instalments on time raises the score-derived limit, and
 * locking collateral raises it immediately. Both are surfaced here.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const address = (
    request.headers.get("x-wallet-address") ?? ""
  ).toLowerCase();
  if (!address) {
    return NextResponse.json({ error: "Missing x-wallet-address" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { target?: unknown };
  const target = Number(body.target ?? 0);
  if (!Number.isFinite(target) || target <= 0) {
    return NextResponse.json(
      { error: "`target` must be a positive number" },
      { status: 400 }
    );
  }

  try {
    const { events } = await collections();
    await events.insertOne({
      type: "credit.increase_requested",
      borrower: address,
      chainId: Number(process.env.CHAIN_ID ?? 11_155_111),
      payload: { targetLimit: target },
      createdAt: new Date(),
    });

    return NextResponse.json({
      status: "recorded",
      requested: target,
      // Not a brush-off: these are the two levers that actually work, and one
      // of them is instant.
      alternatives: [
        "Lock collateral to raise your limit immediately.",
        "Each instalment paid on time raises your Polaris score, and the limit with it.",
      ],
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not record the request: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
