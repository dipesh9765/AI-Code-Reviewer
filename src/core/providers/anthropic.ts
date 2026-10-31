import { LlmError } from "../errors";
import { type HttpOptions, postJson, readBody } from "../http";
import { parseSse } from "../sse";
import type { CompletionRequest, LlmProvider } from "../types";

export interface AnthropicConfig {
  baseUrl: string;
  apiKey: string;
  http: HttpOptions;
}

const API_VERSION = "2023-06-01";

interface AnthropicEvent {
  type?: string;
  delta?: { type?: string; text?: string };
  error?: { type?: string; message?: string };
}

/** Anthropic Messages API with streaming. */
export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  private readonly config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    this.config = config;
  }

  async *stream(request: CompletionRequest): AsyncGenerator<string> {
    const { baseUrl, apiKey, http } = this.config;
    const response = await postJson(
      `${baseUrl.replace(/\/+$/, "")}/v1/messages`,
      { "x-api-key": apiKey, "anthropic-version": API_VERSION },
      {
        model: request.model,
        max_tokens: request.maxTokens,
        stream: true,
        ...(request.system ? { system: request.system } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        messages: request.messages.filter((m) => m.role !== "system"),
      },
      http,
      request.signal,
    );

    for await (const event of parseSse(
      readBody(response, http.timeoutMs, request.signal),
      request.signal,
    )) {
      let payload: AnthropicEvent;
      try {
        payload = JSON.parse(event.data) as AnthropicEvent;
      } catch (error) {
        throw new LlmError("protocol", "The provider sent a malformed stream event.", {
          cause: error,
        });
      }
      switch (payload.type) {
        case "content_block_delta":
          if (payload.delta?.type === "text_delta" && payload.delta.text) yield payload.delta.text;
          break;
        case "message_stop":
          return;
        case "error":
          throw new LlmError(
            payload.error?.type === "overloaded_error" ? "server" : "bad_request",
            `The provider reported an error: ${payload.error?.message ?? "unknown"}`,
            { retryable: false },
          );
        default:
          break; // message_start, ping, content_block_start/stop, message_delta
      }
    }
  }
}
