import { LlmError } from "../errors";
import type { HttpOptions } from "../http";
import type { LlmProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { OpenAiCompatibleProvider } from "./openai";

export type ProviderId = "openai" | "anthropic" | "ollama" | "custom";

export const PROVIDER_IDS: readonly ProviderId[] = ["openai", "anthropic", "ollama", "custom"];

interface ProviderDefaults {
  baseUrl: string;
  model: string;
  needsKey: boolean;
  label: string;
}

export const PROVIDER_DEFAULTS: Record<ProviderId, ProviderDefaults> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    needsKey: true,
    label: "OpenAI",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-haiku-5-5",
    needsKey: true,
    label: "Anthropic",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5-coder",
    needsKey: false,
    label: "Ollama (local)",
  },
  custom: { baseUrl: "", model: "", needsKey: false, label: "Custom OpenAI-compatible" },
};

export interface ProviderSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  apiKey: string | undefined;
  http: HttpOptions;
}

export interface ResolvedProvider {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  /** True when requests leave this machine, i.e. the user must consent before the first one. */
  remote: boolean;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}

/**
 * Validates an endpoint. Plain http:// is allowed only for loopback, because an API key sent over
 * http:// to anywhere else crosses the network in the clear.
 */
export function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LlmError("config", `"${raw}" is not a valid URL. Check aiCodeReviewer.baseUrl.`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new LlmError(
      "config",
      "Only https:// endpoints are allowed (plain http:// works for localhost only).",
    );
  }
  if (url.username || url.password) {
    throw new LlmError("config", "Put credentials in the API key setting, not in the URL.");
  }
  return url;
}

export function resolveProvider(settings: ProviderSettings): ResolvedProvider {
  const defaults = PROVIDER_DEFAULTS[settings.provider];
  const baseUrl = (settings.baseUrl.trim() || defaults.baseUrl).trim();
  if (!baseUrl) {
    throw new LlmError("config", "The custom provider needs aiCodeReviewer.baseUrl.");
  }
  const url = parseBaseUrl(baseUrl);
  const model = settings.model.trim() || defaults.model;
  if (!model) {
    throw new LlmError("config", "Set aiCodeReviewer.model for the custom provider.");
  }
  if (defaults.needsKey && !settings.apiKey) {
    throw new LlmError(
      "config",
      `No API key stored for ${defaults.label}. Run "AI Code Reviewer: Set API Key".`,
    );
  }
  const remote = !isLoopbackHost(url.hostname);

  const provider: LlmProvider =
    settings.provider === "anthropic"
      ? new AnthropicProvider({ baseUrl, apiKey: settings.apiKey ?? "", http: settings.http })
      : new OpenAiCompatibleProvider({
          id: settings.provider,
          baseUrl,
          ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
          http: settings.http,
        });
  return { provider, model, baseUrl, remote };
}
