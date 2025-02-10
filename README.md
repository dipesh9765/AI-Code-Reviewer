# AI Code Reviewer

A VS Code extension that uses **OpenAI's Assistant API** to review your code in real-time. Get instant feedback on your code quality, best practices, and potential improvements directly within your editor.

---

## Features

- **Real-Time Code Review**: Send your code to an OpenAI Assistant for review and get instant feedback.
- **Streaming Responses**: Receive responses in real-time as the AI processes your code.
- **Customizable Assistant ID**: Use your own OpenAI Assistant for tailored code reviews.
- **Sidebar Chat Interface**: Interact with the AI in a dedicated sidebar panel.
- **Context Menu Integration**: Right-click on selected code to send it for review.

---

## Installation

1. Open **VS Code**.
2. Go to the **Extensions** view by clicking on the Extensions icon in the Activity Bar on the side of the window or pressing `Ctrl+Shift+X`.
3. Search for **"AI Code Reviewer"**.
4. Click **Install** to install the extension.

---

## Setup

### 1. **Get an OpenAI API Key**

- Sign up for an account at [OpenAI](https://platform.openai.com/signup).
- Generate an API key from the [API Keys](https://platform.openai.com/account/api-keys) page.

### 2. **Set Your API Key**

- Open the **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
- Search for and run the command: **"AI Code Reviewer: Change API Key"**.
- Enter your OpenAI API key when prompted.

### 3. **Set Your Assistant ID**

- Open the **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
- Search for and run the command: **"AI Code Reviewer: Change Assistant ID"**.
- Enter your OpenAI Assistant ID when prompted.

---

## Usage

### **1. Review Selected Code**

- Select the code you want to review in the editor.
- Right-click and choose **"AI Code Reviewer: Review Selected Code"**.
- The AI's response will appear in the sidebar chat.

### **2. Review Entire File**

- Open the file you want to review.
- Open the **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
- Search for and run the command: **"AI Code Reviewer: Review File"**.

### **3. Interact with the AI**

- Open the **AI Code Reviewer Chat** from the sidebar.
- Type your query or code in the input box and press **Send**.
- The AI will respond in real-time.

---

## Configuration

### **1. Change API Key**

- Open the **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
- Search for and run the command: **"AI Code Reviewer: Change API Key"**.

### **2. Change Assistant ID**

- Open the **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
- Search for and run the command: **"AI Code Reviewer: Change Assistant ID"**.

---

## Commands

| Command                                  | Description                         |
| ---------------------------------------- | ----------------------------------- |
| `AI Code Reviewer: Review File`          | Sends the entire file for review.   |
| `AI Code Reviewer: Review Selected Code` | Sends the selected code for review. |
| `AI Code Reviewer: Change API Key`       | Updates the OpenAI API key.         |
| `AI Code Reviewer: Change Assistant ID`  | Updates the OpenAI Assistant ID.    |

---

## Example Queries

- **Code Review**: "Can you review this code for best practices?"
- **Bug Fixing**: "Is there a bug in this function?"
- **Optimization**: "How can I optimize this code?"
- **Explanation**: "Can you explain what this code does?"

---

## Screenshots

### **Sidebar Chat Interface**

![Sidebar Chat Interface](https://via.placeholder.com/600x400.png?text=Sidebar+Chat+Interface)

### **Code Review in Action**

![Code Review in Action](https://via.placeholder.com/600x400.png?text=Code+Review+in+Action)

---

## Contributing

Contributions are welcome! If you'd like to contribute to this project, please follow these steps:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/YourFeatureName`).
3. Commit your changes (`git commit -m 'Add some feature'`).
4. Push to the branch (`git push origin feature/YourFeatureName`).
5. Open a pull request.

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- **OpenAI** for providing the powerful Assistant API.
- **VS Code** for the extensible editor platform.

---

## Support

If you encounter any issues or have suggestions for improvement, please [open an issue](https://github.com/your-repo/ai-code-reviewer/issues).

---

Enjoy using **AI Code Reviewer**! 🚀
