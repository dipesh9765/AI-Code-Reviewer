import type { Finding } from "./types";

/** A text edit in the coordinates VS Code reports: 0-based lines and columns. */
export interface LineEdit {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  text: string;
}

function newlines(text: string): number {
  let count = 0;
  for (const c of text) if (c === "\n") count++;
  return count;
}

/**
 * Keeps findings attached to the right code while the user edits. Findings below the edit move
 * with the text, findings above it stay, and findings on a line that was changed are dropped,
 * because the model's comment may no longer describe what is there. Pure so it is testable.
 */
export function shiftFindings(findings: readonly Finding[], edit: LineEdit): Finding[] {
  const isEmptyEdit =
    edit.text === "" && edit.startLine === edit.endLine && edit.startChar === edit.endChar;
  if (isEmptyEdit) return [...findings];

  const delta = newlines(edit.text) - (edit.endLine - edit.startLine);
  const oldStart = edit.startLine + 1;
  let oldEnd = edit.endLine + 1;

  // Whole lines inserted at column 0 push existing lines down without touching them.
  const insertsWholeLines =
    edit.startLine === edit.endLine &&
    edit.startChar === 0 &&
    edit.endChar === 0 &&
    edit.text.endsWith("\n");
  // A range ending at column 0 of a later line does not modify that later line.
  if (!insertsWholeLines && edit.endChar === 0 && edit.endLine > edit.startLine) oldEnd -= 1;

  const out: Finding[] = [];
  for (const f of findings) {
    if (insertsWholeLines) {
      // Lines at or below the insertion point move; a finding that spans it grows.
      out.push({
        ...f,
        line: f.line >= oldStart ? f.line + delta : f.line,
        endLine: f.endLine >= oldStart ? f.endLine + delta : f.endLine,
      });
    } else if (f.endLine < oldStart) {
      out.push(f);
    } else if (f.line > oldEnd) {
      out.push(delta === 0 ? f : { ...f, line: f.line + delta, endLine: f.endLine + delta });
    }
    // otherwise the edit overlaps the finding: drop it
  }
  return out;
}
