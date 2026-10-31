import * as vscode from "vscode";
import { LlmError, isAbort } from "../core/errors";
import { summarise } from "../core/present";
import { PROVIDER_DEFAULTS, resolveProvider, type ResolvedProvider } from "../core/providers";
import { reviewText, type ReviewResult } from "../core/review";
import { readConfig, type ExtensionConfig } from "./config";
import type { FindingStore, PendingReview } from "./findings";
import type { KeyStore } from "./secrets";

export interface ReadyProvider {
  resolved: ResolvedProvider;
  config: ExtensionConfig;
}

/**
 * Glue between the editor and the pure review engine: resolves settings and the stored key into
 * a provider, asks for consent before code leaves the machine, runs the review with progress and
 * cancellation, and turns failures into messages a person can act on.
 */
export class ReviewService {
  private readonly context: vscode.ExtensionContext;
  private readonly keys: KeyStore;
  private readonly store: FindingStore;
  private readonly running = new Map<string, AbortController>();
  private readonly status: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext, keys: KeyStore, store: FindingStore) {
    this.context = context;
    this.keys = keys;
    this.store = store;
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.status.command = "aiCodeReviewer.reviewFile";
    this.context.subscriptions.push(
      this.status,
      store.onDidChange(() => {
        this.refreshStatus();
      }),
    );
    this.refreshStatus();
    this.status.show();
  }

  private refreshStatus(text?: string): void {
    const n = this.store.count();
    this.status.text =
      text ?? (n > 0 ? `$(sparkle) AI Review: ${String(n)}` : "$(sparkle) AI Review");
    this.status.tooltip = "Review the current file with AI Code Reviewer";
  }

  /** Builds a provider from current settings, or explains what is missing. */
  async prepare(): Promise<ReadyProvider | undefined> {
    const config = readConfig();
    try {
      const resolved = resolveProvider({
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        apiKey: await this.keys.get(config.provider),
        http: { timeoutMs: config.timeoutMs },
      });
      if (!(await this.confirmRemote(config, resolved))) return undefined;
      return { resolved, config };
    } catch (error) {
      this.report(error);
      return undefined;
    }
  }

  private async confirmRemote(
    config: ExtensionConfig,
    resolved: ResolvedProvider,
  ): Promise<boolean> {
    if (!resolved.remote) return true;
    const host = new URL(resolved.baseUrl).host;
    const key = `aiCodeReviewer.consent.${config.provider}.${host}`;
    if (this.context.globalState.get<boolean>(key)) return true;
    const allow = "Allow";
    const choice = await vscode.window.showWarningMessage(
      `Send code to ${host}?`,
      {
        modal: true,
        detail:
          `AI Code Reviewer will send the text of the files you review to ${host} using the ${PROVIDER_DEFAULTS[config.provider].label} provider. ` +
          (config.redactSecrets
            ? "Detected API keys and tokens are replaced with placeholders first. "
            : "Secret redaction is switched OFF. ") +
          "Choose Ollama or a local server if code must not leave this machine.",
      },
      allow,
    );
    if (choice !== allow) return false;
    await this.context.globalState.update(key, true);
    return true;
  }

  /** Reviews the editor's selection (when `selectionOnly` and non-empty) or its whole file. */
  async reviewEditor(editor: vscode.TextEditor, selectionOnly: boolean): Promise<void> {
    const ready = await this.prepare();
    if (!ready) return;

    const doc = editor.document;
    const useSelection = selectionOnly && !editor.selection.isEmpty;
    const range = useSelection
      ? new vscode.Range(
          editor.selection.start.line,
          0,
          editor.selection.end.character === 0 &&
            editor.selection.end.line > editor.selection.start.line
            ? editor.selection.end.line - 1
            : editor.selection.end.line,
          Number.MAX_SAFE_INTEGER,
        )
      : undefined;
    const text = doc.getText(range ? doc.validateRange(range) : undefined);
    if (!text.trim()) {
      void vscode.window.showInformationMessage("Nothing to review: the file is empty.");
      return;
    }
    const firstLine = range ? range.start.line + 1 : 1;
    const key = doc.uri.toString();
    this.running.get(key)?.abort(); // a newer review of the same file supersedes the old one
    const controller = new AbortController();
    this.running.set(key, controller);
    // Same tick as the snapshot above: every later edit is replayed onto the result.
    const pending = this.store.beginReview(doc);

    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `AI Code Reviewer: ${useSelection ? "reviewing selection" : "reviewing file"}`,
          cancellable: true,
        },
        (progress, token) => {
          token.onCancellationRequested(() => {
            controller.abort();
          });
          return reviewText({
            provider: ready.resolved.provider,
            model: ready.resolved.model,
            fileName: vscode.workspace.asRelativePath(doc.uri),
            languageId: doc.languageId,
            text,
            firstLine,
            maxInputChars: ready.config.maxInputChars,
            redact: ready.config.redactSecrets,
            minSeverity: ready.config.minSeverity,
            signal: controller.signal,
            onProgress: (done, total) => {
              if (total > 1) progress.report({ message: `${String(done)}/${String(total)}` });
            },
          });
        },
      );
      if (controller.signal.aborted) return; // superseded while the last chunk was finishing
      this.show(
        doc,
        pending,
        result,
        useSelection ? { from: firstLine, to: firstLine + text.split("\n").length - 1 } : undefined,
      );
    } catch (error) {
      this.report(error);
    } finally {
      this.store.endReview(pending);
      if (this.running.get(key) === controller) this.running.delete(key);
    }
  }

  private show(
    doc: vscode.TextDocument,
    pending: PendingReview,
    result: ReviewResult,
    scope?: { from: number; to: number },
  ): void {
    if (!this.store.commit(doc, pending, result.findings, scope)) {
      void vscode.window.showInformationMessage(
        "AI Code Reviewer: the selected code changed while the review ran, so the result was discarded. Run it again.",
      );
      return;
    }
    const notes: string[] = [];
    if (result.redactions > 0)
      notes.push(`${String(result.redactions)} secret(s) redacted before sending`);
    if (result.skippedLines > 0)
      notes.push(`${String(result.skippedLines)} lines skipped (over the size limit)`);
    if (result.chunkErrors.length > 0) notes.push("part of the file could not be reviewed");
    const suffix = notes.length > 0 ? ` (${notes.join("; ")})` : "";
    void vscode.window.showInformationMessage(
      `AI Code Reviewer: ${summarise(result.findings)}${suffix}.`,
    );
  }

  /**
   * Shows the failure without waiting for the user to react to it. Awaiting the toast would keep
   * the command (and the per-file review slot) pending until it is dismissed.
   */
  report(error: unknown): void {
    void this.notifyError(error);
  }

  private async notifyError(error: unknown): Promise<void> {
    if (isAbort(error)) return;
    if (error instanceof LlmError) {
      const actions: string[] = [];
      if (error.kind === "auth" || /API key/.test(error.message)) actions.push("Set API Key");
      if (error.kind === "config") actions.push("Open Settings");
      const choice = await vscode.window.showErrorMessage(
        `AI Code Reviewer: ${error.message}`,
        ...actions,
      );
      if (choice === "Set API Key")
        await vscode.commands.executeCommand("aiCodeReviewer.setApiKey");
      if (choice === "Open Settings") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "aiCodeReviewer");
      }
      return;
    }
    // Anything else is a bug in the extension. Say so instead of failing silently.
    void vscode.window.showErrorMessage(
      `AI Code Reviewer hit an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
