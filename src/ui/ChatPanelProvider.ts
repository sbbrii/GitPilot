// ─── Chat Panel Provider ──────────────────────────────────────────────────────
// WebviewViewProvider for the sidebar chat UI.

import * as vscode from "vscode";
import { bus } from "../core/eventBus";
import { logger } from "../core/logger";
import type { LLMOrchestrator } from "../llm/LLMOrchestrator";
import type { ApprovalGate } from "../executor/approvalGate";
import type { H2CMessage, C2HMessage } from "./messageProtocol";

const log = logger.scope("ChatPanelProvider");

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "gitCopilot.chatView";
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly orchestrator: LLMOrchestrator,
    private readonly approvalGate: ApprovalGate,
  ) {
    bus.on("llm.stream.token", (token) => {
      this.postMessage({ type: "chat.token", token });
    });

    bus.on("llm.stream.done", () => {
      this.postMessage({ type: "chat.done" });
    });

    bus.on("llm.error", (err) => {
      this.postMessage({ type: "chat.error", message: err.message });
    });

    bus.on("approval.requested", (request) => {
      this.postMessage({
        type: "approval.request",
        id: request.id,
        // Use the stored dry-run display text; fall back to the operation ID if somehow missing
        commandDisplay: request.dryRunOutput.split("\n")[0]?.trim() || `Operation ${request.operationId}`,
        dryRunOutput: request.dryRunOutput,
        dryRunDiff: request.dryRunDiff,
        riskLevel: request.riskLevel,
        warnings: [...request.riskWarnings],
        requiresTyped: request.requiresTypedConfirmation,
        phrase: request.typedConfirmationPhrase,
      });
    });

    bus.on("approval.expired", (request) => {
      this.postMessage({ type: "approval.expired", id: request.id });
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: C2HMessage) => {
      this.handleWebviewMessage(msg);
    });
  }

  private handleWebviewMessage(msg: C2HMessage): void {
    log.debug("Received webview message", { type: msg.type });

    switch (msg.type) {
      case "chat.send":
        void this.orchestrator.chat(msg.message);
        break;
      case "approval.granted":
        try {
          this.approvalGate.grant(msg.id, msg.typedPhrase);
        } catch (e) {
          this.postMessage({ type: "chat.error", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      case "approval.denied":
        this.approvalGate.deny(msg.id);
        break;
      case "ready":
        this.sendHistory();
        break;
    }
  }

  private sendHistory(): void {
    const history = this.orchestrator.getHistory().map((h) => ({
      role: h.role,
      content: h.content,
      ts: h.timestamp,
    }));
    this.postMessage({ type: "chat.history", messages: history });
  }

  private postMessage(msg: H2CMessage): void {
    void this.view?.webview.postMessage(msg);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "webview", "chat.js"),
    );

    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Git Copilot Chat</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-foreground); background-color: var(--vscode-editor-background); margin: 0; }
    #chat-container { display: flex; flex-direction: column; height: 100vh; }
    #messages { flex: 1; overflow-y: auto; margin-bottom: 10px; }
    .msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; }
    .msg.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; }
    .msg.assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
    .approval-card { border: 1px solid var(--vscode-notifications-border); padding: 10px; border-radius: 6px; margin: 10px 0; background: var(--vscode-input-background); }
    .approval-card.destructive { border-color: var(--vscode-statusBarItem-errorBackground); }
    .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
    .btn-deny { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-left: 6px; }
    #input-container { display: flex; gap: 6px; }
    #input { flex: 1; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
  </style>
</head>
<body>
  <div id="chat-container">
    <div id="messages"></div>
    <div id="input-container">
      <input type="text" id="input" placeholder="Ask Git Copilot..." />
      <button class="btn" id="send-btn">Send</button>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
