// ─── Repo Watcher ─────────────────────────────────────────────────────────────
// Watches .git/ directory for changes and debounces re-scan triggers.

import * as vscode from "vscode";
import { bus } from "../core/eventBus";
import { logger } from "../core/logger";
import type { RepositoryInspector } from "./RepositoryInspector";

const log = logger.scope("RepoWatcher");
const DEBOUNCE_MS = 250;

export class RepoWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly inspector: RepositoryInspector,
    repoPath: string,
  ) {
    // Watch .git/HEAD (branch switches, commits), .git/index (staging), refs
    const patterns = [
      new vscode.RelativePattern(vscode.Uri.file(repoPath), "**/.git/HEAD"),
      new vscode.RelativePattern(vscode.Uri.file(repoPath), "**/.git/index"),
      new vscode.RelativePattern(vscode.Uri.file(repoPath), "**/.git/refs/**"),
      new vscode.RelativePattern(vscode.Uri.file(repoPath), "**/.git/MERGE_HEAD"),
      new vscode.RelativePattern(vscode.Uri.file(repoPath), "**/.git/CHERRY_PICK_HEAD"),
      new vscode.RelativePattern(vscode.Uri.file(repoPath), "**/.git/REVERT_HEAD"),
    ];

    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(this.onGitChange, this, this.disposables);
      watcher.onDidCreate(this.onGitChange, this, this.disposables);
      watcher.onDidDelete(this.onGitChange, this, this.disposables);
      this.disposables.push(watcher);
    }

    log.debug("Watching .git directory for changes");
  }

  private onGitChange = (uri: vscode.Uri): void => {
    log.debug("Git change detected", { file: uri.fsPath });
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.triggerRescan(), DEBOUNCE_MS);
  };

  private async triggerRescan(): Promise<void> {
    try {
      this.inspector.invalidateCache();
      await this.inspector.getRepoState(true);
    } catch (e) {
      log.error("Re-scan failed after git change", e);
      bus.emit("repo.scan.failed", e instanceof Error ? e : new Error(String(e)));
    }
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const d of this.disposables) d.dispose();
  }
}
