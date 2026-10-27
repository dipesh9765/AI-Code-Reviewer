import { describe, expect, it } from "vitest";
import { LlmError } from "../../src/core/errors";
import { reviewText, type ReviewOptions } from "../../src/core/review";
import { fakeProvider } from "./helpers";

const finding = (
  line: number,
  severity = "warning",
  message = `issue at ${String(line)}`,
): object => ({
  line,
  severity,
  category: "bug",
  message,
});
const answer = (...f: object[]): string => JSON.stringify({ findings: f });

const options = (
  over: Partial<ReviewOptions> & Pick<ReviewOptions, "provider">,
): ReviewOptions => ({
  model: "m",
  fileName: "a.ts",
  languageId: "typescript",
  text: "l1\nl2\nl3\nl4\nl5",
  maxInputChars: 10_000,
  redact: true,
  minSeverity: "info",
  ...over,
});

describe("reviewText", () => {
  it("returns validated findings for a small file in one request", async () => {
    const provider = fakeProvider([answer(finding(2), finding(4, "error"))]);
    const result = await reviewText(options({ provider }));
    expect(provider.calls).toHaveLength(1);
    expect(result.findings.map((f) => f.line)).toEqual([2, 4]);
    expect(result.chunks).toBe(1);
  });

  it("sends the system prompt, numbered code and a deterministic temperature", async () => {
    const provider = fakeProvider([answer()]);
    await reviewText(options({ provider }));
    const call = provider.calls[0];
    expect(call?.system).toMatch(/JSON/);
    expect(call?.temperature).toBe(0);
    expect(call?.messages[0]?.content).toContain("1 | l1");
  });

  it("redacts secrets before sending and reports how many", async () => {
    const provider = fakeProvider([answer()]);
    const result = await reviewText(
      options({ provider, text: 'const k = "sk-proj-abcdefghijklmnopqrstuvwx";\nok()' }),
    );
    expect(provider.calls[0]?.messages[0]?.content).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(result.redactions).toBe(1);
    expect(result.redactionKinds).toEqual({ "openai-key": 1 });
  });

  it("sends the text untouched when redaction is switched off", async () => {
    const provider = fakeProvider([answer()]);
    await reviewText(options({ provider, redact: false, text: "AKIAIOSFODNN7EXAMPLE" }));
    expect(provider.calls[0]?.messages[0]?.content).toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("filters below the minimum severity", async () => {
    const provider = fakeProvider([
      answer(finding(1, "info"), finding(2, "warning"), finding(3, "error")),
    ]);
    const result = await reviewText(options({ provider, minSeverity: "warning" }));
    expect(result.findings.map((f) => f.severity)).toEqual(["warning", "error"]);
  });

  it("counts findings the model got wrong rather than showing them", async () => {
    const provider = fakeProvider([answer(finding(2), finding(99))]);
    const result = await reviewText(options({ provider }));
    expect(result.findings).toHaveLength(1);
    expect(result.droppedFindings).toBe(1);
  });

  it("reviews a selection using absolute line numbers", async () => {
    const provider = fakeProvider([answer(finding(41), finding(2))]);
    const result = await reviewText(options({ provider, firstLine: 40, text: "a\nb\nc" }));
    expect(provider.calls[0]?.messages[0]?.content).toContain("40 | a");
    expect(result.findings.map((f) => f.line)).toEqual([41]);
  });

  it("splits a large file into several requests and merges the findings", async () => {
    const text = Array.from(
      { length: 60 },
      (_, i) => `line ${String(i + 1)} ${"x".repeat(30)}`,
    ).join("\n");
    const provider = fakeProvider([answer(finding(3)), answer(finding(55))]);
    const progress: [number, number][] = [];
    const result = await reviewText(
      options({
        provider,
        text,
        maxInputChars: 800, // ~16 lines per chunk, so 60 lines need 4 chunks but only 2 are allowed
        maxChunks: 2,
        onProgress: (done, total) => progress.push([done, total]),
      }),
    );
    expect(provider.calls).toHaveLength(2);
    expect(result.chunks).toBe(2);
    expect(result.skippedLines).toBeGreaterThan(0);
    expect(result.findings.map((f) => f.line)).toEqual([3]);
    expect(progress.at(-1)).toEqual([2, 2]);
  });

  it("keeps partial results when one chunk fails and reports the error", async () => {
    const text = Array.from(
      { length: 60 },
      (_, i) => `line ${String(i + 1)} ${"x".repeat(30)}`,
    ).join("\n");
    const provider = fakeProvider([answer(finding(3)), new LlmError("server", "boom")]);
    const result = await reviewText(options({ provider, text, maxInputChars: 1500, maxChunks: 2 }));
    expect(result.findings).toHaveLength(1);
    expect(result.chunkErrors).toEqual(["boom"]);
  });

  it("throws when every chunk fails", async () => {
    const provider = fakeProvider([new LlmError("server", "down")]);
    await expect(reviewText(options({ provider }))).rejects.toThrow("down");
  });

  it("treats unparseable output as a failed chunk", async () => {
    const provider = fakeProvider(["I could not review this."]);
    await expect(reviewText(options({ provider }))).rejects.toMatchObject({ kind: "protocol" });
  });

  it("stops immediately on an auth error instead of trying every chunk", async () => {
    const text = Array.from(
      { length: 60 },
      (_, i) => `line ${String(i + 1)} ${"x".repeat(30)}`,
    ).join("\n");
    const provider = fakeProvider([new LlmError("auth", "bad key")]);
    await expect(
      reviewText(options({ provider, text, maxInputChars: 1500 })),
    ).rejects.toMatchObject({
      kind: "auth",
    });
    expect(provider.calls).toHaveLength(1);
  });

  it("propagates cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      reviewText(options({ provider: fakeProvider([answer()]), signal: controller.signal })),
    ).rejects.toThrow();
  });

  it("guards against runaway responses", async () => {
    const provider = fakeProvider(["x".repeat(250_000)]);
    await expect(reviewText(options({ provider }))).rejects.toMatchObject({ kind: "protocol" });
  });

  it("does nothing for empty text", async () => {
    const provider = fakeProvider([answer()]);
    const result = await reviewText(options({ provider, text: "" }));
    expect(result.findings).toEqual([]);
  });
});
