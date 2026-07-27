// @ts-check
const esbuild = require("esbuild");
const path = require("path");

const isProduction = process.argv.includes("--production");
const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const hostConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  sourcemap: !isProduction,
  minify: isProduction,
  define: { "process.env.NODE_ENV": isProduction ? '"production"' : '"development"' },
};

/** @type {import('esbuild').BuildOptions} */
const chatWebviewConfig = {
  entryPoints: ["webview-src/chat/index.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  outfile: "resources/webview/chat.js",
  sourcemap: !isProduction,
  minify: isProduction,
};

/** @type {import('esbuild').BuildOptions} */
const graphWebviewConfig = {
  entryPoints: ["webview-src/graph/index.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  outfile: "resources/webview/graph.js",
  sourcemap: !isProduction,
  minify: isProduction,
};

async function build() {
  if (isWatch) {
    const [hostCtx, chatCtx, graphCtx] = await Promise.all([
      esbuild.context(hostConfig),
      esbuild.context(chatWebviewConfig),
      esbuild.context(graphWebviewConfig),
    ]);
    await Promise.all([hostCtx.watch(), chatCtx.watch(), graphCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(hostConfig),
      esbuild.build(chatWebviewConfig),
      esbuild.build(graphWebviewConfig),
    ]);
    console.log("Build complete.");
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
