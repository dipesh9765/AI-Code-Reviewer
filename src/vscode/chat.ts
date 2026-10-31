import * as vscode from "vscode";
import { chunkLines } from "../core/chunk";
import { isAbort } from "../core/errors";
import { findingsToMarkdown } from "../core/present";
import { ASK_SYSTEM_PROMPT, buildAskMessage } from "../core/prompt";
import { redactSecrets } from "../core/redact";
import { reviewText } from "../core/review";
import type { FindingStore } from "./findings";
import type { ReviewService } from "./service";

export const CHAT_PARTICIPANT_ID = "aiCodeReviewer.reviewer";

/**
 * `@reviewer` in the chat view. With no question (or `/review`) it runs the same structured
 * review as the command and lists the findings; with a question it streams a free-form answer
 * about the open file or selection.
 */
export function registerChat(
  context: vscode.ExtensionContext,
  service: ReviewService,
  store: FindingStore,
): void {
  const handler: vscode.ChatRequestHandler = async (request, _chat, stream, token) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      stream.markdown("Open a file in the editor first, then ask again.");
      return;
    }
    const ready = await service.prepare();
    if (!ready) {
      stream.markdown("I could not start: check the notification for what to fix.");
      return;
    }

    const controller = new AbortController();
    token.onCancellationRequested(() => {
      controller.abort();
    });
    const doc = editor.document;
    const useSelection = !editor.selection.isEmpty;
    const range = useSelection ? editor.selection : undefined;
    const firstLine = range ? range.start.line + 1 : 1;
    const fileName = vscode.workspace.asRelativePath(doc.uri);

    try {
      if (request.command === "review" || request.prompt.trim() === "") {
        stream.progress("Reviewing…");
        const text = doc.getText(range);
        const pending = store.beginReview(doc);
        try {
          const result = await reviewText({
            provider: ready.resolved.provider,
            model: ready.resolved.model,
            fileName,
            languageId: doc.languageId,
            text,
            firstLine,
            maxInputChars: ready.config.maxInputChars,
            redact: ready.config.redactSecrets,
            minSeverity: ready.config.minSeverity,
            signal: controller.signal,
          });
          const shown = store.commit(
            doc,
            pending,
            result.findings,
            range ? { from: firstLine, to: firstLine + text.split("\n").length - 1 } : undefined,
          );
          stream.markdown(findingsToMarkdown(fileName, result.findings, result));
          if (!shown) {
            stream.markdown(
              "\n\n_The selected code changed while the review ran, so the markers were not placed in the editor._",
            );
          }
        } finally {
          store.endReview(pending);
        }
        return;
      }

      // Free-form question: send only the first chunk that fits the size budget.
      const raw = doc.getText(range);
      const text = ready.config.redactSecrets ? redactSecrets(raw).text : raw;
      const { chunks, skippedLines } = chunkLines(
        text.split("\n"),
        firstLine,
        ready.config.maxInputChars,
        1,
      );
      const chunk = chunks[0];
      if (!chunk) {
        stream.markdown("The file is empty.");
        return;
      }
      if (skippedLines > 0) {
        stream.markdown(
          `_Only the first ${String(chunk.lines.length)} lines fit the size limit; ${String(skippedLines)} were not sent._\n\n`,
        );
      }
      for await (const delta of ready.resolved.provider.stream({
        model: ready.resolved.model,
        system: ASK_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildAskMessage(request.prompt, {
              fileName,
              languageId: doc.languageId,
              lines: chunk.lines,
              firstLine: chunk.firstLine,
            }),
          },
        ],
        maxTokens: 2048,
        signal: controller.signal,
      })) {
        stream.markdown(delta);
      }
    } catch (error) {
      if (isAbort(error)) return;
      stream.markdown(`**Error:** ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const participant = vscode.chat.createChatParticipant(CHAT_PARTICIPANT_ID, handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "icon.png");
  context.subscriptions.push(participant);
}
