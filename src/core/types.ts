export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface CompletionRequest {
  model: string;
  /** System prompt, kept separate because Anthropic takes it out-of-band. */
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * The only thing the review pipeline knows about a model vendor. Adding a provider means
 * implementing this one method; nothing else in the extension changes.
 */
export interface LlmProvider {
  readonly id: string;
  /** Yields text deltas as they arrive. Must honour `request.signal`. */
  stream(request: CompletionRequest): AsyncIterable<string>;
}

export type Severity = "info" | "warning" | "error";

export type Category = "bug" | "security" | "performance" | "maintainability" | "style";

export interface Finding {
  /** 1-based, inclusive. */
  line: number;
  endLine: number;
  severity: Severity;
  category: Category;
  message: string;
  suggestion?: string;
}

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };
