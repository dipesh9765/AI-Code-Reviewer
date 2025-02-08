const vscode = require("vscode");
const { OpenAI } = require("openai");

let openAiClient;
let assistantId = "asst_yZxRGLalWzVvVfnVisulCvUc"; // Default Assistant ID

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
            new vscode.TreeItem(
                "AI Code Reviewer",
                vscode.TreeItemCollapsibleState.None
            ),
            new vscode.TreeItem(
                `Assistant ID: ${assistantId}`,
                vscode.TreeItemCollapsibleState.None
            )
        ];
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

async function verifyAssistantId(assistantId) {
    try {
        const assistant = await openAiClient.beta.assistants.retrieve(assistantId);
        return !!assistant; // Return true if the assistant exists
    } catch (error) {
        return false; // Return false if the assistant ID is invalid
    }
}

async function sendToOpenAI(content) {
    try {
        // Step 1: Create a Thread
        const thread = await openAiClient.beta.threads.create();

        // Step 2: Add the Code as a Message to the Thread
        await openAiClient.beta.threads.messages.create(thread.id, {
            role: "user",
            content: `Please review this code:\n\n${content}`,
        });

        // Step 3: Run the Assistant
        const run = await openAiClient.beta.threads.runs.create(thread.id, {
            assistant_id: assistantId, // Replace with your Assistant ID
        });

        // Step 4: Poll for the Assistant's Response
        let response;
        while (true) {
            const status = await openAiClient.beta.threads.runs.retrieve(
                thread.id,
                run.id
            );

            if (status.status === "completed") {
                // Fetch the Assistant's Messages
                const messages = await openAiClient.beta.threads.messages.list(
                    thread.id
                );
                response = messages.data
                    .filter((msg) => msg.role === "assistant")
                    .map((msg) => msg.content[0].text.value)
                    .join("\n");
                break;
            }

            if (status.status === "failed") {
                throw new Error(status.last_error.message);
            }

            await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before polling again
        }

        // Clean up: Delete the thread
        await openAiClient.beta.threads.del(thread.id);

        return response;
    } catch (error) {
        console.error("Error sending code for review:", error);
        return `Error: ${error.message}`;
    }
}

function activate(context) {
    // Initialize OpenAI client
    openAiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        organization: process.env.ORGANIZATION_ID,
        project: process.env.PROJECT_ID,
    });

    // Register Tree Data Provider for Sidebar
    const treeDataProvider = new CodeReviewTreeDataProvider();
    vscode.window.registerTreeDataProvider("codeReviewView", treeDataProvider);

    // Add Input Box for Assistant ID
    vscode.commands.registerCommand(
        "ai-code-reviewer.setAssistantId",
        async () => {
            const newAssistantId = await vscode.window.showInputBox({
                prompt: "Enter your OpenAI Assistant ID",
                value: assistantId,
            });

            if (newAssistantId) {
                const isValid = await verifyAssistantId(newAssistantId);
                if (isValid) {
                    assistantId = newAssistantId;
                    treeDataProvider.refresh();
                    vscode.window.showInformationMessage(
                        "Assistant ID updated successfully!"
                    );
                } else {
                    vscode.window.showErrorMessage(
                        "Invalid Assistant ID. Please try again."
                    );
                }
            }
        }
    );

    // Add Context Menu Option for Code Review
    vscode.commands.registerCommand("ai-code-reviewer.reviewSelectedCode", async () => {
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            vscode.window.showErrorMessage("No active editor found.");
            return;
        }

        const selection = editor.selection;
        const fileContent = editor.document.getText(selection.isEmpty ? undefined : selection);
        if (!fileContent)
            return sendFileForReview();

        const fileName = editor.document.fileName.split("/").pop();

        vscode.window.showInformationMessage(`${fileName} sent for review`);

        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarItem.text = "$(sync~spin) Waiting for response...";
        statusBarItem.show();

        try {
            const response = await sendToOpenAI(fileContent);
            vscode.window.showInformationMessage(`Review: ${response}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        } finally {
            statusBarItem.hide();
        }
    });

    // Add Test Assistant ID Button
    vscode.commands.registerCommand("ai-code-reviewer.testAssistantId", async () => {
        const isValid = await verifyAssistantId(assistantId);
        if (isValid) {
            vscode.window.showInformationMessage("Assistant ID is valid!");
        } else {
            vscode.window.showErrorMessage("Invalid Assistant ID. Please update it.");
        }
    });

    // Register Command for Sending Code for Review
    vscode.commands.registerCommand(
        "ai-code-reviewer.sendForReview",
        sendFileForReview
    );
}

async function sendFileForReview() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showErrorMessage("No active editor found.");
        return;
    }

    const fileContent = editor.document.getText();
    const fileName = editor.document.fileName.split("/").pop();

    // Display "File_name sent for review"
    vscode.window.showInformationMessage(`${fileName} sent for review`);

    // Show loading indicator
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left
    );
    statusBarItem.text = "$(sync~spin) Waiting for response...";
    statusBarItem.show();

    try {
        const response = await sendToOpenAI(fileContent);
        vscode.window.showInformationMessage(`Review: ${response}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
    } finally {
        statusBarItem.hide();
    }
}

function deactivate() {
    vscode.window.showInformationMessage("Sorry to see you go.");
}

module.exports = {
    activate,
    deactivate,
};