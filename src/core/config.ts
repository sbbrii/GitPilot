import * as vscode from "vscode";

/** Strongly-typed accessor for all extension configuration values. */
export const config = {
  get llmModel(): string {
    return vscode.workspace
      .getConfiguration("gitCopilot.llm")
      .get<string>("model", "claude-sonnet-4-5");
  },
  get llmMaxTokens(): number {
    return vscode.workspace
      .getConfiguration("gitCopilot.llm")
      .get<number>("maxTokens", 4096);
  },
  get executorTimeoutMs(): number {
    return vscode.workspace
      .getConfiguration("gitCopilot.executor")
      .get<number>("timeoutMs", 30_000);
  },
  get approvalExpiryMs(): number {
    return vscode.workspace
      .getConfiguration("gitCopilot.executor")
      .get<number>("approvalExpiryMs", 60_000);
  },
  get commitLogDepth(): number {
    return vscode.workspace
      .getConfiguration("gitCopilot.repo")
      .get<number>("commitLogDepth", 100);
  },
  get telemetryEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("gitCopilot.telemetry")
      .get<boolean>("enabled", false);
  },

  /** Retrieve the API key from VS Code's encrypted SecretStorage. */
  async getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
    return secrets.get("gitCopilot.anthropic.apiKey");
  },

  async setApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
    await secrets.store("gitCopilot.anthropic.apiKey", key);
  },
};
