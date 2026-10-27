# Progress log

Branch: `overhaul/v1`. Two repositories are merged into this one: **AI-Code-Reviewer** (a working-ish JavaScript chat participant, 8 commits) and **Continue-ai-extension** (a 2-commit scaffold). The merged product is a single TypeScript VS Code extension.

## Audit (read from the code)

### AI-Code-Reviewer (JavaScript, `extension.js`, 240 lines)

| Finding                                                                                                                                                               | Where          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `FILE_CONST.OPEN_AI_API_KEY` is an empty string constant; "Change API Key" stores the key only in a module variable, so it is lost on every restart                   | `extension.js` |
| `@vscode/openai` is listed as a dev dependency (no such package) and `openai` is not a dependency at all, so the packaged extension cannot start                      | `package.json` |
| Hard dependency on `github.copilot-chat`, `activationEvents: ["*"]` (activates on every launch)                                                                       | `package.json` |
| `_sendToOpenAIAssistant` requires an Assistants API ID; that API is deprecated by OpenAI, and the ID has to be typed in by hand                                       | `extension.js` |
| Errors are _returned as strings_ and silently dropped (`return \`Error: ...\``), so the user sees nothing when a request fails                                        | `_sendTo*`     |
| With an empty selection the code sends `editor.selection` (an object) instead of the document text; `fileName.split("/")` breaks on Windows paths                     | chat handler   |
| Verification calls `models.list()` on every key change; the "Change Assistant ID" command shows a warning when the _user cancels_                                     | commands       |
| README documents commands (`Review File`, `Review Selected Code`), a sidebar chat and context menu that **do not exist**; screenshots are `via.placeholder.com` links | `README.md`    |
| One test: `[1,2,3].indexOf(5) === -1`. No CI                                                                                                                          | `test/`        |
| No cancellation, no timeout, no retry, no size limit on what is sent to a third party, no secret redaction                                                            | everywhere     |

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

| Step | Deliverable                                                                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Scaffold: TypeScript strict, esbuild bundle, ESLint, Prettier, Vitest, `.vscodeignore`, `vsce package`                                                                                             |
| B    | `src/core` (no `vscode` import, fully unit-testable): LLM provider interface; OpenAI-compatible and Anthropic providers on plain `fetch`; SSE parser; retry with backoff; timeout and cancellation |
| C    | Review pipeline: prompt builder, secret redaction, size limit, chunking of long files, tolerant JSON findings parser, validation against the document, de-duplication                              |
| D    | VS Code layer: SecretStorage for keys, settings, inline diagnostics, quick-fix/code actions, `@reviewer` chat participant, commands, status bar, first-use consent for remote providers            |
| E    | Optional Continue context provider (the second repo's idea, done correctly)                                                                                                                        |
| F    | Tests (unit with a local mock HTTP server, SSE edge cases, parser fuzz-ish cases, extension-host integration tests if the host can run), coverage gate                                             |
| G    | CI, docs (README, ARCHITECTURE, ADRs, SECURITY, CONTRIBUTING, CHANGELOG), `.vsix`, resume bullets                                                                                                  |

## Delivered

| Step | Result                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A    | TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), esbuild, ESLint (`strictTypeChecked`), Prettier, Vitest; exact-pinned dev dependencies                                                                                              |
| B, C | `src/core`: `fetch`+SSE providers for the OpenAI-compatible and Anthropic wire formats, retry/backoff/timeout/idle/cancel, redaction, chunking, prompt, tolerant parser + validator, edit shifting                                                                 |
| D    | `src/vscode`: SecretStorage keys, consent, diagnostics that follow edits (also edits made while a review is in flight), quick fixes, `@reviewer` chat participant, commands, status bar                                                                            |
| E    | Optional Continue context provider (no dependency on `@continuedev/core`)                                                                                                                                                                                          |
| F    | 137 unit tests (100% lines / 92.6% branches of `src/core`, gate 90%) and 7 integration tests in a real VS Code extension host                                                                                                                                      |
| G    | CI (lint/types/format/tests/`npm audit --omit=dev`/bundle-size guard; extension-host tests on Ubuntu and Windows; `.vsix` artifact), README, ARCHITECTURE, 5 ADRs, SECURITY, CONTRIBUTING, CHANGELOG, Dependabot; `ai-code-reviewer-1.0.0.vsix` is 23 KB (8 files) |

### Found while building

- Integration test: the failure path hung the command. The error toast was awaited, so `executeCommand` stayed pending until the user dismissed it, and the per-file review slot stayed taken. Errors are now reported without waiting for the user.
- Design review of my own first version: findings were published against the _current_ document, so any edit made during the seconds-long request would have misplaced them. Added `beginReview`/`commit`, which records edits during the request and replays them onto the result; an integration test edits the file mid-request and checks the finding lands on the right code.
- Unit tests: duplicate findings differing only by trailing punctuation were not de-duplicated (key normalisation left a trailing space); `shiftFindings` dropped findings on a zero-width empty edit. Both fixed.
- Supply chain: `npm audit` flagged `@azure/msal-node` through `@vscode/vsce`. It is a dev-only packaging dependency (Azure login), so CI gates on `--omit=dev` (zero runtime dependencies) and the advisory is documented in SECURITY.md.

## Verified

- `npm run check`: `tsc --noEmit` (strict), ESLint (type-checked strict rules), Prettier, 137 unit tests with the coverage gate.
- **Clean-room:** a fresh `git clone` of `overhaul/v1`, `npm ci`, `npm run check` (137 tests, 100% lines, 92.6% branches) and `npm run package` all succeed, and `npm audit --omit=dev` reports 0 vulnerabilities. This run caught an unformatted PROGRESS.md that CI would have rejected.
- `npm run package` produces a 23 KB `.vsix`; the 7 integration tests were run **against the unpacked `.vsix`** (not the source tree) in a real VS Code 1.141 extension host, with `--disable-extensions` and throwaway profile directories: activation and commands, end-to-end review to diagnostics (range, severity, message), findings shifting on insert and being withdrawn on edit, quick-fix and dismiss, selection review in whole-file coordinates, an API key never present in the request body, edits during a review, and a 401 leaving no findings.

## Not verified / open items

- **No real provider was called.** OpenAI, Anthropic and Ollama are exercised only against local servers that replay each vendor's documented wire format. No API key was available here, so the real services, model quality and real-world JSON-compliance rates are untested. The first thing to do with a key is review a real file with each provider.
- **`@reviewer` chat participant** is registered and type-checked but was not driven in the UI (the integration suite cannot read chat output).
- **Continue integration** was not run against a live Continue install (it is not installed here); it is written to the `registerCustomContextProvider` shape and wrapped so failure cannot affect reviews.
- **Consent dialog, SecretStorage and the untrusted-workspace restriction** were not exercised in the host (modal and keychain interaction; the integration suite uses a loopback endpoint, which needs no consent).
- **CI never ran** (nothing pushed). In particular the Linux `xvfb-run` job and the Windows job for the extension-host tests are unproven; locally only Windows with an installed VS Code was used.
- No screenshots or GIF (the browser/screen capture is not available here); the README has none, which a Marketplace listing would want.
- Not published to the Marketplace; `publisher` is set to `dipesh9765` but that publisher is not claimed here.
- Redaction is pattern-based and best-effort; findings are model suggestions and quality varies by model.
- The original repositories' history is untouched. `Continue-ai-extension` was not modified.

## Status

- [x] Audit
- [x] A–G
- [ ] Pushed (not pushed; nothing is pushed without an explicit instruction)
