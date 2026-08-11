// ─── Git Copilot Extension Entry Point ────────────────────────────────────────

import * as vscode from "vscode";
import { logger } from "./core/logger";
import { config } from "./core/config";
import { bus } from "./core/eventBus";
import { RepositoryInspector } from "./repo/RepositoryInspector";
import { RepoWatcher } from "./repo/repoWatcher";
import { SafetyChecker } from "./safety/SafetyChecker";
import { ApprovalGate } from "./executor/approvalGate";
import { AuditLogger } from "./executor/auditLogger";
import { CommandExecutor } from "./executor/CommandExecutor";
import { RecoveryManager } from "./executor/recoveryManager";
import { LLMOrchestrator } from "./llm/LLMOrchestrator";
import { GraphDataBuilder } from "./graph/GraphDataBuilder";
import { StatusBarItem } from "./ui/statusBar";
import { ChatPanelProvider } from "./ui/ChatPanelProvider";
import { GraphPanelProvider } from "./ui/GraphPanelProvider";

const log = logger.scope("Extension");

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Git Copilot");
  logger.init(outputChannel);
  context.subscriptions.push(outputChannel);

  log.info("Activating Git Copilot extension...");

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    log.warn("No workspace folder open. Git Copilot deactivated.");
    return;
  }

  const repoPath = workspaceFolders[0]!.uri.fsPath;

  // Initialize core modules
  const inspector = new RepositoryInspector(repoPath);
  const watcher = new RepoWatcher(inspector, repoPath);
  const safetyChecker = new SafetyChecker();
  const approvalGate = new ApprovalGate();
  const auditLogger = new AuditLogger(context.workspaceState);
  const executor = new CommandExecutor(approvalGate, auditLogger);
  const recoveryManager = new RecoveryManager();
  const graphBuilder = new GraphDataBuilder();

  // Tool handler context for LLM Orchestrator
  const toolCtx = {
    inspector,
    safetyChecker,
    executor,
    approvalGate,
    graphBuilder,
    repoPath,
  };

  const orchestrator = new LLMOrchestrator(context.secrets, toolCtx);

  // UI Components
  const statusBar = new StatusBarItem();
  const chatProvider = new ChatPanelProvider(context.extensionUri, orchestrator, approvalGate);
  const graphProvider = new GraphPanelProvider(context.extensionUri, inspector, graphBuilder);

  // Register Webview Views & Commands
  context.subscriptions.push(
    watcher,
    statusBar,
    graphProvider,
    vscode.window.registerWebviewViewProvider(ChatPanelProvider.viewType, chatProvider),

    vscode.commands.registerCommand("gitCopilot.openChat", () => {
      vscode.commands.executeCommand("workbench.view.extension.gitCopilot");
    }),

    vscode.commands.registerCommand("gitCopilot.openGraph", () => {
      graphProvider.show();
    }),

    vscode.commands.registerCommand("gitCopilot.refreshRepo", async () => {
      inspector.invalidateCache();
      await inspector.getRepoState(true);
      vscode.window.showInformationMessage("Git Copilot: Repository state refreshed.");
    }),

    vscode.commands.registerCommand("gitCopilot.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your Anthropic API Key (sk-ant-...)",
        password: true,
        ignoreFocusOut: true,
      });
      if (key) {
        await config.setApiKey(context.secrets, key.trim());
        vscode.window.showInformationMessage("Git Copilot: API key saved securely.");
      }
    }),

    vscode.commands.registerCommand("gitCopilot.showAuditLog", () => {
      const logs = auditLogger.getAll();
      const doc = logs
        .map((l) => `[${l.timestamp}] exit:${l.exitCode} (${l.durationMs}ms) command: ${l.command.join(" ")}`)
        .join("\n");

      vscode.workspace.openTextDocument({ content: doc || "No audit entries recorded yet.", language: "text" }).then((d) => {
        vscode.window.showTextDocument(d);
      });
    }),
  );

  // Auto-check recovery state on repo update
  bus.on("repo.state.updated", (state) => {
    void recoveryManager.checkAndOfferRecovery(state);
  });

  // Perform initial scan
  try {
    await inspector.getRepoState(true);
    log.info("Git Copilot activated successfully.");
  } catch (e) {
    log.warn("Initial repository scan failed or not a git repository", { error: e });
  }
}

export function deactivate(): void {
  bus.clear();
}
