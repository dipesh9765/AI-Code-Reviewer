# Contributing

## Setup

```bash
npm ci
npm run check            # typecheck, lint, format check, unit tests (coverage gate 90%)
npm run test:integration # real VS Code; needs a display (Linux CI uses xvfb)
```

Press `F5` in VS Code to launch an Extension Development Host. `npm run watch` rebuilds on change.

To run the integration tests against an already installed VS Code instead of downloading one, set `VSCODE_EXECUTABLE` to its executable.

## Ground rules

- **`src/core` must not import `vscode`.** A lint rule enforces it. Put logic there as pure functions and unit-test it; keep `src/vscode` thin.
- Every behaviour change needs a test. Protocol and parsing code is tested against a real local HTTP server (`test/unit/helpers.ts`), not by mocking `fetch`.
- No runtime dependencies without an ADR. The bundle is intentionally one dependency-free file.
- Treat model output as untrusted (ADR 0004): validate, never repair, never act on it.
- Never log or display request headers, keys or full request bodies.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Adding a provider

Implement `LlmProvider` (`src/core/types.ts`): one `stream()` method yielding text deltas and honouring `request.signal`. Reuse `postJson`, `readBody` and `parseSse` for transport. Register it in `src/core/providers/index.ts` (defaults, key requirement, `resolveProvider`) and in the `aiCodeReviewer.provider` enum in `package.json`. Add tests that run the provider against a local server that speaks the vendor's wire format, including an in-stream error and a malformed event.
