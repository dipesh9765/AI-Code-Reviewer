const vscode = require("vscode");
const { OpenAI } = require("openai");

let aiCodeReviewClient;
let assistantId = "asst_yZxRGLalWzVvVfnVisulCvUc"; // Default Assistant ID  

/**
 * @param {string} userQuery
 * @param {string | vscode.Selection} content
 */
async function _sendToOpenAI(userQuery, content) {
    try {
        const thread = await aiCodeReviewClient.beta.threads.create();

        await aiCodeReviewClient.beta.threads.messages.create(thread.id, {
            role: "user",
            content: userQuery ? `${userQuery} \n\n Code: \n ${content}` : `Please review this code:\n\n${content}`,
        });

        const run = await aiCodeReviewClient.beta.threads.runs.create(thread.id, {
            assistant_id: assistantId,
        });

        let response;
        while (true) {
            const status = await aiCodeReviewClient.beta.threads.runs.retrieve(thread.id, run.id);

            if (status.status === "completed") {
                const messages = await aiCodeReviewClient.beta.threads.messages.list(thread.id);
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

        await aiCodeReviewClient.beta.threads.del(thread.id);

        return response;
    } catch (error) {
        console.error("Error sending code for review:", error);
        return `Error: ${error.message}`;
    }
}

function activate() {
    aiCodeReviewClient = new OpenAI({
        apiKey: "", // Replace with actual API key
        organization: '',
        project: ''
    });

    if (!aiCodeReviewClient) {
        vscode.window.showErrorMessage("Failed to initialize OpenAI client");
        return;
    }

    vscode.chat.createChatParticipant(
        "ai-code-reviewer.aiCodeReviewer",
        async (request, context, response) => {
            const userQuery = request.prompt;
            response.progress("AI is reviewing the code...");

            const editor = vscode.window.activeTextEditor;

            if (!editor) {
                vscode.window.showErrorMessage("No active editor found.");
                return;
            }

            const selection = editor.selection;
            const fileContent = selection ? editor.document.getText(
                selection.isEmpty ? undefined : selection
            ) : selection;

            const fileName = editor.document.fileName.split("/").pop();
            vscode.window.showInformationMessage(`${fileName} sent for review`);

            try {
                var LAnswerFromAI = await _sendToOpenAI(userQuery, fileContent);
            } catch (error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
            }

            response.markdown(`**AI Review:**\n\n${LAnswerFromAI}`);
        }
    );

    vscode.commands.registerCommand("ai-code-reviewer.editAssistantId", async () => {
        const newAssistantId = await vscode.window.showInputBox({
            prompt: "Enter your OpenAI Assistant ID",
            value: assistantId,
        });

        if (newAssistantId) {
            const isValid = await verifyAssistantId(newAssistantId);
            if (isValid) {
                assistantId = newAssistantId;
                vscode.window.showInformationMessage("Assistant ID updated successfully!");
            }
        } else {
            vscode.window.showWarningMessage("Assistant ID not updated as invalid ID was provided.");
        }
    });

}


async function verifyAssistantId(assistantId) {
    try {
        const assistant = await aiCodeReviewClient.beta.assistants.retrieve(assistantId);
        return !!assistant; // Return true if the assistant exists
    } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
        return false; // Return false if the assistant ID is invalid
    }
}

function deactivate() {
}

module.exports = {
    activate,
    deactivate,
};
