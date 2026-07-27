// ─── Precondition Checker ─────────────────────────────────────────────────────
// Validates live RepoState against declared operation preconditions.

import type { RepoState } from "../repo/types";
import type { PlannedOperation } from "../planner/types";
import { PreconditionFailedError } from "../core/errors";

export interface PreconditionCheck {
  satisfied: boolean;
  failedCondition: string | null;
  remediation: string | null;
}

/**
 * Verify all declared preconditions for an operation against live repo state.
 * Returns first unsatisfied condition, or {satisfied:true} if all pass.
 * Pure function — testable without I/O.
 */
export function checkPreconditions(
  op: PlannedOperation,
  state: RepoState,
): PreconditionCheck {
  // Universal: block all writes if merge/rebase/cherry-pick is in progress
  if (state.mergeState.inProgress) {
    const opType = state.mergeState.type ?? "operation";
    const isContinue = op.command.args.includes("--continue") || op.command.args.includes("--abort");
    if (!isContinue) {
      return {
        satisfied: false,
        failedCondition: `A ${opType} is currently in progress`,
        remediation: `Resolve conflicts and complete or abort the ${opType} before running other write commands.`,
      };
    }
  }

  // Check each declared precondition string
  for (const condition of op.preconditions) {
    const check = evaluatePreconditionString(condition, state);
    if (!check.satisfied) return check;
  }

  return { satisfied: true, failedCondition: null, remediation: null };
}

function evaluatePreconditionString(condition: string, state: RepoState): PreconditionCheck {
  const lc = condition.toLowerCase();

  if (lc.includes("clean working tree") || lc.includes("no uncommitted changes")) {
    const dirty = state.workingTree.staged.length > 0 || state.workingTree.unstaged.length > 0;
    if (dirty) {
      return {
        satisfied: false,
        failedCondition: "Working tree is not clean",
        remediation: "Stash your changes with: git stash push -m 'WIP' or commit them first.",
      };
    }
  }

  if (lc.includes("no untracked")) {
    if (state.workingTree.untracked.length > 0) {
      return {
        satisfied: false,
        failedCondition: "Untracked files present",
        remediation: "Add files to .gitignore or stage and commit them.",
      };
    }
  }

  if (lc.includes("no conflicts")) {
    if (state.workingTree.conflicts.length > 0) {
      return {
        satisfied: false,
        failedCondition: "Unresolved conflicts present",
        remediation: "Resolve all merge conflicts before proceeding.",
      };
    }
  }

  if (lc.includes("on branch")) {
    // Extract branch name from condition e.g. "on branch main"
    const match = condition.match(/on branch (\S+)/i);
    if (match?.[1]) {
      const requiredBranch = match[1];
      if (state.head.branch !== requiredBranch) {
        return {
          satisfied: false,
          failedCondition: `Must be on branch '${requiredBranch}' (currently on '${state.head.branch ?? "detached HEAD"}')`,
          remediation: `Run: git switch ${requiredBranch}`,
        };
      }
    }
  }

  if (lc.includes("not detached")) {
    if (state.head.isDetached) {
      return {
        satisfied: false,
        failedCondition: "HEAD is detached",
        remediation: "Create or switch to a branch: git switch -c <branch-name>",
      };
    }
  }

  if (lc.includes("remote reachable") || lc.includes("remote configured")) {
    if (state.remotes.length === 0) {
      return {
        satisfied: false,
        failedCondition: "No remotes configured",
        remediation: "Add a remote with: git remote add origin <url>",
      };
    }
  }

  return { satisfied: true, failedCondition: null, remediation: null };
}

/** Throws PreconditionFailedError if any precondition is unsatisfied. */
export function assertPreconditions(op: PlannedOperation, state: RepoState): void {
  const check = checkPreconditions(op, state);
  if (!check.satisfied && check.failedCondition && check.remediation) {
    throw new PreconditionFailedError(check.failedCondition, check.remediation);
  }
}
