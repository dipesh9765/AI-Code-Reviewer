import * as vscode from "vscode";
import { diagnosticMessage, rangeForFinding } from "../core/present";
import { shiftFindings } from "../core/shift";
import type { Finding, Severity } from "../core/types";

const SOURCE = "AI Code Reviewer";

const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/**
 * Holds the current findings per document and mirrors them into VS Code's Problems panel.
 * Findings follow the text as the user edits (see `shiftFindings`) and disappear when the
 * document closes.
 */
export class FindingStore implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("aiCodeReviewer");
  private readonly byUri = new Map<string, Finding[]>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor() {
    this.subscriptions.push(
      this.diagnostics,
      this.changed,
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.onEdit(event);
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.clear(doc.uri);
      }),
    );
  }

  get(uri: vscode.Uri): readonly Finding[] {
    return this.byUri.get(uri.toString()) ?? [];
  }

  count(): number {
    let n = 0;
    for (const list of this.byUri.values()) n += list.length;
    return n;
  }

  /** Replaces the findings in a line range (a selection review) or the whole file. */
  replace(
    doc: vscode.TextDocument,
    findings: Finding[],
    scope?: { from: number; to: number },
  ): void {
    const key = doc.uri.toString();
    const kept = scope
      ? (this.byUri.get(key) ?? []).filter((f) => f.endLine < scope.from || f.line > scope.to)
      : [];
    this.byUri.set(
      key,
      [...kept, ...findings].sort((a, b) => a.line - b.line),
    );
    this.publish(doc);
  }

  dismiss(uri: vscode.Uri, line: number, message: string): void {
    const key = uri.toString();
    const next = (this.byUri.get(key) ?? []).filter(
      (f) => !(f.line === line && f.message === message),
    );
    this.byUri.set(key, next);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    if (doc) this.publish(doc);
  }

  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.byUri.delete(uri.toString());
      this.diagnostics.delete(uri);
    } else {
      this.byUri.clear();
      this.diagnostics.clear();
    }
    this.changed.fire();
  }

  /** Finds the stored finding behind a diagnostic we produced. */
  findingFor(uri: vscode.Uri, diagnostic: vscode.Diagnostic): Finding | undefined {
    return this.get(uri).find(
      (f) =>
        f.line === diagnostic.range.start.line + 1 && diagnosticMessage(f) === diagnostic.message,
    );
  }

  private publish(doc: vscode.TextDocument): void {
    const findings = this.byUri.get(doc.uri.toString()) ?? [];
    this.diagnostics.set(
      doc.uri,
      findings.map((f) => {
        const r = rangeForFinding(f, doc.lineCount, (n) => doc.lineAt(n).text);
        const d = new vscode.Diagnostic(
          new vscode.Range(r.startLine, r.startChar, r.endLine, r.endChar),
          diagnosticMessage(f),
          SEVERITY[f.severity],
        );
        d.source = SOURCE;
        d.code = f.category;
        return d;
      }),
    );
    this.changed.fire();
  }

  private onEdit(event: vscode.TextDocumentChangeEvent): void {
    const key = event.document.uri.toString();
    let findings = this.byUri.get(key);
    if (!findings || findings.length === 0 || event.contentChanges.length === 0) return;
    // Changes are expressed in pre-edit coordinates; applying the lowest first means each shift
    // only affects text below it and the remaining (higher) changes stay valid.
    const ordered = [...event.contentChanges].sort((a, b) =>
      b.range.start.compareTo(a.range.start),
    );
    for (const change of ordered) {
      findings = shiftFindings(findings, {
        startLine: change.range.start.line,
        startChar: change.range.start.character,
        endLine: change.range.end.line,
        endChar: change.range.end.character,
        text: change.text,
      });
    }
    this.byUri.set(key, findings);
    this.publish(event.document);
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
  }
}

export const DISMISS_COMMAND = "aiCodeReviewer.dismissFinding";
export const COPY_SUGGESTION_COMMAND = "aiCodeReviewer.copySuggestion";

export class FindingActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];
  private readonly store: FindingStore;

  constructor(store: FindingStore) {
    this.store = store;
  }

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== SOURCE) continue;
      const finding = this.store.findingFor(document.uri, diagnostic);
      if (!finding) continue;
      if (finding.suggestion) {
        const copy = new vscode.CodeAction("Copy suggested fix", vscode.CodeActionKind.QuickFix);
        copy.command = {
          command: COPY_SUGGESTION_COMMAND,
          title: "Copy suggested fix",
          arguments: [finding.suggestion],
        };
        copy.diagnostics = [diagnostic];
        actions.push(copy);
      }
      const dismiss = new vscode.CodeAction("Dismiss this finding", vscode.CodeActionKind.QuickFix);
      dismiss.command = {
        command: DISMISS_COMMAND,
        title: "Dismiss this finding",
        arguments: [document.uri, finding.line, finding.message],
      };
      dismiss.diagnostics = [diagnostic];
      actions.push(dismiss);
    }
    return actions;
  }
}
