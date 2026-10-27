# Progress log

Branch: `overhaul/v1`. Two repositories are merged into this one: **AI-Code-Reviewer** (a working-ish JavaScript chat participant, 8 commits) and **Continue-ai-extension** (a 2-commit scaffold). The merged product is a single TypeScript VS Code extension.

## Audit (read from the code)

### AI-Code-Reviewer (JavaScript, `extension.js`, 240 lines)
| Finding | Where |
|---------|-------|
| `FILE_CONST.OPEN_AI_API_KEY` is an empty string constant; "Change API Key" stores the key only in a module variable, so it is lost on every restart | `extension.js` |
| `@vscode/openai` is listed as a dev dependency (no such package) and `openai` is not a dependency at all, so the packaged extension cannot start | `package.json` |
| Hard dependency on `github.copilot-chat`, `activationEvents: ["*"]` (activates on every launch) | `package.json` |
| `_sendToOpenAIAssistant` requires an Assistants API ID; that API is deprecated by OpenAI, and the ID has to be typed in by hand | `extension.js` |
| Errors are *returned as strings* and silently dropped (`return \`Error: ...\``), so the user sees nothing when a request fails | `_sendTo*` |
| With an empty selection the code sends `editor.selection` (an object) instead of the document text; `fileName.split("/")` breaks on Windows paths | chat handler |
| Verification calls `models.list()` on every key change; the "Change Assistant ID" command shows a warning when the *user cancels* | commands |
| README documents commands (`Review File`, `Review Selected Code`), a sidebar chat and context menu that **do not exist**; screenshots are `via.placeholder.com` links | `README.md` |
| One test: `[1,2,3].indexOf(5) === -1`. No CI | `test/` |
| No cancellation, no timeout, no retry, no size limit on what is sent to a third party, no secret redaction | everywhere |

### Continue-ai-extension (TypeScript, `src/extension.ts`)
- The only live code is a "Custom" context provider that returns the literal string `"Custom content"`, and it runs at **module load time** instead of in `activate()`. There is no `activate` export at all.
- ~130 lines of commented-out code (an earlier attempt that streams into a string and returns before the stream finishes).
- `package.json` has `"type": "module"` while the webpack bundle is `.cjs`, an empty `commands` array, `@continuedev/core` and `openai` as dev dependencies (so they are missing at runtime), name `continue-code-reviewer-ts`, README is the generator template.
- 629 KB lockfile, webpack toolchain for a one-file extension, one placeholder test.

### History
No API keys in either history. One OpenAI Assistant ID (`asst_...`) appears in AI-Code-Reviewer history. It is an identifier, not a credential (it is useless without the owner's API key), but it is noted here.

## Decisions
- The merged extension lives in this repository (`AI-Code-Reviewer`); the Continue integration becomes an optional module (Continue is **not** a hard dependency any more). `Continue-ai-extension` is left untouched; the user decides whether to archive it with a pointer here.
- The prototype is replaced, not patched: nothing in it survives except the idea and the licence.

## Plan
Rebuild as **AI Code Reviewer**: inline, provider-agnostic AI code review for VS Code.

| Step | Deliverable |
|------|-------------|
| A | Scaffold: TypeScript strict, esbuild bundle, ESLint, Prettier, Vitest, `.vscodeignore`, `vsce package` |
| B | `src/core` (no `vscode` import, fully unit-testable): LLM provider interface; OpenAI-compatible and Anthropic providers on plain `fetch`; SSE parser; retry with backoff; timeout and cancellation |
| C | Review pipeline: prompt builder, secret redaction, size limit, chunking of long files, tolerant JSON findings parser, validation against the document, de-duplication |
| D | VS Code layer: SecretStorage for keys, settings, inline diagnostics, quick-fix/code actions, `@reviewer` chat participant, commands, status bar, first-use consent for remote providers |
| E | Optional Continue context provider (the second repo's idea, done correctly) |
| F | Tests (unit with a local mock HTTP server, SSE edge cases, parser fuzz-ish cases, extension-host integration tests if the host can run), coverage gate |
| G | CI, docs (README, ARCHITECTURE, ADRs, SECURITY, CONTRIBUTING, CHANGELOG), `.vsix`, resume bullets |

## Status
- [x] Audit
- [ ] A–G
