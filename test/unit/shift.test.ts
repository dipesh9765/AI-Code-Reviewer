import { describe, expect, it } from "vitest";
import { shiftFindings, type LineEdit } from "../../src/core/shift";
import type { Finding } from "../../src/core/types";

const f = (line: number, endLine = line): Finding => ({
  line,
  endLine,
  severity: "warning",
  category: "bug",
  message: `m${String(line)}`,
});
const edit = (over: Partial<LineEdit>): LineEdit => ({
  startLine: 0,
  startChar: 0,
  endLine: 0,
  endChar: 0,
  text: "",
  ...over,
});
const lines = (list: Finding[]): number[] => list.map((x) => x.line);

describe("shiftFindings", () => {
  it("leaves findings above the edit alone", () => {
    expect(
      lines(
        shiftFindings(
          [f(2)],
          edit({ startLine: 9, endLine: 9, startChar: 3, endChar: 3, text: "x" }),
        ),
      ),
    ).toEqual([2]);
  });

  it("drops a finding on a line that was edited in place", () => {
    // 0-based line 4 is 1-based line 5
    expect(
      shiftFindings(
        [f(5)],
        edit({ startLine: 4, endLine: 4, startChar: 2, endChar: 2, text: "x" }),
      ),
    ).toEqual([]);
  });

  it("shifts findings below an inserted line (Enter in the middle of a line)", () => {
    const out = shiftFindings(
      [f(2), f(8, 10)],
      edit({ startLine: 4, endLine: 4, startChar: 3, endChar: 3, text: "\n" }),
    );
    expect(out.map((x) => [x.line, x.endLine])).toEqual([
      [2, 2],
      [9, 11],
    ]);
  });

  it("shifts up after lines are deleted", () => {
    // delete 0-based lines 3..5 entirely: range (3,0)-(6,0)
    const out = shiftFindings(
      [f(2), f(5), f(10)],
      edit({ startLine: 3, endLine: 6, startChar: 0, endChar: 0 }),
    );
    expect(lines(out)).toEqual([2, 7]);
  });

  it("does not drop the line after a range that ends at column 0", () => {
    // delete line 4 (0-based 3) with its newline: (3,0)-(4,0); old line 5 (0-based 4) moves up
    const out = shiftFindings([f(5)], edit({ startLine: 3, endLine: 4, startChar: 0, endChar: 0 }));
    expect(lines(out)).toEqual([4]);
  });

  it("pushes lines down, unharmed, when whole lines are inserted at column 0", () => {
    const out = shiftFindings(
      [f(3), f(4)],
      edit({ startLine: 3, endLine: 3, startChar: 0, endChar: 0, text: "new\n" }),
    );
    expect(lines(out)).toEqual([3, 5]);
  });

  it("grows a finding that spans a whole-line insertion", () => {
    const out = shiftFindings(
      [f(2, 6)],
      edit({ startLine: 3, endLine: 3, startChar: 0, endChar: 0, text: "a\nb\n" }),
    );
    expect(out.map((x) => [x.line, x.endLine])).toEqual([[2, 8]]);
  });

  it("drops findings overlapped by a multi-line replacement", () => {
    const out = shiftFindings(
      [f(1), f(3, 5), f(9)],
      edit({ startLine: 3, endLine: 4, startChar: 1, endChar: 2, text: "z" }),
    );
    expect(lines(out)).toEqual([1, 8]);
  });

  it("is a no-op for an empty edit", () => {
    const input = [f(1), f(2)];
    expect(shiftFindings(input, edit({}))).toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = [f(8)];
    shiftFindings(input, edit({ startLine: 0, endLine: 0, text: "\n" }));
    expect(input[0]?.line).toBe(8);
  });
});
