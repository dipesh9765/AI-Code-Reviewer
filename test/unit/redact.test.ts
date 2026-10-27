import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/core/redact";

describe("redactSecrets", () => {
  it.each([
    ["anthropic-key", "const k = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA';"],
    ["openai-key", "OPENAI=sk-proj-abcdefghijklmnopqrstuvwx"],
    ["github-token", "token ghp_0123456789abcdefghijklmnopqrstuvwxyz12"],
    ["aws-access-key", "id = AKIAIOSFODNN7EXAMPLE"],
    ["google-api-key", "key=AIzaSyA-1234567890abcdefghijklmnopqrstu"],
    ["slack-token", "xoxb-1234567890-abcdefghij"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"],
  ])("redacts a %s", (kind, source) => {
    const result = redactSecrets(source);
    expect(result.counts[kind]).toBe(1);
    expect(result.text).toContain(`[REDACTED:${kind}]`);
  });

  it("keeps the Bearer scheme and redacts only the token", () => {
    const { text, counts } = redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123");
    expect(text).toBe("Authorization: Bearer [REDACTED:bearer-token]");
    expect(counts["bearer-token"]).toBe(1);
  });

  it("redacts quoted credential assignments but keeps the key name and quotes", () => {
    const { text } = redactSecrets(`const password = "hunter2hunter2";\n"api_key": 'abcdefghijkl'`);
    expect(text).toBe(
      `const password = "[REDACTED:credential-assignment]";\n"api_key": '[REDACTED:credential-assignment]'`,
    );
  });

  it("leaves ordinary code alone", () => {
    const code = [
      "const token = getToken();",
      "const password = readline();",
      "const short = 'abc';",
      "if (secret) return;",
      "const apiKey = process.env.API_KEY;",
    ].join("\n");
    const result = redactSecrets(code);
    expect(result.text).toBe(code);
    expect(result.total).toBe(0);
  });

  it("replaces a multi-line private key but preserves the line count", () => {
    const source = [
      "const a = 1;",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA1111111111",
      "2222222222222222222222",
      "-----END RSA PRIVATE KEY-----",
      "const b = 2;",
    ].join("\n");
    const { text, counts } = redactSecrets(source);
    expect(text.split("\n")).toHaveLength(6);
    expect(counts["private-key"]).toBe(1);
    expect(text).not.toContain("MIIEp");
    expect(text.split("\n")[0]).toBe("const a = 1;");
    expect(text.split("\n")[5]).toBe("const b = 2;");
  });

  it("handles a private key on a single line", () => {
    const { text, counts } = redactSecrets(
      "x = '-----BEGIN PRIVATE KEY----- abc -----END PRIVATE KEY-----'",
    );
    expect(counts["private-key"]).toBe(1);
    expect(text).toBe("[REDACTED:private-key]");
  });

  it("counts several secrets on one line", () => {
    const { total } = redactSecrets("a=AKIAIOSFODNN7EXAMPLE b=AKIAIOSFODNN7EXAMPLF");
    expect(total).toBe(2);
  });

  it("preserves the number of lines for arbitrary input", () => {
    const source = "a\n\n-----BEGIN PRIVATE KEY-----\nx\n";
    expect(redactSecrets(source).text.split("\n")).toHaveLength(source.split("\n").length);
  });
});
