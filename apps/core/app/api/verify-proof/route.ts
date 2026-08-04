import { NextResponse } from "next/server"
import type { VerificationProof, VerificationProvider } from "@/lib/reclaim-types"
import { addVerification } from "@/lib/verification-store"

/**
 * Verify a Reclaim proof's signatures.
 *
 * Requires RECLAIM_APP_SECRET. Unset means we cannot verify, and an
 * unverifiable proof must not be treated as a valid one.
 */
async function verifyReclaimProof(
  proof: VerificationProof
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!process.env.RECLAIM_APP_SECRET) {
    return { ok: false, reason: "proof verification is not configured (RECLAIM_APP_SECRET unset)" }
  }
  try {
    const { verifyProof } = await import("@reclaimprotocol/js-sdk")
    const ok = await verifyProof(proof as never)
    return ok ? { ok: true } : { ok: false, reason: "signature verification failed" }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}

// Reward amounts in ALGO for each provider
const ALGO_REWARDS = {
  github: 10,
  gmail: 50,
  linkedin: 50,
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const proofs = body.proofs as VerificationProof[]

    if (!proofs || !Array.isArray(proofs) || proofs.length === 0) {
      return NextResponse.json({ error: "No proofs provided" }, { status: 400 })
    }

    /*
     * Verify the proof before trusting anything inside it.
     *
     * This route previously read `proofs[0].claimData.provider`, string-matched
     * it, and granted an ALGO reward plus a credit-limit increase -- with no
     * signature check at all. Anyone could POST
     * `{proofs:[{claimData:{provider:"gmail"}}]}` and mint themselves credit.
     *
     * Reclaim proofs are verified with its own SDK; without the verifier
     * configured there is no way to distinguish a real proof from a forged
     * one, so the route fails closed rather than granting on an unverified
     * claim.
     */
    const verified = await verifyReclaimProof(proofs[0])
    if (!verified.ok) {
      return NextResponse.json(
        { error: `Proof rejected: ${verified.reason}` },
        { status: 401 }
      )
    }

    // Extract provider from proof
    const providerData = proofs[0].claimData.provider.toLowerCase()
    let provider: VerificationProvider

    // Map provider string to our provider type
    if (providerData.includes("github")) {
      provider = "github"
    } else if (providerData.includes("gmail") || providerData.includes("google")) {
      provider = "gmail"
    } else if (providerData.includes("linkedin")) {
      provider = "linkedin"
    } else {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 })
    }

    const algoReward = ALGO_REWARDS[provider] || 0

    // A shared default bucket meant every unauthenticated caller accrued into
    // the same account. The address is required.
    const walletAddress = req.headers.get("x-wallet-address")
    if (!walletAddress) {
      return NextResponse.json({ error: "Missing x-wallet-address" }, { status: 401 })
    }

    console.log("[v0] Proof verified successfully:", {
      provider,
      algoReward,
      proofCount: proofs.length,
      walletAddress,
    })

    // Store verification and update limits
    const userData = addVerification(walletAddress, provider, algoReward)

    return NextResponse.json({
      success: true,
      provider,
      algoReward,
      message: `Verification successful! You've earned ${algoReward} ALGO`,
      userData: {
        totalAlgoEarned: userData.totalAlgoEarned,
        limitIncrease: userData.limitIncrease,
        verifiedProviders: Array.from(userData.verifiedProviders),
      },
    })
  } catch (error) {
    console.error("[v0] Error verifying proof:", error)
    return NextResponse.json({ error: "Failed to verify proof" }, { status: 500 })
  }
}
