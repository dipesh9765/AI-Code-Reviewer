export interface Chunk {
  /** 1-based number of the first line of the chunk in the document. */
  firstLine: number;
  lines: string[];
}

export interface ChunkResult {
  chunks: Chunk[];
  /** Lines that did not fit within `maxChunks` and will not be reviewed. */
  skippedLines: number;
  /** Lines cut down to `maxChars` (e.g. minified bundles). */
  truncatedLines: number;
}

const GUTTER_OVERHEAD = 10; // "12345 | " plus the newline, per line

/**
 * Splits a file into consecutive chunks of whole lines that each stay under `maxChars`, so that
 * a large file becomes several bounded requests instead of one that exceeds the model's context
 * (or the user's wallet). Line numbers stay absolute, so findings need no remapping.
 */
export function chunkLines(
  lines: readonly string[],
  firstLine: number,
  maxChars: number,
  maxChunks: number,
): ChunkResult {
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentStart = firstLine;
  let size = 0;
  let truncatedLines = 0;
  let consumed = 0;

  const flush = (): void => {
    if (current.length > 0) chunks.push({ firstLine: currentStart, lines: current });
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? "";
    if (line.length > maxChars - GUTTER_OVERHEAD) {
      line = line.slice(0, Math.max(maxChars - GUTTER_OVERHEAD - 14, 0)) + " …[truncated]";
      truncatedLines++;
    }
    const cost = line.length + GUTTER_OVERHEAD;
    if (current.length > 0 && size + cost > maxChars) {
      flush();
      if (chunks.length >= maxChunks) {
        return { chunks, skippedLines: lines.length - consumed, truncatedLines };
      }
      current = [];
      size = 0;
      currentStart = firstLine + i;
    }
    current.push(line);
    size += cost;
    consumed = i + 1;
  }
  flush();
  return { chunks, skippedLines: 0, truncatedLines };
}
