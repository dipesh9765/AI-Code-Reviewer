import type { Finding, Severity } from "./types";
import type { ReviewResult } from "./review";

export interface TextRange {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

/**
 * Maps a 1-based finding onto a 0-based editor range that underlines the code, not the
 * indentation: from the first non-blank character of the first line to the end of the last.
 * Out-of-range lines (the document changed under us) are clamped rather than throwing.
 */
export function rangeForFinding(
  finding: Pick<Finding, "line" | "endLine">,
  lineCount: number,
  lineAt: (zeroBased: number) => string,
): TextRange {
  const last = Math.max(lineCount - 1, 0);
  const startLine = Math.min(Math.max(finding.line - 1, 0), last);
  const endLine = Math.min(Math.max(finding.endLine - 1, startLine), last);
  const first = lineAt(startLine);
  const startChar = Math.max(first.length - first.trimStart().length, 0);
  const endChar = lineAt(endLine).length;
  return { startLine, startChar: Math.min(startChar, first.length), endLine, endChar };
}

export function diagnosticMessage(finding: Finding): string {
  return finding.suggestion
    ? `${finding.message}\nSuggestion: ${finding.suggestion}`
    : finding.message;
}

const ICON: Record<Severity, string> = { error: "🔴", warning: "🟠", info: "🔵" };

/** Markdown for the chat view. Model text is untrusted; VS Code renders it without trust. */
export function findingsToMarkdown(
  fileName: string,
  findings: readonly Finding[],
  result: Pick<
    ReviewResult,
    "skippedLines" | "truncatedLines" | "redactions" | "droppedFindings" | "chunkErrors"
  >,
): string {
  const out: string[] = [];
  if (findings.length === 0) {
    out.push(`No issues found in \`${fileName}\`.`);
  } else {
    out.push(
      `**${String(findings.length)} finding${findings.length === 1 ? "" : "s"} in \`${fileName}\`**\n`,
    );
    for (const f of findings) {
      const where =
        f.endLine > f.line
          ? `lines ${String(f.line)}–${String(f.endLine)}`
          : `line ${String(f.line)}`;
      out.push(`- ${ICON[f.severity]} **${where}** · ${f.category}: ${f.message}`);
      if (f.suggestion) out.push(`  - Suggestion: ${f.suggestion}`);
    }
  }
  const notes: string[] = [];
  if (result.redactions > 0) {
    notes.push(
      `${String(result.redactions)} secret${result.redactions === 1 ? "" : "s"} redacted before sending`,
    );
  }
  if (result.skippedLines > 0)
    notes.push(`${String(result.skippedLines)} lines skipped (over the size limit)`);
  if (result.truncatedLines > 0)
    notes.push(`${String(result.truncatedLines)} very long lines truncated`);
  if (result.droppedFindings > 0)
    notes.push(`${String(result.droppedFindings)} invalid model findings ignored`);
  for (const error of result.chunkErrors) notes.push(`part of the file failed: ${error}`);
  if (notes.length > 0) out.push(`\n_${notes.join(" · ")}_`);
  return out.join("\n");
}

export function summarise(findings: readonly Finding[]): string {
  const count = (s: Severity): number => findings.filter((f) => f.severity === s).length;
  const parts: string[] = [];
  if (count("error"))
    parts.push(`${String(count("error"))} error${count("error") === 1 ? "" : "s"}`);
  if (count("warning"))
    parts.push(`${String(count("warning"))} warning${count("warning") === 1 ? "" : "s"}`);
  if (count("info"))
    parts.push(`${String(count("info"))} suggestion${count("info") === 1 ? "" : "s"}`);
  return parts.length === 0 ? "no issues" : parts.join(", ");
}
