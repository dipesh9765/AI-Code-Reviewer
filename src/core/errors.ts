export type LlmErrorKind =
  | "auth"
  | "rate_limit"
  | "server"
  | "bad_request"
  | "network"
  | "timeout"
  | "aborted"
  | "protocol"
  | "config";

/**
 * Every failure that can reach the user. The message is written for a person, never contains
 * a request header, and carries at most a short excerpt of the provider's error body.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number | undefined;
  /** Whether trying again unchanged could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    kind: LlmErrorKind,
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LlmError";
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? (kind === "rate_limit" || kind === "server");
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof LlmError
    ? error.kind === "aborted"
    : error instanceof Error && error.name === "AbortError";
}
