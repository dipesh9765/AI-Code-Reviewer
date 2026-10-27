import { describe, expect, it } from "vitest";
import { extractJson, parseFindings } from "../../src/core/parse";

const ctx = { firstLine: 1, lastLine: 50 };
const one = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    findings: [
      { line: 5, endLine: 6, severity: "error", category: "bug", message: "Bad", ...extra },
    ],
  });

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a fenced block", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nDone.')).toEqual({ a: 1 });
  });

  it("finds JSON inside prose", () => {
    expect(extractJson('Sure! {"a":{"b":[1,2]}} hope that helps')).toEqual({ a: { b: [1, 2] } });
  });

  it("is not fooled by braces inside strings", () => {
    expect(extractJson('x {"m":"use } and { carefully \\" ok"} y')).toEqual({
      m: 'use } and { carefully " ok',
    });
  });

  it("skips an unparseable opener and finds the next value", () => {
    expect(extractJson('{oops} then {"a":2}')).toEqual({ a: 2 });
  });

  it("returns undefined when there is no JSON", () => {
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson('{"unterminated": ')).toBeUndefined();
  });
});

describe("parseFindings", () => {
  it("accepts a well-formed finding", () => {
    const { findings, dropped } = parseFindings(one({ suggestion: "Fix it" }), ctx);
    expect(dropped).toBe(0);
    expect(findings).toEqual([
      {
        line: 5,
        endLine: 6,
        severity: "error",
        category: "bug",
        message: "Bad",
        suggestion: "Fix it",
      },
    ]);
  });

  it("accepts a bare array and a fenced answer", () => {
    expect(parseFindings('[{"line":2,"message":"m"}]', ctx).findings).toHaveLength(1);
    expect(parseFindings("```json\n" + one() + "\n```", ctx).findings).toHaveLength(1);
  });

  it("accepts an empty list", () => {
    expect(parseFindings('{"findings":[]}', ctx)).toEqual({ findings: [], dropped: 0 });
  });

  it("throws a protocol error when the answer is not findings", () => {
    expect(() => parseFindings("I think the code is fine.", ctx)).toThrow(/expected JSON/);
    expect(() => parseFindings('{"result":"ok"}', ctx)).toThrow(/expected JSON/);
  });

  it("drops findings outside the reviewed range instead of moving them", () => {
    const raw = JSON.stringify({
      findings: [
        { line: 0, message: "a" },
        { line: 51, message: "b" },
        { line: 3.5, message: "c" },
        { line: "x", message: "d" },
        { line: 10, message: "ok" },
      ],
    });
    const { findings, dropped } = parseFindings(raw, ctx);
    expect(findings.map((f) => f.line)).toEqual([10]);
    expect(dropped).toBe(4);
  });

  it("respects a chunk that does not start at line 1", () => {
    const raw = JSON.stringify({
      findings: [
        { line: 5, message: "a" },
        { line: 120, message: "b" },
      ],
    });
    const { findings } = parseFindings(raw, { firstLine: 100, lastLine: 150 });
    expect(findings.map((f) => f.line)).toEqual([120]);
  });

  it("drops entries with no message or that are not objects", () => {
    const raw = JSON.stringify({
      findings: [
        { line: 1 },
        { line: 2, message: "   " },
        "text",
        null,
        7,
        { line: 3, message: 5 },
      ],
    });
    const { findings, dropped } = parseFindings(raw, ctx);
    expect(findings).toEqual([]);
    expect(dropped).toBe(6);
  });

  it("accepts line numbers given as numeric strings", () => {
    expect(parseFindings('{"findings":[{"line":"7","message":"m"}]}', ctx).findings[0]?.line).toBe(
      7,
    );
  });

  it("repairs endLine: missing, before line, or past the end", () => {
    const raw = JSON.stringify({
      findings: [
        { line: 5, message: "a" },
        { line: 6, endLine: 2, message: "b" },
        { line: 7, endLine: 999, message: "c" },
      ],
    });
    const ends = parseFindings(raw, ctx).findings.map((f) => f.endLine);
    expect(ends).toEqual([5, 6, 50]);
  });

  it("normalises severity aliases and defaults unknown ones to info", () => {
    const sev = (s: unknown): string | undefined =>
      parseFindings(JSON.stringify({ findings: [{ line: 1, message: "m", severity: s }] }), ctx)
        .findings[0]?.severity;
    expect(sev("CRITICAL")).toBe("error");
    expect(sev("Medium")).toBe("warning");
    expect(sev("nit")).toBe("info");
    expect(sev("banana")).toBe("info");
    expect(sev(undefined)).toBe("info");
  });

  it("defaults an unknown category", () => {
    expect(parseFindings(one({ category: "vibes" }), ctx).findings[0]?.category).toBe(
      "maintainability",
    );
  });

  it("strips control characters and caps lengths", () => {
    const { findings } = parseFindings(
      one({ message: `bad\u0000\u0007 ${"x".repeat(2000)}`, suggestion: "y".repeat(5000) }),
      ctx,
    );
    const f = findings[0];
    // eslint-disable-next-line no-control-regex
    expect(f?.message).not.toMatch(/[\u0000-\u0008]/);
    expect(f?.message.length).toBeLessThanOrEqual(600);
    expect(f?.suggestion?.length).toBeLessThanOrEqual(1200);
  });

  it("de-duplicates the same message on the same line and sorts by line", () => {
    const raw = JSON.stringify({
      findings: [
        { line: 9, message: "Possible null dereference." },
        { line: 2, message: "first" },
        { line: 9, message: "possible NULL dereference" },
      ],
    });
    expect(parseFindings(raw, ctx).findings.map((f) => f.line)).toEqual([2, 9]);
  });

  it("omits an empty suggestion", () => {
    expect(parseFindings(one({ suggestion: "  " }), ctx).findings[0]).not.toHaveProperty(
      "suggestion",
    );
  });
});
