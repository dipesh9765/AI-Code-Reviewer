# 0002. Talk to providers with `fetch`, not vendor SDKs

Status: accepted

## Context

The prototype imported the `openai` SDK (and listed a non-existent `@vscode/openai` package, so the packaged extension could not start). Supporting several vendors with SDKs means several large dependencies, each with its own auth, retry and streaming behaviour, all bundled into an extension that is installed on developer machines.

## Decision

Implement the two wire protocols directly on Node's built-in `fetch`: the OpenAI-compatible `/chat/completions` stream (which Ollama, LM Studio, vLLM, OpenRouter and Groq also speak) and Anthropic's Messages stream. A small shared layer provides Server-Sent Events parsing, retry with backoff, timeouts and cancellation.

## Consequences

- The bundle is about 30 KB with zero runtime dependencies; there is no supply-chain surface beyond the build tools.
- Behaviour is uniform across providers and fully testable against a local HTTP server, which the unit tests do for both dialects.
- We own protocol maintenance. A new provider that is not OpenAI-compatible costs one class (about 60 lines) implementing `LlmProvider`.
- Features the SDKs add (tool calling, files, batch APIs) are out of scope; the review use case needs only text streaming.
