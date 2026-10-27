# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [1.0.0] - 2026-10-27

Ground-up rewrite. The previous JavaScript prototype (a chat participant that only worked with a pre-created OpenAI Assistant, kept its key in memory, and could not run once packaged) and the `Continue-ai-extension` scaffold were merged into this single TypeScript extension.

### Added

- Inline review: findings as diagnostics with severity, category and suggested fix; quick fixes (copy suggestion, dismiss).
- Findings follow edits, including edits made while a review is running.
- Providers: OpenAI, Anthropic, Ollama and any OpenAI-compatible endpoint, over `fetch` with SSE streaming, retries with backoff, timeouts and cancellation.
- Privacy controls: keys in SecretStorage, secret redaction, first-use consent for remote hosts, https-only endpoints, restricted settings in untrusted workspaces.
- Large files split into bounded chunks; skipped, truncated and dropped content is reported.
- `@reviewer` chat participant (`/review` or a free-form question).
- Optional Continue context provider.
- 137 unit tests, 7 integration tests in a real extension host, CI, esbuild bundle (about 30 KB, no runtime dependencies), `.vsix` packaging.

### Removed

- OpenAI Assistants API usage, the hard dependency on GitHub Copilot Chat and Continue, `activationEvents: ["*"]`.

### Fixed (relative to the prototype)

- The key was lost on every restart; the extension could not start when packaged (missing `openai` dependency); empty selections sent an object instead of the file text; failures were returned as strings and silently dropped; `fileName.split("/")` broke on Windows paths; the README documented commands that did not exist.
