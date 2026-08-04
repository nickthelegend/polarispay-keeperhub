import { NextResponse } from "next/server";

import { collections } from "@polarispay/db";

export const dynamic = "force-dynamic";

/** The demo merchant's payout address, so the storefront never hardcodes one. */
export async function GET(): Promise<NextResponse> {
  try {
    const { merchants } = await collections();
    const m = await merchants.findOne(
      { status: "active" },
      { projection: { _id: 0, payoutAddress: 1, name: 1, merchantId: 1 } }
    );
    if (!m) {
      return NextResponse.json({ error: "No active merchant" }, { status: 404 });
    }
    return NextResponse.json({ address: m.payoutAddress, name: m.name, merchantId: m.merchantId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
