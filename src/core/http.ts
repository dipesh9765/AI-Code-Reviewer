import { LlmError } from "./errors";
import { redactSecrets } from "./redact";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetch?: FetchLike;
  /** Budget for the response headers to arrive, and the maximum silence while streaming. */
  timeoutMs: number;
  /** Extra attempts after the first for 429 / 5xx / network failures. */
  maxRetries?: number;
  baseDelayMs?: number;
  /** Injected so tests do not wait. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const MAX_RETRY_AFTER_MS = 30_000;

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LlmError("aborted", "Request cancelled."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new LlmError("aborted", "Request cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function retryDelayMs(
  attempt: number,
  baseDelayMs: number,
  retryAfter: string | null,
): number {
  const backoff = baseDelayMs * 2 ** attempt;
  if (retryAfter === null) return backoff;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds * 1000, backoff), MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(retryAfter);
  if (!Number.isNaN(date))
    return Math.min(Math.max(date - Date.now(), backoff), MAX_RETRY_AFTER_MS);
  return backoff;
}

async function errorExcerpt(response: Response): Promise<string> {
  try {
    const text = (await response.text()).replace(/\s+/g, " ").trim();
    // Providers sometimes echo a fragment of the key back ("Incorrect API key provided: ...").
    return redactSecrets(text.slice(0, 300)).text;
  } catch {
    return "";
  }
}

export async function toHttpError(response: Response): Promise<LlmError> {
  const excerpt = await errorExcerpt(response);
  const detail = excerpt ? `: ${excerpt}` : "";
  const status = response.status;
  if (status === 401 || status === 403) {
    return new LlmError("auth", `The provider rejected the API key (HTTP ${status})${detail}`, {
      status,
    });
  }
  if (status === 429) {
    return new LlmError("rate_limit", `Rate limited by the provider (HTTP 429)${detail}`, {
      status,
    });
  }
  if (status >= 500) {
    return new LlmError("server", `The provider had an error (HTTP ${status})${detail}`, {
      status,
    });
  }
  return new LlmError("bad_request", `The provider refused the request (HTTP ${status})${detail}`, {
    status,
  });
}

/**
 * POSTs JSON and returns a successful response, retrying transient failures with exponential
 * backoff (honouring `Retry-After`). Throws `LlmError` for everything else, so callers never see
 * a raw `fetch` exception or an HTTP status they have to interpret.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: HttpOptions,
  signal?: AbortSignal,
): Promise<Response> {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;
  const payload = JSON.stringify(body);

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new LlmError("aborted", "Request cancelled.");

    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort();
    }, options.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

    let failure: LlmError;
    let retryAfter: string | null = null;
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: payload,
        signal: combined,
      });
      clearTimeout(timer);
      if (response.ok) return response;
      retryAfter = response.headers.get("retry-after");
      failure = await toHttpError(response);
    } catch (error) {
      clearTimeout(timer);
      if (signal?.aborted) throw new LlmError("aborted", "Request cancelled.", { cause: error });
      if (timeout.signal.aborted) {
        failure = new LlmError(
          "timeout",
          `No response from the provider within ${Math.round(options.timeoutMs / 1000)} s.`,
          { retryable: true, cause: error },
        );
      } else {
        failure = new LlmError(
          "network",
          `Could not reach the provider: ${error instanceof Error ? error.message : String(error)}`,
          { retryable: true, cause: error },
        );
      }
    }

    if (!failure.retryable || attempt >= maxRetries) throw failure;
    await sleep(retryDelayMs(attempt, baseDelayMs, retryAfter), signal);
  }
}

/**
 * Exposes a response body as an async iterable of chunks that fails with a timeout if the
 * provider goes silent for `idleMs`, and stops promptly when `signal` aborts.
 */
export async function* readBody(
  response: Response,
  idleMs: number,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  if (!response.body)
    throw new LlmError("protocol", "The provider returned an empty response body.");
  const reader = response.body.getReader();
  try {
    for (;;) {
      if (signal?.aborted) throw new LlmError("aborted", "Request cancelled.");
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const guard = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new LlmError(
              "timeout",
              `The provider stopped responding for ${Math.round(idleMs / 1000)} s.`,
              {
                retryable: true,
              },
            ),
          );
        }, idleMs);
        onAbort = () => {
          reject(new LlmError("aborted", "Request cancelled."));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      try {
        const result = await Promise.race([reader.read(), guard]);
        if (result.done) return;
        yield result.value;
      } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener("abort", onAbort);
        guard.catch(() => undefined);
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
