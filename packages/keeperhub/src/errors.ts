/** Typed failure modes for KeeperHub execution, so callers can branch on cause. */

export type KeeperHubErrorKind =
  | "auth" //            401/403 - bad or revoked kh_ key, or missing scope
  | "rate_limit" //      429 - 60 req/min per API key
  | "spend_cap" //       403 - organization daily spend cap hit
  | "validation" //      400 - bad field, bad encoding
  | "not_found" //       404
  | "would_revert" //    simulation says this call fails on current state
  | "insufficient_funds" // payer cannot cover the charge
  | "timeout" //         never reached a terminal status in the poll budget
  | "reverted" //        broadcast, mined, failed
  | "server" //          5xx
  | "unknown";

export class KeeperHubError extends Error {
  readonly kind: KeeperHubErrorKind;
  readonly status?: number;
  readonly field?: string;
  readonly details?: string;
  readonly executionId?: string;
  /** True when the same call is worth attempting again with fresh state. */
  readonly retryable: boolean;

  constructor(
    kind: KeeperHubErrorKind,
    message: string,
    opts: {
      status?: number;
      field?: string;
      details?: string;
      executionId?: string;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "KeeperHubError";
    this.kind = kind;
    this.status = opts.status;
    this.field = opts.field;
    this.details = opts.details;
    this.executionId = opts.executionId;
    this.retryable = opts.retryable ?? DEFAULT_RETRYABLE.has(kind);
  }
}

/**
 * Which failures are worth another attempt.
 *
 * `would_revert` and `insufficient_funds` are deliberately NOT retryable at
 * this layer: the chain state that caused them has to change first. Retrying a
 * revert on an unchanged state just burns rate limit. The collection scheduler
 * handles those by moving the charge into the dunning ladder instead, which
 * retries on a business schedule (hours/days) rather than a network one.
 */
const DEFAULT_RETRYABLE = new Set<KeeperHubErrorKind>([
  "rate_limit",
  "timeout",
  "server",
]);

export function isKeeperHubError(err: unknown): err is KeeperHubError {
  return err instanceof KeeperHubError;
}

/** Map an HTTP status + body onto a typed error. */
export function errorFromResponse(
  status: number,
  body: unknown
): KeeperHubError {
  const parsed = (body ?? {}) as {
    error?: string;
    field?: string;
    details?: string;
  };
  const message = parsed.error ?? `KeeperHub request failed (${status})`;
  const opts = { status, field: parsed.field, details: parsed.details };

  if (status === 401 || status === 403) {
    // The execute routes reuse 403 for the org spend cap, so disambiguate on
    // the message before falling back to an auth failure.
    const haystack = `${message} ${parsed.details ?? ""}`.toLowerCase();
    if (haystack.includes("cap") || haystack.includes("spend")) {
      return new KeeperHubError("spend_cap", message, opts);
    }
    return new KeeperHubError("auth", message, opts);
  }
  if (status === 429) {
    return new KeeperHubError("rate_limit", message, opts);
  }
  if (status === 404) {
    return new KeeperHubError("not_found", message, opts);
  }
  if (status === 400) {
    return new KeeperHubError("validation", message, opts);
  }
  if (status >= 500) {
    return new KeeperHubError("server", message, opts);
  }
  return new KeeperHubError("unknown", message, opts);
}

/**
 * Classify a revert/simulation string into something the dunning logic can act
 * on. Substring matching is unavoidable here: the underlying reason is produced
 * by the target contract and the RPC, not by KeeperHub, so there is no code to
 * switch on.
 */
export function classifyFailure(reason: string | undefined): KeeperHubErrorKind {
  if (!reason) {
    return "unknown";
  }
  const r = reason.toLowerCase();
  if (
    r.includes("insufficient") ||
    r.includes("exceeds balance") ||
    r.includes("transfer amount exceeds")
  ) {
    return "insufficient_funds";
  }
  if (r.includes("revert") || r.includes("execution reverted")) {
    return "would_revert";
  }
  return "unknown";
}
