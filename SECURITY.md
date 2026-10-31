# Security

## What the extension does with your data

- Sends the text of the file or selection you chose to review, plus the file name and language, to the endpoint you configured. Nothing else: no workspace contents, no telemetry, no analytics, no other network destinations. There is no server operated by the author.
- Stores one API key per provider in VS Code SecretStorage (the operating system keychain). Keys are never written to settings, global state, the workspace or logs.
- Before sending, replaces common credential shapes with `[REDACTED:kind]` placeholders (on by default). This is pattern-based and best-effort. It cannot recognise a secret that has no recognisable shape. For sensitive code use a local model (Ollama): requests to localhost never leave the machine.
- Asks for consent before the first request to each remote host.

## Hardening

| Threat                                                     | Mitigation                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key sent in clear text                                     | Endpoints must be `https://`; plain `http://` only for localhost / 127.0.0.1 / ::1; URLs with embedded credentials are rejected                                                                                                                                                        |
| Malicious repository redirects your code to its own server | `aiCodeReviewer.provider` and `aiCodeReviewer.baseUrl` are restricted configurations: ignored from workspace settings in untrusted workspaces                                                                                                                                          |
| Prompt injection from the reviewed code                    | Code is delimited as data in the prompt, and the model's output can only become diagnostic text: there is no tool use, file write or command execution path. Output is schema-validated and length-capped, control characters are stripped, and diagnostics are rendered as plain text |
| Model output pointing at the wrong place                   | Entries with lines outside the reviewed range are dropped, not repaired                                                                                                                                                                                                                |
| Key echoed in provider error messages                      | Error excerpts are truncated to 300 characters and passed through the redactor                                                                                                                                                                                                         |
| Runaway response                                           | Aborted at 200,000 characters; request timeout and idle-stream timeout enforced                                                                                                                                                                                                        |
| Supply chain                                               | Zero runtime dependencies; the shipped file is one esbuild bundle. Dependabot is enabled for the build tooling, `npm audit --omit=dev` runs in CI                                                                                                                                      |

## Known limitations

- `npm audit` reports 2 high-severity advisories in `@azure/msal-node`, pulled in transitively by `@vscode/vsce` (the packaging and publishing tool). It affects the Azure sign-in flow of `vsce login`, which this project does not use, and it is a development dependency that is not part of the shipped extension. CI gates on `npm audit --omit=dev` (production dependencies: none). It will be resolved by upgrading `vsce` when a release bundles a fixed version.
- Redaction is best-effort (see above).
- The consent decision is remembered per provider and host in VS Code global state; clear it by resetting the extension's state or switching host.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"), or email the maintainer listed on the GitHub profile. You will get an acknowledgement within a few days.
