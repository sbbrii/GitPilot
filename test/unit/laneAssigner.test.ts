import { describe, it, expect } from "vitest";
import { assignLanes } from "../../src/graph/laneAssigner";
import type { CommitSummary } from "../../src/repo/types";

describe("laneAssigner", () => {
  it("assigns single lane for linear commit history", () => {
    const commits: CommitSummary[] = [
      {
        sha: "c3",
        shortSha: "c3",
        message: "third",
        author: { name: "A", email: "a@a.com" },
        timestamp: "2026-07-27T00:00:00Z",
        parentShas: ["c2"],
        branchLabels: ["main"],
        tagLabels: [],
        isMergeCommit: false,
      },
      {
        sha: "c2",
        shortSha: "c2",
        message: "second",
        author: { name: "A", email: "a@a.com" },
        timestamp: "2026-07-26T00:00:00Z",
        parentShas: ["c1"],
        branchLabels: [],
        tagLabels: [],
        isMergeCommit: false,
      },
      {
        sha: "c1",
        shortSha: "c1",
        message: "first",
        author: { name: "A", email: "a@a.com" },
        timestamp: "2026-07-25T00:00:00Z",
        parentShas: [],
        branchLabels: [],
        tagLabels: [],
        isMergeCommit: false,
      },
    ];

    const lanes = assignLanes(commits);
    expect(lanes.get("c3")).toBe(0);
    expect(lanes.get("c2")).toBe(0);
    expect(lanes.get("c1")).toBe(0);
  });
});
