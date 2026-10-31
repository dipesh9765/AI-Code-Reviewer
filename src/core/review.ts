import { chunkLines } from "./chunk";
import { LlmError, isAbort } from "./errors";
import { parseFindings } from "./parse";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import { redactSecrets } from "./redact";
import { type Finding, type LlmProvider, SEVERITY_RANK, type Severity } from "./types";

export interface ReviewOptions {
  provider: LlmProvider;
  model: string;
  fileName: string;
  languageId: string;
  text: string;
  /** 1-based line number of the first line of `text` in the document (selections start later). */
  firstLine?: number;
  maxInputChars: number;
  redact: boolean;
  minSeverity: Severity;
  /** Upper bound on requests per review, so one huge file cannot become a surprise bill. */
  maxChunks?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface ReviewResult {
  findings: Finding[];
  chunks: number;
  skippedLines: number;
  truncatedLines: number;
  redactions: number;
  redactionKinds: Record<string, number>;
  /** Findings the model returned that failed validation and were discarded. */
  droppedFindings: number;
  /** Chunks that failed while others succeeded. A review where every chunk fails throws. */
  chunkErrors: string[];
}

const MAX_RESPONSE_CHARS = 200_000;
const REVIEW_MAX_TOKENS = 4096;

export async function collect(
  provider: LlmProvider,
  request: Parameters<LlmProvider["stream"]>[0],
): Promise<string> {
  let text = "";
  for await (const delta of provider.stream(request)) {
    text += delta;
    if (text.length > MAX_RESPONSE_CHARS) {
      throw new LlmError("protocol", "The model's response was unreasonably long; giving up.");
    }
  }
  return text;
}

/**
 * Redacts, chunks and reviews a piece of text, then validates what the model says against the
 * lines that were actually sent. Chunks run sequentially: it keeps rate-limit behaviour simple
 * and lets the user cancel between requests.
 */
export async function reviewText(options: ReviewOptions): Promise<ReviewResult> {
  const firstLine = options.firstLine ?? 1;
  const redaction = options.redact
    ? redactSecrets(options.text)
    : { text: options.text, counts: {}, total: 0 };
  const lines = redaction.text.split("\n");
  const { chunks, skippedLines, truncatedLines } = chunkLines(
    lines,
    firstLine,
    options.maxInputChars,
    options.maxChunks ?? 6,
  );

  const findings: Finding[] = [];
  const chunkErrors: string[] = [];
  let dropped = 0;
  let firstError: unknown;

  for (const [index, chunk] of chunks.entries()) {
    options.signal?.throwIfAborted();
    options.onProgress?.(index, chunks.length);
    try {
      const raw = await collect(options.provider, {
        model: options.model,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserMessage({
              fileName: options.fileName,
              languageId: options.languageId,
              lines: chunk.lines,
              firstLine: chunk.firstLine,
            }),
          },
        ],
        maxTokens: REVIEW_MAX_TOKENS,
        temperature: 0,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const parsed = parseFindings(raw, {
        firstLine: chunk.firstLine,
        lastLine: chunk.firstLine + chunk.lines.length - 1,
      });
      findings.push(...parsed.findings);
      dropped += parsed.dropped;
    } catch (error) {
      // Cancellation, bad credentials and bad configuration will fail identically for every
      // chunk, so stop at once instead of burning through retries.
      if (isAbort(error)) throw error;
      if (error instanceof LlmError && (error.kind === "auth" || error.kind === "config")) {
        throw error;
      }
      firstError ??= error;
      chunkErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  options.onProgress?.(chunks.length, chunks.length);

  if (chunks.length > 0 && chunkErrors.length === chunks.length) throw firstError;

  const visible = findings
    .filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[options.minSeverity])
    .sort((a, b) => a.line - b.line || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return {
    findings: visible,
    chunks: chunks.length,
    skippedLines,
    truncatedLines,
    redactions: redaction.total,
    redactionKinds: redaction.counts,
    droppedFindings: dropped,
    chunkErrors,
  };
}
