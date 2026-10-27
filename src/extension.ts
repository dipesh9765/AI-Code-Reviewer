import * as vscode from "vscode";
import { PROVIDER_DEFAULTS, PROVIDER_IDS, type ProviderId } from "./core/providers";
import { readConfig, updateSetting } from "./vscode/config";
import { registerChat } from "./vscode/chat";
import { registerContinueIntegration } from "./vscode/continue";
import {
  COPY_SUGGESTION_COMMAND,
  DISMISS_COMMAND,
  FindingActions,
  FindingStore,
} from "./vscode/findings";
import { KeyStore, validateKeyInput } from "./vscode/secrets";
import { ReviewService } from "./vscode/service";

async function pickProvider(placeHolder: string): Promise<ProviderId | undefined> {
  const current = readConfig().provider;
  const items: (vscode.QuickPickItem & { id: ProviderId })[] = PROVIDER_IDS.map((id) => ({
    label: PROVIDER_DEFAULTS[id].label,
    ...(id === current ? { description: "current" } : {}),
    id,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder });
  return picked?.id;
}

export function activate(context: vscode.ExtensionContext): void {
  const keys = new KeyStore(context.secrets);
  const store = new FindingStore();
  const service = new ReviewService(context, keys, store);

  const withEditor = async (selectionOnly: boolean): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage("Open a file to review first.");
      return;
    }
    await service.reviewEditor(editor, selectionOnly);
  };

  context.subscriptions.push(
    store,
    vscode.commands.registerCommand("aiCodeReviewer.reviewFile", () => withEditor(false)),
    vscode.commands.registerCommand("aiCodeReviewer.reviewSelection", () => withEditor(true)),
    vscode.commands.registerCommand("aiCodeReviewer.clearFindings", () => {
      store.clear();
    }),
    vscode.commands.registerCommand("aiCodeReviewer.selectProvider", async () => {
      const provider = await pickProvider("Which provider should review your code?");
      if (!provider) return;
      const model = await vscode.window.showInputBox({
        prompt: `Model for ${PROVIDER_DEFAULTS[provider].label}`,
        placeHolder: PROVIDER_DEFAULTS[provider].model || "model name",
        value: provider === readConfig().provider ? readConfig().model : "",
      });
      if (model === undefined) return;
      await updateSetting("provider", provider);
      await updateSetting("model", model.trim());
      if (PROVIDER_DEFAULTS[provider].needsKey && !(await keys.get(provider))) {
        await vscode.commands.executeCommand("aiCodeReviewer.setApiKey");
      }
    }),
    vscode.commands.registerCommand("aiCodeReviewer.setApiKey", async () => {
      const provider = readConfig().provider;
      if (!PROVIDER_DEFAULTS[provider].needsKey && provider !== "custom") {
        void vscode.window.showInformationMessage(
          `${PROVIDER_DEFAULTS[provider].label} needs no API key.`,
        );
        return;
      }
      const value = await vscode.window.showInputBox({
        prompt: `API key for ${PROVIDER_DEFAULTS[provider].label}`,
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => validateKeyInput(v),
      });
      if (value === undefined) return;
      await keys.set(provider, value);
      void vscode.window.showInformationMessage(
        `API key saved to your system keychain for ${PROVIDER_DEFAULTS[provider].label}.`,
      );
    }),
    vscode.commands.registerCommand("aiCodeReviewer.deleteApiKey", async () => {
      const provider = await pickProvider("Delete the stored key for which provider?");
      if (!provider) return;
      await keys.delete(provider);
      void vscode.window.showInformationMessage(
        `Deleted the stored key for ${PROVIDER_DEFAULTS[provider].label}.`,
      );
    }),
    vscode.commands.registerCommand(
      DISMISS_COMMAND,
      (uri: vscode.Uri, line: number, message: string) => {
        store.dismiss(uri, line, message);
      },
    ),
    vscode.commands.registerCommand(COPY_SUGGESTION_COMMAND, async (suggestion: string) => {
      await vscode.env.clipboard.writeText(suggestion);
      void vscode.window.showInformationMessage("Suggested fix copied to the clipboard.");
    }),
    vscode.languages.registerCodeActionsProvider({ scheme: "*" }, new FindingActions(store), {
      providedCodeActionKinds: FindingActions.kinds,
    }),
  );

  registerChat(context, service, store);
  registerContinueIntegration(context, store);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}
