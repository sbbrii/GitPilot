// ─── Status Bar ───────────────────────────────────────────────────────────────
// Displays repository state status bar item in VS Code footer.

import * as vscode from "vscode";
import { bus } from "../core/eventBus";
import type { RepoState } from "../repo/types";

export class StatusBarItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "gitCopilot.openChat";
    this.item.text = "$(git-branch) Git Copilot";
    this.item.tooltip = "Click to open Git Copilot Chat";
    this.item.show();

    bus.on("repo.state.updated", (state) => this.update(state));
    bus.on("repo.scan.started", () => {
      this.item.text = "$(sync~spin) Scanning git repo...";
    });
  }

  update(state: RepoState): void {
    const branch = state.head.isDetached
      ? `(${state.head.shortSha})`
      : state.head.branch ?? "no-branch";

    const staged = state.workingTree.staged.length;
    const unstaged = state.workingTree.unstaged.length;

    let changesText = "";
    if (staged > 0 || unstaged > 0) {
      changesText = ` (+${staged}/~${unstaged})`;
    }

    this.item.text = `$(git-branch) ${branch}${changesText}`;
    this.item.tooltip = `Git Copilot: ${branch}\nStaged: ${staged}, Unstaged: ${unstaged}\nCommits: ${state.commitLog.length}`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
