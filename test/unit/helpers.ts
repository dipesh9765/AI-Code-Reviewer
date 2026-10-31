import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { CompletionRequest, LlmProvider } from "../../src/core/types";

export interface TestServer {
  url: string;
  requests: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[];
  close(): Promise<void>;
}

export async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string, n: number) => void,
): Promise<TestServer> {
  const requests: TestServer["requests"] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      });
      handler(req, res, body, requests.length);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

export function sseHeaders(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
}

/** A provider that replays canned responses, one per call, and records what it was asked. */
export function fakeProvider(
  responses: (string | Error)[],
): LlmProvider & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    id: "fake",
    calls,
    // eslint-disable-next-line @typescript-eslint/require-await
    async *stream(request: CompletionRequest) {
      calls.push(request);
      const next = responses[calls.length - 1] ?? responses[responses.length - 1] ?? "";
      if (next instanceof Error) throw next;
      // Deliver in small pieces so tests exercise the accumulation path.
      for (let i = 0; i < next.length; i += 7) yield next.slice(i, i + 7);
    },
  };
}

export const noSleep = (): Promise<void> => Promise.resolve();

export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function* chunksOf(...parts: (string | Uint8Array)[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield typeof part === "string" ? bytes(part) : part;
}

export async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
