// ─── Command Classifier ───────────────────────────────────────────────────────
// Deterministic classification of git commands by risk level.
// Pure functions — fully unit-testable, zero I/O.

import type { RiskLevel } from "../planner/types";
import type { RiskCode } from "./types";
import {
  ALLOWED_SUBCOMMANDS,
  BLOCKED_SUBCOMMANDS,
  SHELL_METACHARACTERS,
} from "./riskRules";
import { ShellInjectionAttemptError, BlockedCommandError } from "../core/errors";

export interface ClassificationResult {
  riskLevel: RiskLevel;
  riskCodes: RiskCode[];
  requiresDryRun: boolean;
  requiresApproval: boolean;
  requiresTypedConfirmation: boolean;
}

/** Strictly read-only git subcommands — no mutations. */
const READ_ONLY_SUBCOMMANDS = new Set([
  "log", "status", "diff", "show", "describe", "rev-parse", "cat-file",
  "ls-files", "ls-tree", "shortlog", "for-each-ref", "symbolic-ref", "name-rev",
]);

/** Reversible write operations. */
const REVERSIBLE_SUBCOMMANDS = new Set([
  "add", "commit", "merge", "checkout", "switch", "restore", "fetch",
  "pull", "cherry-pick", "revert",
]);

/**
 * Validate that an argv array contains no shell metacharacters.
 * Throws ShellInjectionAttemptError if any arg is suspicious.
 */
export function validateArgvSafety(args: readonly string[]): void {
  for (const arg of args) {
    if (SHELL_METACHARACTERS.test(arg)) {
      throw new ShellInjectionAttemptError(arg);
    }
  }
}

/**
 * Classify a git command (expressed as an argv array) by risk level.
 * This is the primary safety gate — deterministic, no LLM.
 */
export function classifyCommand(args: readonly string[]): ClassificationResult {
  // Validate argv is safe before any other processing
  validateArgvSafety(args);

  const subcommand = args[0];
  if (!subcommand) {
    return { riskLevel: "safe", riskCodes: [], requiresDryRun: false, requiresApproval: false, requiresTypedConfirmation: false };
  }

  // Permanently blocked subcommands
  if (BLOCKED_SUBCOMMANDS.has(subcommand)) {
    throw new BlockedCommandError(["git", ...args]);
  }

  // Subcommand not on allowlist
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new BlockedCommandError(["git", ...args]);
  }

  // ── Read-only ──────────────────────────────────────────────────────────────
  if (READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    // branch/remote/stash/tag/reflog with list flags are also safe
    if (subcommand === "branch" && !args.includes("-d") && !args.includes("-D") && !args.includes("-m")) {
      return safe();
    }
    if (subcommand === "remote" && !args.includes("add") && !args.includes("remove") && !args.includes("set-url")) {
      return safe();
    }
    if (subcommand === "stash" && args[1] === "list") return safe();
    if (subcommand === "tag" && !args.includes("-a") && !args.includes("-d")) return safe();
    if (subcommand === "reflog" && (args[1] === "show" || args[1] === undefined)) return safe();
    if (!["branch", "remote", "stash", "tag", "reflog"].includes(subcommand)) return safe();
  }

  // ── push ──────────────────────────────────────────────────────────────────
  if (subcommand === "push") {
    if (args.includes("--force") && !args.includes("--force-with-lease")) {
      throw new BlockedCommandError(["git", ...args]); // --force without --force-with-lease is permanently blocked
    }
    if (args.includes("--force-with-lease")) {
      return {
        riskLevel: "destructive",
        riskCodes: ["FORCE_PUSH"],
        requiresDryRun: true,
        requiresApproval: true,
        requiresTypedConfirmation: true,
      };
    }
    return reversible(true, true, false);
  }

  // ── reset ─────────────────────────────────────────────────────────────────
  if (subcommand === "reset") {
    if (args.includes("--hard")) {
      return destructive(["HARD_RESET", "HISTORY_REWRITE"]);
    }
    if (args.includes("--soft") || args.includes("--mixed")) {
      return destructive(["HISTORY_REWRITE"]);
    }
    return reversible(true, true, false); // bare reset
  }

  // ── rebase ────────────────────────────────────────────────────────────────
  if (subcommand === "rebase") {
    if (args.includes("-i") || args.includes("--interactive")) {
      return destructive(["INTERACTIVE_REBASE", "HISTORY_REWRITE"]);
    }
    return destructive(["HISTORY_REWRITE"]);
  }

  // ── clean ─────────────────────────────────────────────────────────────────
  if (subcommand === "clean") {
    if (args.includes("-n") || args.includes("--dry-run")) return safe();
    return destructive(["CLEAN_UNTRACKED"]);
  }

  // ── branch -d / -D ────────────────────────────────────────────────────────
  if (subcommand === "branch") {
    if (args.includes("-D")) return destructive(["BRANCH_DELETE_UNMERGED"]);
    if (args.includes("-d")) {
      return { riskLevel: "reversible", riskCodes: ["BRANCH_DELETE_MERGED"], requiresDryRun: true, requiresApproval: true, requiresTypedConfirmation: false };
    }
    if (args.includes("-m")) return reversible(false, true, false);
    return safe();
  }

  // ── stash drop/clear ──────────────────────────────────────────────────────
  if (subcommand === "stash") {
    const sub2 = args[1];
    if (sub2 === "drop" || sub2 === "clear") return destructive(["STASH_DROP"]);
    if (sub2 === "push") return reversible(true, true, false);
    if (sub2 === "pop" || sub2 === "apply") return reversible(false, true, false);
    return safe();
  }

  // ── commit --amend ────────────────────────────────────────────────────────
  if (subcommand === "commit" && args.includes("--amend")) {
    return destructive(["HISTORY_REWRITE"]);
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  if (subcommand === "fetch") return reversible(false, false, false);

  // ── All other reversible subcommands ──────────────────────────────────────
  if (REVERSIBLE_SUBCOMMANDS.has(subcommand)) {
    return reversible(true, true, false);
  }

  // Fallback — unknown allowed command, treat as reversible
  return reversible(true, true, false);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safe(): ClassificationResult {
  return { riskLevel: "safe", riskCodes: [], requiresDryRun: false, requiresApproval: false, requiresTypedConfirmation: false };
}

function reversible(requiresDryRun: boolean, requiresApproval: boolean, requiresTypedConfirmation: boolean): ClassificationResult {
  return { riskLevel: "reversible", riskCodes: [], requiresDryRun, requiresApproval, requiresTypedConfirmation };
}

function destructive(riskCodes: RiskCode[]): ClassificationResult {
  return {
    riskLevel: "destructive",
    riskCodes,
    requiresDryRun: true,
    requiresApproval: true,
    requiresTypedConfirmation: true,
  };
}
