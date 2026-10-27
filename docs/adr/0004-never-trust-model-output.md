# 0004. Treat model output as untrusted input

Status: accepted

## Context

The extension turns free text from a language model into editor diagnostics. Models miscount lines, return prose instead of JSON, invent severities, and can be steered by text inside the code under review (prompt injection).

## Decision

- The prompt shows lines with absolute gutter numbers and states that the code is data, not instructions.
- Output is parsed with a tolerant extractor (bare JSON, fenced, or embedded in prose) and then validated entry by entry against the lines that were actually sent: integer line inside the chunk, non-empty message, known category and severity (with aliases), length caps, control characters stripped, duplicates removed.
- An entry that fails validation is dropped and counted. It is never "repaired" onto a nearby line, and the user is told how many were ignored.
- The model cannot trigger actions: its output only ever becomes text in a diagnostic. There is no tool use, file write or command execution path.
- Responses over 200,000 characters are aborted.

## Consequences

- A wrong or hostile answer degrades to missing or noisy findings, never to a diagnostic on the wrong line or an action on the user's machine.
- Some correct findings are discarded when the model's line numbers are slightly off. That is the intended trade: precision over recall.
