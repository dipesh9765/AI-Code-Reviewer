import * as vscode from "vscode";
import { findingsToMarkdown } from "../core/present";
import type { FindingStore } from "./findings";

/**
 * The slice of Continue's context-provider interface this extension implements. It is declared
 * here instead of importing `@continuedev/core` so that Continue stays an optional integration
 * with zero runtime dependency.
 */
interface ContinueContextProvider {
  readonly description: {
    title: string;
    displayTitle: string;
    description: string;
    type: "normal";
  };
  getContextItems(): Promise<{ name: string; description: string; content: string }[]>;
  loadSubmenuItems(): Promise<never[]>;
}

interface ContinueApi {
  registerCustomContextProvider?: (provider: ContinueContextProvider) => void;
}

const CONTINUE_ID = "Continue.continue";

/**
 * Exposes the current file's review findings to the Continue extension as an `@AI Review`
 * context item, so findings can be discussed or fixed from Continue's chat. Does nothing when
 * Continue is not installed, and never activates it.
 */
export function registerContinueIntegration(
  context: vscode.ExtensionContext,
  store: FindingStore,
): void {
  const provider: ContinueContextProvider = {
    description: {
      title: "ai-code-review",
      displayTitle: "AI Review",
      description: "Findings from AI Code Reviewer for the active file",
      type: "normal",
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async getContextItems() {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return [];
      const findings = store.get(editor.document.uri);
      if (findings.length === 0) return [];
      const fileName = vscode.workspace.asRelativePath(editor.document.uri);
      return [
        {
          name: `AI review of ${fileName}`,
          description: `${String(findings.length)} findings`,
          content: findingsToMarkdown(fileName, findings, {
            skippedLines: 0,
            truncatedLines: 0,
            redactions: 0,
            droppedFindings: 0,
            chunkErrors: [],
          }),
        },
      ];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async loadSubmenuItems() {
      return [];
    },
  };

  let registered = false;
  const tryRegister = (): void => {
    if (registered) return;
    const extension = vscode.extensions.getExtension<ContinueApi>(CONTINUE_ID);
    const api = extension?.isActive ? extension.exports : undefined;
    if (typeof api?.registerCustomContextProvider !== "function") return;
    try {
      api.registerCustomContextProvider(provider);
      registered = true;
    } catch {
      // Continue's API is not stable across versions; a failure here must never break reviews.
    }
  };

  tryRegister();
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      tryRegister();
    }),
  );
}
