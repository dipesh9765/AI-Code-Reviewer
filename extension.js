const vscode = require("vscode");
const { OpenAI } = require("openai");

let aiCodeReviewClient;

const FILE_CONST = {
    OPEN_AI_API_KEY: '',
    OPEN_AI_ORG: '',
    OPEN_AI_ASSISTANT_ID: ''
}

/**
 * @param {string} userQuery
 * @param {string | vscode.Selection} content
 * @param {{ (partialResponse: any): void; (arg0: any): void; }} onStreamResponse
 */
async function _sendToOpenAI(userQuery, content, onStreamResponse) {
    try {
        const thread = await aiCodeReviewClient.beta.threads.create();

        await aiCodeReviewClient.beta.threads.messages.create(thread.id, {
            role: "user",
            content: userQuery ? `${userQuery} \n\n Code: \n ${content}` : `Please review this code:\n\n${content}`,
        });

        const run = await aiCodeReviewClient.beta.threads.runs.create(thread.id, {
            assistant_id: FILE_CONST.OPEN_AI_ASSISTANT_ID,
            stream: true, // Enable streaming
        });

        // Process the stream
        for await (const event of run) {
            if (event.event === "thread.message.delta") {
                const content = event.data.delta.content?.[0]?.text?.value || "";

                // Send the partial response to the callback
                if (onStreamResponse) {
                    onStreamResponse(content);
                }
            }

            if (event.event === "thread.run.completed") {
                break; // Exit the loop when the run is completed
            }

            if (event.event === "thread.run.failed") {
                throw new Error(event.data.last_error?.message || "Run failed");
            }
        }

        await aiCodeReviewClient.beta.threads.del(thread.id);

    } catch (error) {
        console.error("Error sending code for review:", error);
        return `Error: ${error.message}`;
    }
}

function activate(context) {
    aiCodeReviewClient = new OpenAI({
        apiKey: FILE_CONST.OPEN_AI_API_KEY,
        organization: FILE_CONST.OPEN_AI_ORG,
    });

    if (!aiCodeReviewClient) {
        vscode.window.showErrorMessage("Failed to initialize OpenAI client");
        return;
    }

    const chatParticipant = vscode.chat.createChatParticipant(
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
            selection.isEmpty ? null :
                vscode.window.showInformationMessage(`${fileName} sent for review`);

            try {
                // var LAnswerFromAI = await _sendToOpenAI(userQuery, fileContent);
                response.markdown(`**AI Review:**\n\n`);
                // Call _sendToOpenAI with a callback for streaming
                await _sendToOpenAI(userQuery, fileContent, (partialResponse) => {
                    response.markdown(partialResponse);
                });

            } catch (error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
            }

            // response.markdown(`**AI Review:**\n\n${LAnswerFromAI}`);
        }
    );

    const EditAssitant = vscode.commands.registerCommand("ai-code-reviewer.editAssistantId", async () => {
        const newAssistantId = await vscode.window.showInputBox({
            prompt: "Enter your OpenAI Assistant ID",
            value: FILE_CONST.OPEN_AI_ASSISTANT_ID,
        });

        if (newAssistantId) {
            const isValid = await verifyAssistantId(newAssistantId);
            if (isValid) {
                FILE_CONST.OPEN_AI_ASSISTANT_ID = newAssistantId;
                vscode.window.showInformationMessage("Assistant ID updated successfully!");
            }
        } else {
            vscode.window.showWarningMessage("Assistant ID not updated as invalid ID was provided.");
        }
    });

    const EditAPIKey = vscode.commands.registerCommand("ai-code-reviewer.editAPIKey", async () => {
        const newApiKey = await vscode.window.showInputBox({
            prompt: "Enter your OpenAI API Key",
            value: "",
        });

        if (newApiKey && await verifyApiKey(newApiKey)) {
            FILE_CONST.OPEN_AI_API_KEY = newApiKey;

            aiCodeReviewClient = new OpenAI({
                apiKey: newApiKey,
                organization: FILE_CONST.OPEN_AI_ORG,
            });

            vscode.window.showInformationMessage("API Key updated successfully!");
        }
    });

    context.subscriptions.push(chatParticipant);
    context.subscriptions.push(EditAssitant);
    context.subscriptions.push(EditAPIKey);
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


async function verifyApiKey(apiKey) {
    const openai = new OpenAI({
        apiKey: apiKey,
    });

    try {
        // List models to verify the API key
        const models = await openai.models.list();
        if (models.data.length === 0) {
            throw new Error();
        }

        return true;
    } catch (error) {
        vscode.window.showWarningMessage("API Key is invalid or an error occurred: " + error.message);
        return false;
    }
}

function deactivate() {
}

module.exports = {
    activate,
    deactivate,
};
