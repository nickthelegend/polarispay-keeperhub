import { NextResponse } from "next/server"
import { getUserVerifications } from "@/lib/verification-store"

export async function GET(req: Request) {
  try {
    // In production, get wallet address from authenticated session
    const walletAddress = req.headers.get("x-wallet-address")
    if (!walletAddress) {
      // A shared default bucket meant every unauthenticated caller read and
      // wrote the same account's verifications.
      return NextResponse.json({ error: "Missing x-wallet-address" }, { status: 401 })
    }

    const userData = getUserVerifications(walletAddress)

    return NextResponse.json({
      verifiedProviders: Array.from(userData.verifiedProviders),
      totalAlgoEarned: userData.totalAlgoEarned,
      limitIncrease: userData.limitIncrease,
    })
  } catch (error) {
    console.error("[v0] Error fetching user verifications:", error)
    return NextResponse.json({ error: "Failed to fetch verifications" }, { status: 500 })
  }
}
