# 0003. A pure core behind a thin VS Code adapter

Status: accepted

## Context

Extension code that imports `vscode` can only be tested inside an extension host, which is slow, needs a display, and tempts authors to leave the hard logic untested. The risky parts of this product (protocol parsing, retries, redaction, line arithmetic, validating model output) are exactly the parts that benefit from fast, exhaustive tests.

## Decision

Everything under `src/core` is plain TypeScript and must not import `vscode`; an ESLint `no-restricted-imports` rule enforces it. `src/vscode` adapts the core to the editor and contains as little logic as possible. Where the adapter needs logic (mapping a finding to a range, adjusting findings after an edit, formatting messages) that logic lives in the core as a pure function (`present.ts`, `shift.ts`).

## Consequences

- 137 unit tests run in about a second with 100% line coverage of the core.
- A small integration suite (7 tests) runs in a real extension host and proves the wiring, not the logic.
- Slight indirection: the adapter converts VS Code types to plain objects and back.
