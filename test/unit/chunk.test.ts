import { describe, expect, it } from "vitest";
import { chunkLines } from "../../src/core/chunk";
import { buildAskMessage, buildUserMessage, numberLines } from "../../src/core/prompt";

const lines = (n: number, width = 20): string[] =>
  Array.from({ length: n }, (_, i) => `l${String(i)}`.padEnd(width, "."));

describe("chunkLines", () => {
  it("keeps a small file in one chunk", () => {
    const r = chunkLines(lines(5), 1, 10_000, 6);
    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0]).toMatchObject({ firstLine: 1 });
    expect(r.skippedLines).toBe(0);
  });

  it("splits at line boundaries with absolute, contiguous numbering", () => {
    const input = lines(100);
    const r = chunkLines(input, 1, 300, 100);
    expect(r.chunks.length).toBeGreaterThan(1);
    let expected = 1;
    for (const c of r.chunks) {
      expect(c.firstLine).toBe(expected);
      expected += c.lines.length;
    }
    expect(expected - 1).toBe(100);
    expect(r.chunks.flatMap((c) => c.lines)).toEqual(input);
  });

  it("offsets numbering for a selection that starts mid-file", () => {
    const r = chunkLines(lines(4), 40, 10_000, 6);
    expect(r.chunks[0]?.firstLine).toBe(40);
  });

  it("caps the number of chunks and reports what was skipped", () => {
    const r = chunkLines(lines(100), 1, 300, 2);
    expect(r.chunks).toHaveLength(2);
    const reviewed = r.chunks.reduce((n, c) => n + c.lines.length, 0);
    expect(r.skippedLines).toBe(100 - reviewed);
    expect(r.skippedLines).toBeGreaterThan(0);
  });

  it("truncates a single huge line instead of sending it whole", () => {
    const r = chunkLines(["short", "x".repeat(50_000), "tail"], 1, 1000, 6);
    expect(r.truncatedLines).toBe(1);
    const all = r.chunks.flatMap((c) => c.lines);
    expect(all).toHaveLength(3);
    expect(all.every((l) => l.length < 1000)).toBe(true);
    expect(all[1]).toMatch(/…\[truncated\]$/);
  });

  it("returns no chunks for empty input", () => {
    expect(chunkLines([], 1, 1000, 6)).toEqual({ chunks: [], skippedLines: 0, truncatedLines: 0 });
  });
});

describe("prompt building", () => {
  it("numbers lines with a stable gutter width", () => {
    expect(numberLines(["a", "b"], 9)).toBe(" 9 | a\n10 | b");
  });

  it("states the file, language and range", () => {
    const text = buildUserMessage({
      fileName: "a.ts",
      languageId: "typescript",
      lines: ["x", "y"],
      firstLine: 3,
    });
    expect(text).toContain("File: a.ts (typescript), lines 3-4");
    expect(text).toContain("3 | x");
  });

  it("puts the question before the code in ask mode", () => {
    const text = buildAskMessage("why?", {
      fileName: "a",
      languageId: "c",
      lines: ["z"],
      firstLine: 1,
    });
    expect(text.startsWith("why?")).toBe(true);
    expect(text).toContain("1 | z");
  });
});
