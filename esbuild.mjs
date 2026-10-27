/* global process */
import { build, context } from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const integration = process.argv.includes("--integration");

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const options = integration
  ? {
      ...common,
      // Test code only: the launcher and the suite that runs inside the extension host.
      entryPoints: { run: "test/integration/run.ts", suite: "test/integration/suite.ts" },
      outdir: "out/integration",
      external: ["vscode", "@vscode/test-electron"],
      sourcemap: "linked",
    }
  : {
      ...common,
      entryPoints: ["src/extension.ts"],
      outfile: "dist/extension.js",
      sourcemap: production ? false : "linked",
      minify: production,
    };

if (watch && !integration) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
