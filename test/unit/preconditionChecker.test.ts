// ─── Precondition Checker Unit Tests ─────────────────────────────────────────
// Tests for checkPreconditions against various RepoState configurations.
// All pure functions — no I/O.

import { describe, it, expect } from "vitest";
import { checkPreconditions } from "../../src/safety/preconditionChecker";
import type { PlannedOperation } from "../../src/planner/types";
import type { RepoState } from "../../src/repo/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("checkPreconditions — merge in progress", () => {
  it("blocks non-continue/abort commands when merge in progress", () => {
    const state = makeState({
      mergeState: { inProgress: true, type: "merge", conflictedFiles: ["src/a.ts"] },
    });
    const result = checkPreconditions(makeOp(), state);
    expect(result.satisfied).toBe(false);
    expect(result.failedCondition).toMatch(/merge.*in progress/i);
  });

  it("allows --continue when merge in progress", () => {
    const state = makeState({
      mergeState: { inProgress: true, type: "merge", conflictedFiles: [] },
    });
    const op = makeOp({ command: { program: "git", args: ["merge", "--continue"], cwd: "/repo" } });
    const result = checkPreconditions(op, state);
    expect(result.satisfied).toBe(true);
  });

  it("allows --abort when merge in progress", () => {
    const state = makeState({
      mergeState: { inProgress: true, type: "merge", conflictedFiles: [] },
    });
    const op = makeOp({ command: { program: "git", args: ["merge", "--abort"], cwd: "/repo" } });
    const result = checkPreconditions(op, state);
    expect(result.satisfied).toBe(true);
  });
});

describe("checkPreconditions — clean working tree", () => {
  it("fails when staged changes present", () => {
    const state = makeState({
      workingTree: {
        staged: [{ path: "src/a.ts", status: "Modified" }],
        unstaged: [],
        untracked: [],
        conflicts: [],
      },
    });
    const op = makeOp({ preconditions: ["clean working tree"] });
    const result = checkPreconditions(op, state);
    expect(result.satisfied).toBe(false);
    expect(result.remediation).toMatch(/stash/i);
  });

  it("fails when unstaged changes present", () => {
    const state = makeState({
      workingTree: {
        staged: [],
        unstaged: [{ path: "src/b.ts", status: "Modified" }],
        untracked: [],
        conflicts: [],
      },
    });
    const op = makeOp({ preconditions: ["clean working tree"] });
    expect(checkPreconditions(op, state).satisfied).toBe(false);
  });

  it("passes when working tree is clean", () => {
    const state = makeState();
    const op = makeOp({ preconditions: ["clean working tree"] });
    expect(checkPreconditions(op, state).satisfied).toBe(true);
  });
});

describe("checkPreconditions — on branch", () => {
  it("fails when on wrong branch", () => {
    const state = makeState({ head: { branch: "develop", sha: "b".repeat(40), shortSha: "bbbbbbb", isDetached: false, message: "Fix" } });
    const op = makeOp({ preconditions: ["on branch main"] });
    const result = checkPreconditions(op, state);
    expect(result.satisfied).toBe(false);
    expect(result.failedCondition).toMatch(/main/);
  });

  it("passes when on correct branch", () => {
    const state = makeState();
    const op = makeOp({ preconditions: ["on branch main"] });
    expect(checkPreconditions(op, state).satisfied).toBe(true);
  });
});

describe("checkPreconditions — not detached", () => {
  it("fails when HEAD is detached", () => {
    const state = makeState({
      head: { branch: null, sha: "c".repeat(40), shortSha: "ccccccc", isDetached: true, message: "tag commit" },
    });
    const op = makeOp({ preconditions: ["not detached"] });
    const result = checkPreconditions(op, state);
    expect(result.satisfied).toBe(false);
    expect(result.remediation).toMatch(/switch/i);
  });
});

describe("checkPreconditions — no conflicts", () => {
  it("fails when conflicts present", () => {
    const state = makeState({
      workingTree: { staged: [], unstaged: [], untracked: [], conflicts: ["src/conflict.ts"] },
    });
    const op = makeOp({ preconditions: ["no conflicts"] });
    expect(checkPreconditions(op, state).satisfied).toBe(false);
  });
});

describe("checkPreconditions — remote configured", () => {
  it("fails when no remotes configured", () => {
    const state = makeState({ remotes: [] });
    const op = makeOp({ preconditions: ["remote configured"] });
    expect(checkPreconditions(op, state).satisfied).toBe(false);
  });

  it("passes when remote is configured", () => {
    const state = makeState({
      remotes: [{ name: "origin", fetchUrl: "https://github.com/u/r.git", pushUrl: "https://github.com/u/r.git" }],
    });
    const op = makeOp({ preconditions: ["remote configured"] });
    expect(checkPreconditions(op, state).satisfied).toBe(true);
  });
});

describe("checkPreconditions — no preconditions", () => {
  it("always satisfies when preconditions list is empty", () => {
    const state = makeState();
    const op = makeOp({ preconditions: [] });
    expect(checkPreconditions(op, state).satisfied).toBe(true);
  });
});
