import { LlmError } from "./errors";
import type { Category, Finding, Severity } from "./types";

const MAX_MESSAGE = 600;
const MAX_SUGGESTION = 1200;
const CATEGORIES: readonly Category[] = [
  "bug",
  "security",
  "performance",
  "maintainability",
  "style",
];

const SEVERITY_ALIASES: Record<string, Severity> = {
  error: "error",
  critical: "error",
  high: "error",
  major: "error",
  warning: "warning",
  warn: "warning",
  medium: "warning",
  moderate: "warning",
  info: "info",
  low: "info",
  minor: "info",
  suggestion: "info",
  nit: "info",
  note: "info",
};

export interface ParseContext {
  /** Valid line range for this chunk, inclusive and 1-based. */
  firstLine: number;
  lastLine: number;
}

export interface ParseResult {
  findings: Finding[];
  /** Entries the model returned that failed validation (bad line, empty message, ...). */
  dropped: number;
}

/** Control characters other than tab/newline have no business in a diagnostic message. */
function clean(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

/**
 * Pulls the first JSON value out of free text: a bare object/array, one wrapped in a ```json
 * fence, or one surrounded by prose. Brace matching is string-aware so that braces inside
 * messages do not confuse it.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // fall through to the scanner
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim()) as unknown;
    } catch {
      // keep scanning
    }
  }
  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== "{" && open !== "[") continue;
    const end = matchingClose(text, start);
    if (end === -1) continue;
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
      // not valid JSON; try the next opener
    }
  }
  return undefined;
}

function matchingClose(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function asLine(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}

/**
 * Turns a model response into validated findings. The model is untrusted input: anything that
 * does not fit the schema or points outside the reviewed lines is dropped, never "repaired" into
 * a diagnostic on the wrong line.
 */
export function parseFindings(raw: string, context: ParseContext): ParseResult {
  const json = extractJson(raw);
  const list: unknown = Array.isArray(json)
    ? json
    : (json as { findings?: unknown } | null | undefined)?.findings;
  if (!Array.isArray(list)) {
    throw new LlmError(
      "protocol",
      "The model did not return findings in the expected JSON format.",
      {
        retryable: false,
      },
    );
  }

  const findings: Finding[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) {
      dropped++;
      continue;
    }
    const entry = item as Record<string, unknown>;
    const line = asLine(entry.line);
    const message = typeof entry.message === "string" ? clean(entry.message, MAX_MESSAGE) : "";
    if (line === undefined || line < context.firstLine || line > context.lastLine || !message) {
      dropped++;
      continue;
    }
    const rawEnd = asLine(entry.endLine) ?? line;
    const endLine = Math.min(Math.max(rawEnd, line), context.lastLine);
    const severity =
      typeof entry.severity === "string"
        ? (SEVERITY_ALIASES[entry.severity.toLowerCase()] ?? "info")
        : "info";
    const category = CATEGORIES.find((c) => c === entry.category) ?? "maintainability";
    const suggestion =
      typeof entry.suggestion === "string" ? clean(entry.suggestion, MAX_SUGGESTION) : "";

    const key = `${line}:${message.toLowerCase().replace(/\W+/g, " ").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      line,
      endLine,
      severity,
      category,
      message,
      ...(suggestion ? { suggestion } : {}),
    });
  }
  findings.sort((a, b) => a.line - b.line || a.message.localeCompare(b.message));
  return { findings, dropped };
}
