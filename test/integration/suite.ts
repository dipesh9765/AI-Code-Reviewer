import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as vscode from "vscode";

/**
 * Integration tests that run inside a real extension host. They drive the extension exactly the
 * way a user does (commands, documents, diagnostics) against a local mock model server.
 */

interface Captured {
  url: string;
  body: string;
}

const captured: Captured[] = [];
let answer = '{"findings":[]}';
let status = 200;
let delayMs = 0;

function startMock(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        captured.push({ url: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
        if (status !== 200) {
          res.writeHead(status).end("denied");
          return;
        }
        const reply = (): void => {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`);
          res.end("data: [DONE]\n\n");
        };
        if (delayMs > 0) setTimeout(reply, delayMs);
        else reply();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

async function waitFor<T>(
  what: string,
  probe: () => T | undefined,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const ours = (uri: vscode.Uri): vscode.Diagnostic[] =>
  vscode.languages.getDiagnostics(uri).filter((d) => d.source === "AI Code Reviewer");

async function open(content: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ content, language: "typescript" });
  return vscode.window.showTextDocument(doc);
}

type TestFn = () => Promise<void>;
const tests: [string, TestFn][] = [];
const test = (name: string, fn: TestFn): void => {
  tests.push([name, fn]);
};

test("registers its commands on activation", async () => {
  const ext = vscode.extensions.getExtension("dipesh9765.ai-code-reviewer");
  assert.ok(ext, "extension not found in the host");
  await ext.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const c of [
    "aiCodeReviewer.reviewFile",
    "aiCodeReviewer.reviewSelection",
    "aiCodeReviewer.clearFindings",
    "aiCodeReviewer.selectProvider",
    "aiCodeReviewer.setApiKey",
    "aiCodeReviewer.deleteApiKey",
  ]) {
    assert.ok(commands.includes(c), `missing command ${c}`);
  }
});

test("review shows diagnostics, follows edits, offers quick fixes and can be dismissed", async () => {
  answer = JSON.stringify({
    findings: [
      {
        line: 3,
        endLine: 3,
        severity: "error",
        category: "bug",
        message: "Off-by-one in loop bound",
        suggestion: "Use < instead of <=",
      },
      { line: 1, severity: "info", category: "style", message: "Prefer const" },
    ],
  });
  const editor = await open(
    [
      "let a = 1;",
      "function f(xs: number[]) {",
      "  for (let i = 0; i <= xs.length; i++) {}",
      "}",
    ].join("\n"),
  );
  const uri = editor.document.uri;

  await vscode.commands.executeCommand("aiCodeReviewer.reviewFile");
  const diagnostics = await waitFor("diagnostics", () => {
    const d = ours(uri);
    return d.length === 2 ? d : undefined;
  });

  const error = diagnostics.find((d) => d.severity === vscode.DiagnosticSeverity.Error);
  assert.ok(error);
  assert.equal(error.range.start.line, 2);
  assert.equal(error.range.start.character, 2, "underline starts after the indentation");
  assert.match(error.message, /Off-by-one/);
  assert.match(error.message, /Suggestion: Use </);

  // The request carried numbered code and the system prompt, and went to /chat/completions.
  const request = captured.at(-1);
  assert.ok(request, "no request reached the model");
  assert.ok(request.url.endsWith("/chat/completions"));
  assert.match(request.body, /3 \| {3}for \(let i = 0/);

  // Insert a line above: the finding must move down with its code.
  await editor.edit((b) => {
    b.insert(new vscode.Position(0, 0), "// header\n");
  });
  const moved = await waitFor("shifted diagnostic", () => {
    const e = ours(uri).find((d) => d.severity === vscode.DiagnosticSeverity.Error);
    return e?.range.start.line === 3 ? e : undefined;
  });
  assert.equal(moved.range.start.line, 3);

  // Editing the flagged line itself withdraws the finding.
  await editor.edit((b) => {
    b.replace(new vscode.Range(3, 20, 3, 22), "<");
  });
  await waitFor("finding withdrawn after edit", () =>
    ours(uri).some((d) => d.severity === vscode.DiagnosticSeverity.Error) ? undefined : true,
  );

  // Quick fixes on the remaining (info) finding.
  const remaining = ours(uri)[0];
  assert.ok(remaining);
  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    "vscode.executeCodeActionProvider",
    uri,
    remaining.range,
    vscode.CodeActionKind.QuickFix.value,
  );
  const dismiss = actions.find((a) => a.title === "Dismiss this finding");
  assert.ok(dismiss, "dismiss action offered");
  assert.ok(dismiss.command);
  const args: unknown[] = dismiss.command.arguments ?? [];
  await vscode.commands.executeCommand(dismiss.command.command, ...args);
  await waitFor("dismissed", () => (ours(uri).length === 0 ? true : undefined));
});

test("secrets never leave the machine in the request body", async () => {
  answer = '{"findings":[]}';
  const secret = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX1234";
  await open(`const key = "${secret}";\nconsole.log(key);`);
  const before = captured.length;
  await vscode.commands.executeCommand("aiCodeReviewer.reviewFile");
  await waitFor("request", () => (captured.length > before ? true : undefined));
  const body = captured[captured.length - 1]?.body ?? "";
  assert.ok(!body.includes(secret), "the API key was sent to the model");
  assert.match(body, /REDACTED:openai-key/);
});

test("selection review reports lines in whole-file coordinates", async () => {
  answer = JSON.stringify({
    findings: [{ line: 5, severity: "warning", category: "bug", message: "Selected-range issue" }],
  });
  const editor = await open(
    Array.from({ length: 8 }, (_, i) => `const v${String(i + 1)} = ${String(i + 1)};`).join("\n"),
  );
  editor.selection = new vscode.Selection(3, 0, 5, 12); // lines 4-6 (1-based)
  await vscode.commands.executeCommand("aiCodeReviewer.reviewSelection");
  const d = await waitFor("selection diagnostic", () => ours(editor.document.uri)[0]);
  assert.equal(d.range.start.line, 4);
  const request = captured.at(-1);
  assert.match(request?.body ?? "", /lines 4-6/);
  assert.ok(!(request?.body ?? "").includes("const v1 ="), "text outside the selection was sent");
});

test("edits made while a review runs are replayed onto its result", async () => {
  answer = JSON.stringify({
    findings: [{ line: 2, severity: "error", category: "bug", message: "Slow review finding" }],
  });
  delayMs = 700;
  try {
    const editor = await open("const a = 1;\nconst b = oops;\nconst c = 3;");
    const before = captured.length;
    const run = vscode.commands.executeCommand("aiCodeReviewer.reviewFile");
    await waitFor("request in flight", () => (captured.length > before ? true : undefined));
    await editor.edit((b) => {
      b.insert(new vscode.Position(0, 0), "// added while waiting\n");
    });
    await run;
    const d = await waitFor("diagnostic", () => ours(editor.document.uri)[0]);
    // The model cited line 2 of the text it saw; that code is now on line 3 (0-based 2).
    assert.equal(d.range.start.line, 2);
    assert.equal(editor.document.lineAt(d.range.start.line).text, "const b = oops;");
  } finally {
    delayMs = 0;
  }
});

test("clearFindings removes all diagnostics", async () => {
  await vscode.commands.executeCommand("aiCodeReviewer.clearFindings");
  const all = vscode.languages.getDiagnostics().flatMap(([, ds]) => ds);
  assert.equal(all.filter((d) => d.source === "AI Code Reviewer").length, 0);
});

test("a provider failure leaves the document without findings", async () => {
  status = 401;
  const editor = await open("const x = 1;");
  const before = captured.length;
  await vscode.commands.executeCommand("aiCodeReviewer.reviewFile");
  await waitFor("failed request", () => (captured.length > before ? true : undefined));
  assert.equal(ours(editor.document.uri).length, 0);
  status = 200;
});

export async function run(): Promise<void> {
  const server = await startMock();
  const { port } = server.address() as AddressInfo;
  const config = vscode.workspace.getConfiguration("aiCodeReviewer");
  await config.update("provider", "custom", vscode.ConfigurationTarget.Global);
  await config.update(
    "baseUrl",
    `http://127.0.0.1:${String(port)}/v1`,
    vscode.ConfigurationTarget.Global,
  );
  await config.update("model", "test-model", vscode.ConfigurationTarget.Global);

  let failed = 0;
  try {
    for (const [name, fn] of tests) {
      try {
        await fn();
        console.log(`  ok   ${name}`);
      } catch (error) {
        failed++;
        console.log(
          `  FAIL ${name}\n       ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      }
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
  if (failed > 0) throw new Error(`${String(failed)} integration test(s) failed`);
}
