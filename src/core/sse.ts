export interface SseEvent {
  event: string | undefined;
  data: string;
}

/**
 * Incremental Server-Sent Events parser (WHATWG HTML spec, section 9.2). Handles frames split
 * across network chunks, CRLF/CR/LF line endings, multi-line `data:` fields, comments, and
 * multi-byte UTF-8 characters that straddle a chunk boundary.
 */
export async function* parseSse(
  body: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let event: string | undefined;
  let data: string[] = [];

  const dispatch = (): SseEvent | undefined => {
    if (data.length === 0) {
      event = undefined;
      return undefined;
    }
    const out = { event, data: data.join("\n") };
    event = undefined;
    data = [];
    return out;
  };

  const handleLine = (line: string): SseEvent | undefined => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    return undefined;
  };

  for await (const chunk of body) {
    signal?.throwIfAborted();
    buffer += decoder.decode(chunk, { stream: true });
    let start = 0;
    for (;;) {
      const lineEnd = findLineEnd(buffer, start);
      if (lineEnd === undefined) break;
      const out = handleLine(buffer.slice(start, lineEnd.index));
      start = lineEnd.next;
      if (out) yield out;
    }
    buffer = buffer.slice(start);
  }

  buffer += decoder.decode();
  // A stream that ends without a trailing blank line still delivers its last complete line.
  for (const line of buffer.split(/\r\n|\r|\n/)) {
    const out = handleLine(line);
    if (out) yield out;
  }
  const last = dispatch();
  if (last) yield last;
}

/**
 * Finds the end of the next line starting at `from`. A lone CR at the very end of the buffer is
 * ambiguous (it may be the first half of CRLF), so it is left for the next chunk.
 */
function findLineEnd(buffer: string, from: number): { index: number; next: number } | undefined {
  for (let i = from; i < buffer.length; i++) {
    const c = buffer[i];
    if (c === "\n") return { index: i, next: i + 1 };
    if (c === "\r") {
      if (i + 1 >= buffer.length) return undefined;
      return { index: i, next: buffer[i + 1] === "\n" ? i + 2 : i + 1 };
    }
  }
  return undefined;
}
