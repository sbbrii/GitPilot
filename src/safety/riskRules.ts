// ─── Risk Rules ───────────────────────────────────────────────────────────────
// Static, deterministic risk rules. These never depend on LLM judgment.

import type { RiskCode } from "./types";
import type { RiskLevel } from "../planner/types";

export interface RiskRule {
  readonly code: RiskCode;
  readonly description: string;
  readonly defaultSeverity: "info" | "warning" | "critical";
  readonly recommendation: string;
  /** Whether this finding blocks execution entirely */
  readonly blocking: boolean;
  /** Whether typing a confirmation phrase is required (beyond clicking approve) */
  readonly requiresTypedConfirmation: boolean;
}

/** Canonical allowlist of permitted git subcommands. */
export const ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  // Read-only
  "log", "status", "diff", "show", "branch", "remote", "stash", "tag",
  "describe", "rev-parse", "cat-file", "ls-files", "ls-tree", "shortlog",
  "reflog", "for-each-ref", "symbolic-ref", "name-rev",
  // Reversible write
  "add", "commit", "merge", "checkout", "switch", "restore", "fetch",
  "pull", "cherry-pick", "revert",
  // Destructive (approval-gated)
  "push", "reset", "rebase", "rm", "clean", "config",
]);

/** Subcommands that are permanently blocked — never executable through copilot. */
export const BLOCKED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "filter-branch",
  "fast-export",
  "fast-import",
  "bundle",
  "gc",
  "fsck",
  "update-ref",
  "hash-object",
  "pack-objects",
  "unpack-objects",
  "receive-pack",
  "upload-pack",
  "daemon",
  "instaweb",
  "submodule", // Too complex for v1
  "bisect",    // Interactive — out of scope for v1
  "worktree",  // Out of scope for v1
]);

/** Shell metacharacters that must never appear in any argument. */
export const SHELL_METACHARACTERS = /[|;&$`<>\\'"!(){}\[\]\n\r]/;

export const RISK_RULES: ReadonlyMap<RiskCode, RiskRule> = new Map([
  ["HISTORY_REWRITE", {
    code: "HISTORY_REWRITE",
    description: "This command rewrites git history, which can cause problems for collaborators who have already fetched the affected commits.",
    defaultSeverity: "critical",
    recommendation: "Only rewrite history on branches that no other collaborator has fetched. Always coordinate with your team first.",
    blocking: false,
    requiresTypedConfirmation: true,
  }],
  ["FORCE_PUSH", {
    code: "FORCE_PUSH",
    description: "Force pushing overwrites remote history and can permanently delete commits that others depend on.",
    defaultSeverity: "critical",
    recommendation: "Use --force-with-lease instead of --force, and ensure no one else is working on this branch.",
    blocking: false,
    requiresTypedConfirmation: true,
  }],
  ["HARD_RESET", {
    code: "HARD_RESET",
    description: "Hard reset discards all uncommitted changes and moves HEAD to the target, which cannot be undone via normal git commands.",
    defaultSeverity: "critical",
    recommendation: "Stash your changes first. Commits can be recovered via git reflog, but uncommitted changes cannot.",
    blocking: false,
    requiresTypedConfirmation: true,
  }],
  ["CLEAN_UNTRACKED", {
    code: "CLEAN_UNTRACKED",
    description: "git clean permanently deletes untracked files. These cannot be recovered after deletion.",
    defaultSeverity: "critical",
    recommendation: "Run with -n (dry-run) first to see what would be deleted. Consider moving files rather than deleting.",
    blocking: false,
    requiresTypedConfirmation: true,
  }],
  ["BRANCH_DELETE_UNMERGED", {
    code: "BRANCH_DELETE_UNMERGED",
    description: "This branch has commits that are not merged into any other branch. Deleting it will orphan those commits (recoverable only via reflog for a limited time).",
    defaultSeverity: "critical",
    recommendation: "Merge or cherry-pick any valuable commits before deleting this branch.",
    blocking: false,
    requiresTypedConfirmation: true,
  }],
  ["BRANCH_DELETE_MERGED", {
    code: "BRANCH_DELETE_MERGED",
    description: "This branch will be deleted. All its commits are already merged so no work is lost.",
    defaultSeverity: "info",
    recommendation: "Safe to proceed.",
    blocking: false,
    requiresTypedConfirmation: false,
  }],
  ["DETACHED_HEAD_RESULT", {
    code: "DETACHED_HEAD_RESULT",
    description: "This operation will leave the repository in detached HEAD state. New commits will not belong to any branch.",
    defaultSeverity: "warning",
    recommendation: "Create a new branch immediately after with: git switch -c <new-branch>",
    blocking: false,
    requiresTypedConfirmation: false,
  }],
  ["UNCOMMITTED_CHANGES", {
    code: "UNCOMMITTED_CHANGES",
    description: "You have uncommitted changes that might be lost or cause conflicts during this operation.",
    defaultSeverity: "warning",
    recommendation: "Stash your changes with: git stash push -m 'WIP before <operation>'",
    blocking: false,
    requiresTypedConfirmation: false,
  }],
  ["DIVERGED_REMOTE", {
    code: "DIVERGED_REMOTE",
    description: "Your local branch has diverged from its remote tracking branch. Pushing may fail or overwrite remote changes.",
    defaultSeverity: "warning",
    recommendation: "Run git pull --rebase first to reconcile the diverged history.",
    blocking: false,
    requiresTypedConfirmation: false,
  }],
  ["STASH_DROP", {
    code: "STASH_DROP",
    description: "Dropping a stash entry permanently removes it. Unlike commits, stash entries cannot be recovered via reflog after a drop.",
    defaultSeverity: "critical",
    recommendation: "Apply the stash first if you need the changes, then discard the working tree.",
    blocking: false,
    requiresTypedConfirmation: true,
  }],
  ["INTERACTIVE_REBASE", {
    code: "INTERACTIVE_REBASE",
    description: "Interactive rebase rewrites history and normally requires an editor. Git Copilot will manage the rebase plan without opening an editor.",
    defaultSeverity: "critical",
    recommendation: "Ensure no one else has based work on the commits being rebased.",
    blocking: false,
    requiresTypedConfirmation: true,
  }],
  ["BLOCKED_COMMAND", {
    code: "BLOCKED_COMMAND",
    description: "This git subcommand is not permitted by Git Copilot safety policy.",
    defaultSeverity: "critical",
    recommendation: "Use only the allowed set of git commands. See documentation for the list.",
    blocking: true,
    requiresTypedConfirmation: false,
  }],
  ["MERGE_IN_PROGRESS", {
    code: "MERGE_IN_PROGRESS",
    description: "A merge is currently in progress. Resolve conflicts before running other write operations.",
    defaultSeverity: "critical",
    recommendation: "Resolve all conflicts, then run: git add <files> && git merge --continue",
    blocking: true,
    requiresTypedConfirmation: false,
  }],
  ["CHERRY_PICK_IN_PROGRESS", {
    code: "CHERRY_PICK_IN_PROGRESS",
    description: "A cherry-pick is currently in progress. Resolve conflicts before running other operations.",
    defaultSeverity: "critical",
    recommendation: "Resolve all conflicts, then run: git cherry-pick --continue",
    blocking: true,
    requiresTypedConfirmation: false,
  }],
]);

/**
 * Compute the aggregate risk level from an array of individual risk levels.
 * Returns the highest-severity level found.
 */
export function aggregateRiskLevel(levels: RiskLevel[]): RiskLevel {
  if (levels.includes("destructive")) return "destructive";
  if (levels.includes("reversible")) return "reversible";
  return "safe";
}
