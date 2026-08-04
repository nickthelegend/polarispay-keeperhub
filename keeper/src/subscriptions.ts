/**
 * Which subscriptions the keeper should try to charge.
 *
 * Read straight from the chain rather than from a book. Subscriptions are the
 * one part of the protocol with no off-chain origination step -- a subscriber
 * calls `subscribe` themselves, from the SDK, from an agent over MCP, or from
 * Etherscan -- so any local list starts out incomplete and drifts further with
 * every subscription we did not originate. The contract already knows all of
 * them.
 *
 * The due check is deliberately NOT made here. `isChargeDue` is evaluated
 * inside the same KeeperHub call that charges, because the answer can change
 * between our read and our write: the entry point is permissionless, so another
 * keeper may charge first, and the subscriber may cancel. This module only
 * narrows the field to subscriptions worth asking about.
 */

const ACTIVE = 0;

/** Mirrors `PolarisPayments.subscriptions(uint256)`. */
export type ChainSubscription = {
  id: string;
  subscriber: string;
  planId: string;
  nextChargeAt: number;
  periodsCharged: number;
  missedCharges: number;
};

type Rpc = (to: string, data: string) => Promise<string>;

/** keccak256("subscriptionCount()")[0:4] */
const COUNT_SELECTOR = "0x173b6d90";
/** keccak256("subscriptions(uint256)")[0:4] */
const SUB_SELECTOR = "0x2d5bbf60";

export function jsonRpc(url: string): Rpc {
  return async (to, data) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { result?: string; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result ?? "0x";
  };
}

const word = (hex: string, index: number): string =>
  hex.slice(2 + index * 64, 2 + (index + 1) * 64);

const toNumber = (w: string): number => Number(BigInt(`0x${w}`));

/**
 * Every subscription the contract currently considers active.
 *
 * Ids are dense and start at 1, so a straight walk is correct. It is also
 * O(subscriptions) per pass, which is fine at the scale this runs at and worth
 * revisiting -- by indexing the Subscribed and SubscriptionLapsed events -- long
 * before it is not.
 */
export async function activeSubscriptions(
  payments: string,
  rpc: Rpc
): Promise<ChainSubscription[]> {
  const countHex = await rpc(payments, COUNT_SELECTOR);
  const count = countHex && countHex !== "0x" ? Number(BigInt(countHex)) : 0;

  const out: ChainSubscription[] = [];
  for (let id = 1; id <= count; id++) {
    const arg = id.toString(16).padStart(64, "0");
    const raw = await rpc(payments, `${SUB_SELECTOR}${arg}`);
    if (!raw || raw === "0x") continue;

    // subscriber, planId, startedAt, nextChargeAt, periodsCharged,
    // missedCharges, status -- one word each.
    if (toNumber(word(raw, 6)) !== ACTIVE) continue;

    out.push({
      id: String(id),
      subscriber: `0x${word(raw, 0).slice(24)}`,
      planId: BigInt(`0x${word(raw, 1)}`).toString(),
      nextChargeAt: toNumber(word(raw, 3)),
      periodsCharged: toNumber(word(raw, 4)),
      missedCharges: toNumber(word(raw, 5)),
    });
  }
  return out;
}
