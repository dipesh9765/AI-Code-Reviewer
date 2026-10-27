import { afterEach, describe, expect, it } from "vitest";
import {
  PROVIDER_DEFAULTS,
  isLoopbackHost,
  parseBaseUrl,
  resolveProvider,
  type ProviderSettings,
} from "../../src/core/providers";
import { AnthropicProvider } from "../../src/core/providers/anthropic";
import { OpenAiCompatibleProvider } from "../../src/core/providers/openai";
import { collect } from "../../src/core/review";
import { noSleep, sseHeaders, startServer, type TestServer } from "./helpers";

const http = { timeoutMs: 2000, sleep: noSleep, baseDelayMs: 1 };
let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const openAiFrame = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

describe("OpenAiCompatibleProvider", () => {
  it("streams deltas, sends the key and puts the system prompt first", async () => {
    server = await startServer((_req, res) => {
      sseHeaders(res);
      res.write(openAiFrame("Hel"));
      res.write(": ping\n\n");
      res.write(openAiFrame("lo"));
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    const provider = new OpenAiCompatibleProvider({
      id: "openai",
      baseUrl: `${server.url}/v1/`,
      apiKey: "sk-test",
      http,
    });
    const text = await collect(provider, {
      model: "m",
      system: "be brief",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 10,
      temperature: 0,
    });
    expect(text).toBe("Hello");

    const request = server.requests[0];
    expect(request?.url).toBe("/v1/chat/completions");
    expect(request?.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(request?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "m",
      stream: true,
      max_tokens: 10,
      temperature: 0,
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
    });
  });

  it("sends no Authorization header when there is no key (Ollama)", async () => {
    server = await startServer((_req, res) => {
      sseHeaders(res);
      res.end(`${openAiFrame("ok")}data: [DONE]\n\n`);
    });
    const provider = new OpenAiCompatibleProvider({ id: "ollama", baseUrl: server.url, http });
    await collect(provider, { model: "m", messages: [], maxTokens: 1 });
    expect(server.requests[0]?.headers.authorization).toBeUndefined();
  });

  it("raises a protocol error on a malformed event", async () => {
    server = await startServer((_req, res) => {
      sseHeaders(res);
      res.end("data: {not json\n\n");
    });
    const provider = new OpenAiCompatibleProvider({ id: "x", baseUrl: server.url, http });
    await expect(
      collect(provider, { model: "m", messages: [], maxTokens: 1 }),
    ).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("raises on an error object inside the stream", async () => {
    server = await startServer((_req, res) => {
      sseHeaders(res);
      res.end(`data: ${JSON.stringify({ error: { message: "model overloaded" } })}\n\n`);
    });
    const provider = new OpenAiCompatibleProvider({ id: "x", baseUrl: server.url, http });
    await expect(collect(provider, { model: "m", messages: [], maxTokens: 1 })).rejects.toThrow(
      /model overloaded/,
    );
  });

  it("maps an HTTP 401 to an auth error and does not retry", async () => {
    server = await startServer((_req, res) => {
      res.writeHead(401).end("nope");
    });
    const provider = new OpenAiCompatibleProvider({ id: "x", baseUrl: server.url, http });
    await expect(
      collect(provider, { model: "m", messages: [], maxTokens: 1 }),
    ).rejects.toMatchObject({
      kind: "auth",
    });
    expect(server.requests).toHaveLength(1);
  });

  it("recovers from a transient 503", async () => {
    server = await startServer((_req, res, _body, n) => {
      if (n === 1) {
        res.writeHead(503).end("busy");
        return;
      }
      sseHeaders(res);
      res.end(`${openAiFrame("fine")}data: [DONE]\n\n`);
    });
    const provider = new OpenAiCompatibleProvider({ id: "x", baseUrl: server.url, http });
    expect(await collect(provider, { model: "m", messages: [], maxTokens: 1 })).toBe("fine");
    expect(server.requests).toHaveLength(2);
  });

  it("can be cancelled mid-stream", async () => {
    server = await startServer((_req, res) => {
      sseHeaders(res);
      res.write(openAiFrame("partial"));
      // never ends
    });
    const controller = new AbortController();
    const provider = new OpenAiCompatibleProvider({ id: "x", baseUrl: server.url, http });
    const seen: string[] = [];
    const run = (async () => {
      for await (const delta of provider.stream({
        model: "m",
        messages: [],
        maxTokens: 1,
        signal: controller.signal,
      })) {
        seen.push(delta);
        controller.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ kind: "aborted" });
    expect(seen).toEqual(["partial"]);
  });
});

describe("AnthropicProvider", () => {
  const frame = (event: string, data: unknown): string =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  it("streams text deltas and sends the key, version and top-level system prompt", async () => {
    server = await startServer((_req, res) => {
      sseHeaders(res);
      res.write(frame("message_start", { type: "message_start" }));
      res.write(frame("content_block_start", { type: "content_block_start" }));
      res.write(
        frame("content_block_delta", {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hi " },
        }),
      );
      res.write(frame("ping", { type: "ping" }));
      res.write(
        frame("content_block_delta", {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "there" },
        }),
      );
      res.write(
        frame("content_block_delta", {
          type: "content_block_delta",
          delta: { type: "input_json_delta", partial_json: "{}" },
        }),
      );
      res.end(frame("message_stop", { type: "message_stop" }));
    });
    const provider = new AnthropicProvider({ baseUrl: server.url, apiKey: "ant-key", http });
    const text = await collect(provider, {
      model: "claude-x",
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 50,
    });
    expect(text).toBe("Hi there");

    const request = server.requests[0];
    expect(request?.url).toBe("/v1/messages");
    expect(request?.headers["x-api-key"]).toBe("ant-key");
    expect(request?.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(request?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "claude-x",
      system: "sys",
      max_tokens: 50,
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("raises on an in-stream error event", async () => {
    server = await startServer((_req, res) => {
      sseHeaders(res);
      res.end(
        frame("error", {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        }),
      );
    });
    const provider = new AnthropicProvider({ baseUrl: server.url, apiKey: "k", http });
    await expect(
      collect(provider, { model: "m", messages: [], maxTokens: 1 }),
    ).rejects.toMatchObject({
      kind: "server",
    });
  });

  it("raises on a malformed event", async () => {
    server = await startServer((_req, res) => {
      sseHeaders(res);
      res.end("data: oops\n\n");
    });
    const provider = new AnthropicProvider({ baseUrl: server.url, apiKey: "k", http });
    await expect(
      collect(provider, { model: "m", messages: [], maxTokens: 1 }),
    ).rejects.toMatchObject({
      kind: "protocol",
    });
  });
});

describe("endpoint safety", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", "LOCALHOST"])("treats %s as loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it("accepts https anywhere and http only on loopback", () => {
    expect(parseBaseUrl("https://api.example.com/v1").hostname).toBe("api.example.com");
    expect(parseBaseUrl("http://localhost:11434/v1").port).toBe("11434");
    expect(() => parseBaseUrl("http://api.example.com/v1")).toThrow(/https/);
    expect(() => parseBaseUrl("http://localhost.evil.com/v1")).toThrow(/https/);
    expect(() => parseBaseUrl("ftp://localhost")).toThrow(/https/);
  });

  it("rejects garbage and credentials embedded in the URL", () => {
    expect(() => parseBaseUrl("not a url")).toThrow(/valid URL/);
    expect(() => parseBaseUrl("https://user:pw@example.com")).toThrow(/credentials/);
  });
});

describe("resolveProvider", () => {
  const settings = (over: Partial<ProviderSettings>): ProviderSettings => ({
    provider: "openai",
    model: "",
    baseUrl: "",
    apiKey: "k",
    http,
    ...over,
  });

  it("uses the provider defaults", () => {
    const r = resolveProvider(settings({}));
    expect(r.model).toBe(PROVIDER_DEFAULTS.openai.model);
    expect(r.baseUrl).toBe("https://api.openai.com/v1");
    expect(r.remote).toBe(true);
    expect(r.provider.id).toBe("openai");
  });

  it("picks the Anthropic implementation", () => {
    expect(resolveProvider(settings({ provider: "anthropic" })).provider.id).toBe("anthropic");
  });

  it("treats Ollama on localhost as local and needing no key", () => {
    const r = resolveProvider(settings({ provider: "ollama", apiKey: undefined }));
    expect(r.remote).toBe(false);
  });

  it("flags a non-loopback Ollama URL as remote", () => {
    const r = resolveProvider(
      settings({ provider: "ollama", baseUrl: "https://gpu.example.com/v1" }),
    );
    expect(r.remote).toBe(true);
  });

  it("requires a key for hosted providers", () => {
    expect(() => resolveProvider(settings({ apiKey: undefined }))).toThrow(/API key/);
  });

  it("requires a URL and a model for the custom provider", () => {
    expect(() => resolveProvider(settings({ provider: "custom", apiKey: undefined }))).toThrow(
      /baseUrl/,
    );
    expect(() =>
      resolveProvider(settings({ provider: "custom", baseUrl: "https://x.example.com/v1" })),
    ).toThrow(/model/);
    const ok = resolveProvider(
      settings({ provider: "custom", baseUrl: "https://x.example.com/v1", model: "m" }),
    );
    expect(ok.model).toBe("m");
  });

  it("rejects plain http to a remote host before any key is sent", () => {
    expect(() => resolveProvider(settings({ baseUrl: "http://api.example.com/v1" }))).toThrow(
      /https/,
    );
  });
});
