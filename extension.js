const vscode = require("vscode");
const { OpenAI } = require("openai");

let openAiClient;
let assistantId = "asst_yZxRGLalWzVvVfnVisulCvUc"; // Default Assistant ID
let lastReviewResponse = "Awaiting AI review...";
let treeDataProvider = null;
let chatProvider = null;

class CodeReviewTreeDataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    getTreeItem(element) {
        return element;
    }

    getChildren() {
        return [
            new vscode.TreeItem("AI Code Reviewer", vscode.TreeItemCollapsibleState.None),
            this.createAssistantIdInputBox(),
            this.createRefreshButton(),
            this.createReviewOutput()
        ];
    }

    createAssistantIdInputBox() {
        const assistantItem = new vscode.TreeItem(`Assistant ID: ${assistantId}`, vscode.TreeItemCollapsibleState.None);
        assistantItem.command = {
            command: "ai-code-reviewer.editAssistantId",
            title: "Edit Assistant ID"
        };
        return assistantItem;
    }

    createRefreshButton() {
        const refreshItem = new vscode.TreeItem("🔄 Refresh Assistant ID", vscode.TreeItemCollapsibleState.None);
        refreshItem.command = {
            command: "ai-code-reviewer.testAssistantId",
            title: "Refresh Assistant ID"
        };
        return refreshItem;
    }

    createReviewOutput() {
        const reviewOutputItem = new vscode.TreeItem(`Review Output:\n${lastReviewResponse}`, vscode.TreeItemCollapsibleState.None);
        return reviewOutputItem;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

class ChatMessageItem extends vscode.TreeItem {
    constructor(label) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = label; // Show full message on hover
    }
}

class ChatDataProvider {
    constructor() {
        this.messages = [];
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    getTreeItem(element) {
        return element;
    }

    getChildren() {
        return this.messages;
    }

    appendMessage(message, isUser) {
        const prefix = isUser ? "👤 User: " : "🤖 AI: ";
        this.messages.push(new ChatMessageItem(`${prefix}${message}`));

        // Refresh the UI
        this._onDidChangeTreeData.fire();
    }
}


async function verifyAssistantId(assistantId) {
    try {
        const assistant = await openAiClient.beta.assistants.retrieve(assistantId);
        return !!assistant; // Return true if the assistant exists
    } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
        return false; // Return false if the assistant ID is invalid
    }
}

async function sendToOpenAI(content) {
    try {
        const thread = await openAiClient.beta.threads.create();
        await openAiClient.beta.threads.messages.create(thread.id, {
            role: "user",
            content: `Please review this code:\n\n${content}`,
        });

        const run = await openAiClient.beta.threads.runs.create(thread.id, {
            assistant_id: assistantId,
        });

        let response;
        while (true) {
            const status = await openAiClient.beta.threads.runs.retrieve(thread.id, run.id);

            if (status.status === "completed") {
                const messages = await openAiClient.beta.threads.messages.list(thread.id);
                response = messages.data
                    .filter(msg => msg.role === "assistant")
                    .map(msg => msg.content[0].text.value)
                    .join("\n");
                break;
            }

            if (status.status === "failed") {
                throw new Error(status.last_error.message);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await openAiClient.beta.threads.del(thread.id);
        lastReviewResponse = response; // Store response for UI update
        treeDataProvider.refresh();
        return response;
    } catch (error) {
        console.error("Error sending code for review:", error);
        lastReviewResponse = `Error: ${error.message}`;
        treeDataProvider.refresh();
        return `Error: ${error.message}`;
    }
}

function activate(context) {
    openAiClient = new OpenAI({
        apiKey: "", // Replace with actual API key
        organization: "",
        project: "",
    });

    treeDataProvider = new CodeReviewTreeDataProvider();
    vscode.window.registerTreeDataProvider("codeReviewView", treeDataProvider);

    vscode.commands.registerCommand("ai-code-reviewer.editAssistantId", async () => {
        const newAssistantId = await vscode.window.showInputBox({
            prompt: "Enter your OpenAI Assistant ID",
            value: assistantId,
        });

        if (newAssistantId) {
            const isValid = await verifyAssistantId(newAssistantId);
            if (isValid) {
                assistantId = newAssistantId;
                treeDataProvider.refresh();
                vscode.window.showInformationMessage("Assistant ID updated successfully!");
            } else {
                vscode.window.showErrorMessage("Invalid Assistant ID. Please try again.");
            }
        }
    });

    vscode.commands.registerCommand("ai-code-reviewer.testAssistantId", async () => {
        const isValid = await verifyAssistantId(assistantId);
        if (isValid) {
            vscode.window.showInformationMessage("Assistant ID is valid!");
        } else {
            vscode.window.showErrorMessage("Invalid Assistant ID. Please update it.");
        }
    });

    vscode.commands.registerCommand("ai-code-reviewer.reviewSelectedCode", async () => {

        chatProvider = new ChatDataProvider();
        vscode.window.registerTreeDataProvider("codeReviewView", chatProvider);

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No active editor found.");
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) return sendFileForReview();
        const fileContent = editor.document.getText(selection.isEmpty ? undefined : selection);

        const fileName = editor.document.fileName.split("/").pop();
        vscode.window.showInformationMessage(`${fileName} sent for review`);

        chatProvider.appendMessage(selection.isEmpty ? fileName : fileContent, true); // Append User Message

        try {
            await sendToOpenAI(fileContent);
            chatProvider.appendMessage(lastReviewResponse, false); // Append AI Response
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
    });

    vscode.commands.registerCommand("ai-code-reviewer.sendForReview", sendFileForReview);
}

async function sendFileForReview() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor found.");
        return;
    }

    const fileContent = editor.document.getText();
    const fileName = editor.document.fileName.split("/").pop();

    vscode.window.showInformationMessage(`${fileName} sent for review`);
    chatProvider.appendMessage(fileName, true); // Append User Message

    try {
        await sendToOpenAI(fileContent);
        chatProvider.appendMessage(lastReviewResponse, false); // Append AI Response
    } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
    }
}

function deactivate() {
    vscode.window.showInformationMessage("Sorry to see you go.");
}

module.exports = {
    activate,
    deactivate,
};
