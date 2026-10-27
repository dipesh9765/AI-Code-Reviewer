# 0001. Merge into one TypeScript extension

Status: accepted

## Context

Two repositories existed. `AI-Code-Reviewer` was a JavaScript VS Code chat participant that called OpenAI's Assistants API with a hard-coded assistant ID and a key held only in memory. `Continue-ai-extension` was a TypeScript scaffold meant to feed a review into the Continue extension; its only live code returned the literal string "Custom content". Both aimed at the same product (AI code review inside the editor) and each depended on a different host (Copilot Chat, Continue) as a hard requirement.

## Decision

One repository, one extension, in TypeScript. The code-review capability is the product; Continue becomes an optional integration that is loaded only when present. Neither Copilot Chat nor Continue is a required dependency.

## Consequences

- Users install one thing and it works without another extension.
- The Continue idea survives as `src/vscode/continue.ts` (about 90 lines) behind a locally declared interface, so there is no `@continuedev/core` dependency.
- The `Continue-ai-extension` repository has nothing left that this one lacks; it can be archived with a pointer here (a decision for the owner).
- The Assistants-API path was dropped, not ported: that API is deprecated and needs a pre-created assistant, which is poor onboarding.
