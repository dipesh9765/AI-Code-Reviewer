# 0005. Privacy: keychain, redaction, consent, https-only

Status: accepted

## Context

A code reviewer sends source code to a third party. The prototype kept the key in a module variable (lost on restart) and had no controls on what was sent or where.

## Decision

- API keys are stored with `ExtensionContext.secrets` (the OS keychain), per provider, and are never written to settings, global state or logs.
- Before any request, text is passed through a redactor for common credential shapes (OpenAI/Anthropic/GitHub/AWS/Google/Slack keys, JWTs, bearer tokens, quoted `password=`/`token=`/`api_key=` assignments, PEM private keys). It preserves line counts so findings still map. Users can switch it off, and the consent dialog says so when they have.
- The first request to a remote host shows a modal consent dialog naming the host; the answer is remembered per provider and host.
- Endpoints must be `https://`, except loopback addresses; URLs with embedded credentials are rejected, so a key cannot cross the network in clear text.
- `provider` and `baseUrl` are restricted in untrusted workspaces, so a cloned repository cannot point the extension at an attacker's server.
- Provider error bodies are truncated and redacted before they are shown, since some providers echo part of the key.
- Ollama (or any loopback server) is first-class: nothing leaves the machine and no consent is needed.

## Consequences

- Redaction is best-effort pattern matching and is documented as such; it is not a substitute for choosing a local model for sensitive code.
- Consent adds one click on first use per host.
