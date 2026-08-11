// ─── Graph Panel Provider ─────────────────────────────────────────────────────
// Manages the WebviewPanel for rendering the commit graph.

import * as vscode from "vscode";
import { bus } from "../core/eventBus";
import { logger } from "../core/logger";
import type { GraphDataBuilder } from "../graph/GraphDataBuilder";
import type { RepositoryInspector } from "../repo/RepositoryInspector";
import type { H2GMessage, G2HMessage } from "./messageProtocol";

const log = logger.scope("GraphPanelProvider");

export class GraphPanelProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly inspector: RepositoryInspector,
    private readonly graphBuilder: GraphDataBuilder,
  ) {
    bus.on("graph.data.ready", (data) => {
      this.postMessage({ type: "graph.data", data });
    });

    bus.on("repo.state.updated", (state) => {
      if (this.panel) {
        const data = this.graphBuilder.build(state);
        this.postMessage({ type: "graph.data", data });
      }
    });
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "gitCopilot.graph",
      "Git Copilot Commit Graph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [this.extensionUri],
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.webview.onDidReceiveMessage((msg: G2HMessage) => {
      this.handleWebviewMessage(msg);
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private handleWebviewMessage(msg: G2HMessage): void {
    log.debug("Received graph webview message", { type: msg.type });

    switch (msg.type) {
      case "ready":
        void this.sendLatestGraph();
        break;
      case "graph.commitClick":
        log.info("Graph commit clicked", { sha: msg.sha });
        break;
      case "graph.contextMenu":
        log.info("Graph context menu action", { sha: msg.sha, action: msg.action });
        break;
    }
  }

  private async sendLatestGraph(): Promise<void> {
    try {
      const state = await this.inspector.getRepoState();
      const data = this.graphBuilder.build(state);
      this.postMessage({ type: "graph.data", data });
    } catch (e) {
      log.error("Failed to build graph data for webview", e);
    }
  }

  private postMessage(msg: H2GMessage): void {
    void this.panel?.webview.postMessage(msg);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "webview", "graph.js"),
    );

    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Commit Graph</title>
  <style>
    body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); margin: 0; padding: 12px; overflow: hidden; }
    #graph-container { width: 100vw; height: 100vh; overflow: auto; }
    svg { width: 100%; height: 100%; }
    .commit-node { cursor: pointer; }
    .commit-node:hover { stroke: #fff; stroke-width: 2px; }
    .edge { fill: none; stroke-width: 2px; }
    .label-badge { font-size: 10px; font-weight: bold; rx: 3px; ry: 3px; }
  </style>
</head>
<body>
  <div id="graph-container">
    <svg id="svg-graph"></svg>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
