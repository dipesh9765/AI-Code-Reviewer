export interface RedactionResult {
  text: string;
  /** How many values were replaced, by kind. Empty when nothing matched. */
  counts: Record<string, number>;
  total: number;
}

interface Rule {
  kind: string;
  pattern: RegExp;
}

// Ordered most-specific first so that, for example, an Anthropic key is not reported as a
// generic "sk-" key. Patterns must not span lines (except private keys, handled separately) so
// that line numbers in the redacted text still match the original.
const RULES: Rule[] = [
  { kind: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  {
    kind: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g,
  },
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: "bearer-token",
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/g,
  },
  {
    // password = "hunter2hunter2", "api_key": 'abc...', secret: abc... (quoted values only, so that
    // `const token = getToken()` is left alone).
    kind: "credential-assignment",
    pattern:
      /\b((?:[A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z0-9_]*)["']?\s*[:=]\s*)(["'`])([^"'`\r\n]{8,})\2/gi,
  },
];

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PRIVATE_KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;

export function placeholder(kind: string): string {
  return `[REDACTED:${kind}]`;
}

/**
 * Replaces credentials with placeholders before text leaves the machine. Line count is
 * preserved exactly (a multi-line private key becomes the same number of lines), because the
 * model reports findings by line number and those must map back onto the real document.
 */
export function redactSecrets(input: string): RedactionResult {
  const counts: Record<string, number> = {};
  const bump = (kind: string): void => {
    counts[kind] = (counts[kind] ?? 0) + 1;
  };

  const lines = input.split("\n");
  let inKey = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? "";
    if (inKey) {
      const ends = PRIVATE_KEY_END.test(line);
      lines[i] = ends ? placeholder("private-key") : "";
      if (ends) inKey = false;
      continue;
    }
    if (PRIVATE_KEY_BEGIN.test(line)) {
      bump("private-key");
      if (PRIVATE_KEY_END.test(line)) {
        lines[i] = placeholder("private-key");
      } else {
        inKey = true;
        lines[i] = placeholder("private-key");
      }
      continue;
    }
    for (const rule of RULES) {
      line = line.replace(rule.pattern, (...args: unknown[]) => {
        bump(rule.kind);
        if (rule.kind === "bearer-token") return `${String(args[1])}${placeholder(rule.kind)}`;
        if (rule.kind === "credential-assignment") {
          const [, prefix, quote] = args as [string, string, string];
          return `${prefix}${quote}${placeholder(rule.kind)}${quote}`;
        }
        return placeholder(rule.kind);
      });
    }
    lines[i] = line;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { text: lines.join("\n"), counts, total };
}
