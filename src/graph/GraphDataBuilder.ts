// ─── Graph Data Builder ───────────────────────────────────────────────────────
// Converts RepoState into CommitGraphData for D3.js rendering.

import { assignLanes, buildEdges, getLaneColor } from "./laneAssigner";
import { bus } from "../core/eventBus";
import { logger } from "../core/logger";
import type { RepoState } from "../repo/types";
import type { CommitGraphData, GraphNode } from "./types";

const log = logger.scope("GraphDataBuilder");

export class GraphDataBuilder {
  /**
   * Build a CommitGraphData from the current RepoState.
   * Deterministic — same input always produces same output.
   */
  build(state: RepoState): CommitGraphData {
    const commits = [...state.commitLog];
    const laneMap = assignLanes(commits);
    const edges = buildEdges(commits, laneMap);

    // Build branch color map
    const branchColors: Record<string, string> = {};
    for (const branch of state.branches) {
      const lane = laneMap.get(branch.sha) ?? 0;
      branchColors[branch.name] = getLaneColor(lane);
    }

    const laneValues = Array.from(laneMap.values());
    const laneCount = laneValues.length > 0 ? Math.max(...laneValues) + 1 : 1;

    const nodes: GraphNode[] = commits.map((commit, y) => ({
      sha: commit.sha,
      shortSha: commit.shortSha,
      message: commit.message,
      author: commit.author.name,
      timestamp: commit.timestamp,
      lane: laneMap.get(commit.sha) ?? 0,
      y,
      branchLabels: [...commit.branchLabels],
      tagLabels: [...commit.tagLabels],
      isHead: commit.sha === state.head.sha,
      isMerge: commit.isMergeCommit,
    }));

    const data: CommitGraphData = {
      nodes,
      edges,
      laneCount: Math.max(laneCount, 1),
      branchColors,
      generatedAt: new Date().toISOString(),
    };

    log.debug("Graph data built", { nodes: nodes.length, edges: edges.length, lanes: laneCount });
    return data;
  }
}
