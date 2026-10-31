import { describe, expect, it } from "vitest";
import {
  diagnosticMessage,
  findingsToMarkdown,
  rangeForFinding,
  summarise,
} from "../../src/core/present";
import type { Finding } from "../../src/core/types";

const f = (over: Partial<Finding> = {}): Finding => ({
  line: 2,
  endLine: 2,
  severity: "warning",
  category: "bug",
  message: "Something is off",
  ...over,
});
const noNotes = {
  skippedLines: 0,
  truncatedLines: 0,
  redactions: 0,
  droppedFindings: 0,
  chunkErrors: [],
};

describe("rangeForFinding", () => {
  const doc = ["const a = 1;", "    if (x) {", "      go();", "    }"];
  const at = (n: number): string => doc[n] ?? "";

  it("skips indentation on the first line and runs to the end of the last", () => {
    expect(rangeForFinding({ line: 2, endLine: 3 }, doc.length, at)).toEqual({
      startLine: 1,
      startChar: 4,
      endLine: 2,
      endChar: 11,
    });
  });

  it("handles a blank line", () => {
    expect(rangeForFinding({ line: 1, endLine: 1 }, 1, () => "")).toEqual({
      startLine: 0,
      startChar: 0,
      endLine: 0,
      endChar: 0,
    });
  });

  it("clamps lines that no longer exist", () => {
    const range = rangeForFinding({ line: 99, endLine: 120 }, doc.length, at);
    expect(range.startLine).toBe(3);
    expect(range.endLine).toBe(3);
  });

  it("never lets the end precede the start", () => {
    const range = rangeForFinding({ line: 3, endLine: 1 }, doc.length, at);
    expect(range.endLine).toBeGreaterThanOrEqual(range.startLine);
  });
});

describe("messages", () => {
  it("appends the suggestion to the diagnostic text", () => {
    expect(diagnosticMessage(f({ suggestion: "Use ===" }))).toBe(
      "Something is off\nSuggestion: Use ===",
    );
    expect(diagnosticMessage(f())).toBe("Something is off");
  });

  it("summarises counts with correct plurals", () => {
    expect(summarise([])).toBe("no issues");
    expect(
      summarise([f({ severity: "error" }), f({ severity: "error" }), f(), f({ severity: "info" })]),
    ).toBe("2 errors, 1 warning, 1 suggestion");
  });
});

describe("findingsToMarkdown", () => {
  it("says so when there is nothing to report", () => {
    expect(findingsToMarkdown("a.ts", [], noNotes)).toBe("No issues found in `a.ts`.");
  });

  it("lists findings with line ranges and suggestions", () => {
    const md = findingsToMarkdown(
      "a.ts",
      [
        f({ line: 2, endLine: 4, suggestion: "Guard it" }),
        f({ line: 9, endLine: 9, severity: "error" }),
      ],
      noNotes,
    );
    expect(md).toContain("**2 findings in `a.ts`**");
    expect(md).toContain("**lines 2–4** · bug: Something is off");
    expect(md).toContain("Suggestion: Guard it");
    expect(md).toContain("**line 9**");
  });

  it("is honest about what it did not do", () => {
    const md = findingsToMarkdown("a.ts", [f()], {
      skippedLines: 40,
      truncatedLines: 1,
      redactions: 2,
      droppedFindings: 3,
      chunkErrors: ["boom"],
    });
    expect(md).toContain("2 secrets redacted before sending");
    expect(md).toContain("40 lines skipped");
    expect(md).toContain("1 very long lines truncated");
    expect(md).toContain("3 invalid model findings ignored");
    expect(md).toContain("part of the file failed: boom");
  });
});
