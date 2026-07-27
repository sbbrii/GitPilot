// ─── Recovery Manager ─────────────────────────────────────────────────────────
// Detects interrupted git operations and presents recovery options to the user.

import * as vscode from "vscode";
import * as path from "path";
import { spawnGit } from "../repo/RepositoryInspector";
import { bus } from "../core/eventBus";
import { logger } from "../core/logger";
import type { RepoState } from "../repo/types";

const log = logger.scope("RecoveryManager");

export interface RecoveryOption {
  label: string;
  command: string[];
}

export class RecoveryManager {
  /**
   * Called whenever a new RepoState is available.
   * If an interrupted operation is detected, surfaces recovery options.
   */
  async checkAndOfferRecovery(state: RepoState): Promise<void> {
    if (!state.mergeState.inProgress) return;

    const type = state.mergeState.type;
    log.warn("Interrupted git operation detected", { type });
    bus.emit("recovery.state.detected", { type: type ?? "unknown", files: [...state.workingTree.conflicts] });

    const options = this.buildRecoveryOptions(type);
    const choice = await vscode.window.showWarningMessage(
      `⚠️ Git ${type} is in progress with ${state.workingTree.conflicts.length} conflict(s). What would you like to do?`,
      { modal: false },
      ...options.map((o) => o.label),
    );

    if (!choice) return;
    const selected = options.find((o) => o.label === choice);
    if (!selected) return;

    log.info("User selected recovery action", { action: selected.label });
    try {
      await spawnGit(selected.command, state.repoPath, 30_000);
      vscode.window.showInformationMessage(`✅ ${selected.label} completed.`);
    } catch (e) {
      vscode.window.showErrorMessage(`Recovery action failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private buildRecoveryOptions(type: RepoState["mergeState"]["type"]): RecoveryOption[] {
    switch (type) {
      case "merge":
        return [
          { label: "Abort Merge", command: ["merge", "--abort"] },
        ];
      case "rebase":
        return [
          { label: "Abort Rebase", command: ["rebase", "--abort"] },
          { label: "Skip Current Commit", command: ["rebase", "--skip"] },
        ];
      case "cherry-pick":
        return [
          { label: "Abort Cherry-pick", command: ["cherry-pick", "--abort"] },
        ];
      case "revert":
        return [
          { label: "Abort Revert", command: ["revert", "--abort"] },
        ];
      default:
        return [];
    }
  }
}
