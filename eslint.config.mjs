import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "out/**", "coverage/**", "node_modules/**", ".vscode-test/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    // The pure core must never reach into the editor: that is what keeps it unit-testable.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "vscode", message: "src/core must not depend on the VS Code API." }] },
      ],
    },
  },
  {
    files: ["*.mjs", "*.config.mts"],
    ...tseslint.configs.disableTypeChecked,
  },
);
