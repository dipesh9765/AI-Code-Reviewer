import type * as vscode from "vscode";
import type { ProviderId } from "../core/providers";

/**
 * API keys live in VS Code's SecretStorage (the OS keychain), one per provider. They are never
 * written to settings.json, the workspace, logs, or the globalState.
 */
export class KeyStore {
  private readonly secrets: vscode.SecretStorage;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  private key(provider: ProviderId): string {
    return `aiCodeReviewer.apiKey.${provider}`;
  }

  async get(provider: ProviderId): Promise<string | undefined> {
    const value = await this.secrets.get(this.key(provider));
    return value?.trim() ? value.trim() : undefined;
  }

  async set(provider: ProviderId, value: string): Promise<void> {
    await this.secrets.store(this.key(provider), value.trim());
  }

  async delete(provider: ProviderId): Promise<void> {
    await this.secrets.delete(this.key(provider));
  }
}

/** Light sanity check; the provider is the authority on whether a key is valid. */
export function validateKeyInput(value: string): string | undefined {
  const v = value.trim();
  if (v.length < 8) return "That looks too short to be an API key.";
  if (/\s/.test(v)) return "API keys do not contain whitespace.";
  return undefined;
}
