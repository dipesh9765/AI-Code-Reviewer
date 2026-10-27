import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runTests } from "@vscode/test-electron";

/**
 * Launches a real VS Code with the extension loaded and runs `suite.js` inside the extension
 * host. Uses throwaway user-data and extension directories so it cannot touch the developer's
 * own VS Code profile. Set VSCODE_EXECUTABLE to reuse an installed VS Code instead of
 * downloading one.
 */
async function main(): Promise<void> {
  // EXTENSION_PATH points at an unpacked .vsix (its `extension/` folder) to test the packaged
  // artifact instead of the source tree.
  const root = process.env.EXTENSION_PATH ?? path.resolve(__dirname, "..", "..");
  const scratch = mkdtempSync(path.join(tmpdir(), "aicr-it-"));
  const executable = process.env.VSCODE_EXECUTABLE;
  await runTests({
    ...(executable ? { vscodeExecutablePath: executable } : {}),
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "suite.js"),
    launchArgs: [
      "--disable-extensions",
      "--disable-workspace-trust",
      "--user-data-dir",
      path.join(scratch, "user"),
      "--extensions-dir",
      path.join(scratch, "ext"),
    ],
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
