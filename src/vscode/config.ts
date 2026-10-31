import * as vscode from "vscode";
import { PROVIDER_IDS, type ProviderId } from "../core/providers";
import type { Severity } from "../core/types";

export interface ExtensionConfig {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  minSeverity: Severity;
  redactSecrets: boolean;
  maxInputChars: number;
  timeoutMs: number;
}

const SEVERITIES: readonly Severity[] = ["info", "warning", "error"];

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, min), max)
    : fallback;
}

export function readConfig(): ExtensionConfig {
  const c = vscode.workspace.getConfiguration("aiCodeReviewer");
  const provider = c.get<string>("provider", "openai");
  const minSeverity = c.get<string>("minSeverity", "info");
  return {
    provider: PROVIDER_IDS.find((p) => p === provider) ?? "openai",
    model: c.get<string>("model", "").trim(),
    baseUrl: c.get<string>("baseUrl", "").trim(),
    minSeverity: SEVERITIES.find((s) => s === minSeverity) ?? "info",
    redactSecrets: c.get<boolean>("redactSecrets", true),
    maxInputChars: clamp(c.get("maxInputChars"), 2000, 400_000, 60_000),
    timeoutMs: clamp(c.get("requestTimeoutSeconds"), 5, 600, 90) * 1000,
  };
}

export async function updateSetting(key: string, value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration("aiCodeReviewer")
    .update(key, value, vscode.ConfigurationTarget.Global);
}
