// ─── Safety Checker Unit Tests ───────────────────────────────────────────────
// Tests SafetyChecker.analyze against various sets of operations and RepoState.

import { describe, it, expect } from "vitest";
import { SafetyChecker } from "../../src/safety/SafetyChecker";
import type { PlannedOperation } from "../../src/planner/types";
import type { RepoState } from "../../src/repo/types";

function makeOp(overrides: Partial<PlannedOperation> = {}): PlannedOperation {
  return {
    id: "op-1",
    sequenceIndex: 0,
    intent: "test op",
    command: { program: "git", args: ["status"], cwd: "/repo" },
    riskLevel: "safe",
    riskRationale: "",
    reversible: true,
    reversalCommand: null,
    requiresDryRun: false,
    requiresApproval: false,
    preconditions: [],
    postconditions: [],
    ...overrides,
  };
}

function makeState(overrides: Partial<RepoState> = {}): RepoState {
  return {
    repoPath: "/repo",
    head: { branch: "main", sha: "a".repeat(40), shortSha: "aaaaaaa", isDetached: false, message: "Init" },
    branches: [],
    remotes: [],
    stash: [],
    commitLog: [],
    workingTree: { staged: [], unstaged: [], untracked: [], conflicts: [] },
    mergeState: { inProgress: false, type: null, conflictedFiles: [] },
    scannedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SafetyChecker", () => {
  const checker = new SafetyChecker();

  it("analyzes a safe set of operations", () => {
    const ops = [
      makeOp({ id: "op-1", command: { program: "git", args: ["status"], cwd: "/repo" } }),
      makeOp({ id: "op-2", sequenceIndex: 1, command: { program: "git", args: ["log", "-n", "5"], cwd: "/repo" } }),
    ];
    const report = checker.analyze("plan-1", ops, makeState());

    expect(report.overallRisk).toBe("safe");
    expect(report.blockedOperationIds).toHaveLength(0);
    expect(report.requiresManualReview).toBe(false);
  });

  it("identifies destructive operation and sets overallRisk to destructive", () => {
    const ops = [
      makeOp({
        id: "op-1",
        riskLevel: "destructive",
        command: { program: "git", args: ["reset", "--hard", "HEAD~1"], cwd: "/repo" },
      }),
    ];
    const report = checker.analyze("plan-2", ops, makeState());

    expect(report.overallRisk).toBe("destructive");
    expect(report.requiresManualReview).toBe(true);
    expect(report.findings.some((f) => f.code === "HARD_RESET")).toBe(true);
  });

  it("flags uncommitted changes when running branch switch / rebase", () => {
    const ops = [
      makeOp({
        id: "op-1",
        riskLevel: "reversible",
        command: { program: "git", args: ["checkout", "feature"], cwd: "/repo" },
      }),
    ];
    const dirtyState = makeState({
      workingTree: {
        staged: [{ path: "src/dirty.ts", status: "Modified" }],
        unstaged: [],
        untracked: [],
        conflicts: [],
      },
    });

    const report = checker.analyze("plan-3", ops, dirtyState);
    expect(report.findings.some((f) => f.code === "UNCOMMITTED_CHANGES")).toBe(true);
  });

  it("blocks permanently blocked subcommands", () => {
    const ops = [
      makeOp({
        id: "op-blocked",
        command: { program: "git", args: ["filter-branch"], cwd: "/repo" },
      }),
    ];
    const report = checker.analyze("plan-4", ops, makeState());

    expect(report.blockedOperationIds).toContain("op-blocked");
    expect(report.findings.some((f) => f.code === "BLOCKED_COMMAND")).toBe(true);
  });
});
