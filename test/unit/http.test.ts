import { describe, expect, it, vi } from "vitest";
import { LlmError } from "../../src/core/errors";
import {
  defaultSleep,
  postJson,
  readBody,
  retryDelayMs,
  type FetchLike,
} from "../../src/core/http";
import { drain, noSleep } from "./helpers";

const ok = (): Response => new Response("{}", { status: 200 });
const status = (code: number, body = "", headers: Record<string, string> = {}): Response =>
  new Response(body, { status: code, headers });

function scripted(...responses: (Response | Error)[]): FetchLike & { calls: number } {
  const fn: FetchLike & { calls: number } = Object.assign(
    () => {
      fn.calls++;
      const next = responses[Math.min(fn.calls - 1, responses.length - 1)];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next as Response);
    },
    { calls: 0 },
  );
  return fn;
}

const base = { timeoutMs: 1000, sleep: noSleep };

describe("postJson", () => {
  it("returns a successful response without retrying", async () => {
    const fetch = scripted(ok());
    await postJson("http://x", {}, { a: 1 }, { ...base, fetch });
    expect(fetch.calls).toBe(1);
  });

  it("retries 429 then 500 then succeeds", async () => {
    const fetch = scripted(status(429), status(500), ok());
    await postJson("http://x", {}, {}, { ...base, fetch });
    expect(fetch.calls).toBe(3);
  });

  it("gives up after maxRetries and reports the last failure", async () => {
    const fetch = scripted(status(503));
    await expect(
      postJson("http://x", {}, {}, { ...base, fetch, maxRetries: 2 }),
    ).rejects.toMatchObject({
      kind: "server",
      status: 503,
    });
    expect(fetch.calls).toBe(3);
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [400, "bad_request"],
    [404, "bad_request"],
  ])("does not retry HTTP %i", async (code, kind) => {
    const fetch = scripted(status(code));
    await expect(postJson("http://x", {}, {}, { ...base, fetch })).rejects.toMatchObject({ kind });
    expect(fetch.calls).toBe(1);
  });

  it("retries network errors", async () => {
    const fetch = scripted(new TypeError("fetch failed"), ok());
    await postJson("http://x", {}, {}, { ...base, fetch });
    expect(fetch.calls).toBe(2);
  });

  it("reports a persistent network error as such", async () => {
    const fetch = scripted(new TypeError("ECONNREFUSED"));
    await expect(
      postJson("http://x", {}, {}, { ...base, fetch, maxRetries: 1 }),
    ).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("sends JSON with the supplied headers", async () => {
    let seen: RequestInit | undefined;
    const fetch: FetchLike = (_u, init) => {
      seen = init;
      return Promise.resolve(ok());
    };
    await postJson("http://x", { "x-key": "k" }, { hello: "world" }, { ...base, fetch });
    expect(seen?.body).toBe('{"hello":"world"}');
    expect(seen?.headers).toMatchObject({ "content-type": "application/json", "x-key": "k" });
  });

  it("times out when the provider never answers", async () => {
    const fetch: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    await expect(
      postJson("http://x", {}, {}, { ...base, fetch, timeoutMs: 20, maxRetries: 0 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("surfaces user cancellation as 'aborted', not as a timeout or network error", async () => {
    const controller = new AbortController();
    const fetch: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
        controller.abort();
      });
    await expect(
      postJson("http://x", {}, {}, { ...base, fetch }, controller.signal),
    ).rejects.toMatchObject({
      kind: "aborted",
    });
  });

  it("refuses to start when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = scripted(ok());
    await expect(
      postJson("http://x", {}, {}, { ...base, fetch }, controller.signal),
    ).rejects.toMatchObject({
      kind: "aborted",
    });
    expect(fetch.calls).toBe(0);
  });

  it("stops retrying when cancelled during backoff", async () => {
    const controller = new AbortController();
    const fetch = scripted(status(500));
    const sleep = vi.fn(() => {
      controller.abort();
      return Promise.reject(new LlmError("aborted", "Request cancelled."));
    });
    await expect(
      postJson("http://x", {}, {}, { timeoutMs: 1000, fetch, sleep }, controller.signal),
    ).rejects.toMatchObject({ kind: "aborted" });
    expect(fetch.calls).toBe(1);
  });

  it("redacts key fragments echoed back in an error body and truncates long bodies", async () => {
    const fetch = scripted(
      status(
        401,
        `Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwx. ${"x".repeat(1000)}`,
      ),
    );
    const error = (await postJson("http://x", {}, {}, { ...base, fetch }).catch(
      (e: unknown) => e,
    )) as LlmError;
    expect(error.message).toContain("[REDACTED:openai-key]");
    expect(error.message).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(error.message.length).toBeLessThan(450);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially", () => {
    expect([0, 1, 2].map((a) => retryDelayMs(a, 500, null))).toEqual([500, 1000, 2000]);
  });

  it("honours Retry-After seconds but never less than the backoff, and caps at 30 s", () => {
    expect(retryDelayMs(0, 500, "3")).toBe(3000);
    expect(retryDelayMs(2, 500, "0")).toBe(2000);
    expect(retryDelayMs(0, 500, "9999")).toBe(30_000);
  });

  it("honours an HTTP-date Retry-After", () => {
    const when = new Date(Date.now() + 5000).toUTCString();
    const delay = retryDelayMs(0, 500, when);
    expect(delay).toBeGreaterThan(3000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it("ignores garbage", () => {
    expect(retryDelayMs(1, 500, "soon")).toBe(1000);
  });
});

describe("readBody", () => {
  const streamOf = (...parts: string[]): Response =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
          controller.close();
        },
      }),
    );

  it("yields every chunk", async () => {
    const chunks = await drain(readBody(streamOf("a", "b"), 1000));
    expect(chunks.map((c) => new TextDecoder().decode(c))).toEqual(["a", "b"]);
  });

  it("fails with a timeout when the stream goes silent", async () => {
    const silent = new Response(new ReadableStream({ start() {} }));
    await expect(drain(readBody(silent, 20))).rejects.toMatchObject({ kind: "timeout" });
  });

  it("fails promptly on abort", async () => {
    const controller = new AbortController();
    const silent = new Response(new ReadableStream({ start() {} }));
    const pending = drain(readBody(silent, 10_000, controller.signal));
    setTimeout(() => {
      controller.abort();
    }, 10);
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
  });

  it("rejects a response with no body", async () => {
    await expect(drain(readBody(new Response(null), 100))).rejects.toMatchObject({
      kind: "protocol",
    });
  });
});

describe("defaultSleep", () => {
  it("resolves after the delay", async () => {
    const start = Date.now();
    await defaultSleep(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it("rejects as soon as the signal aborts", async () => {
    const controller = new AbortController();
    const pending = defaultSleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
  });

  it("rejects immediately when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(defaultSleep(10_000, controller.signal)).rejects.toMatchObject({
      kind: "aborted",
    });
  });
});
