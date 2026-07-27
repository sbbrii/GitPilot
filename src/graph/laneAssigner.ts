// ─── Lane Assigner ────────────────────────────────────────────────────────────
// Assigns visual lanes to commits for the DAG graph renderer.
// Pure functions — fully unit-testable.

import type { CommitSummary } from "../repo/types";
import type { GraphNode, GraphEdge } from "./types";

const LANE_COLORS = [
  "#58a6ff", // blue
  "#3fb950", // green
  "#f78166", // red
  "#d2a8ff", // purple
  "#ffa657", // orange
  "#79c0ff", // light blue
  "#56d364", // light green
  "#ff7b72", // coral
  "#bc8cff", // violet
  "#ffb77c", // peach
];

export function getLaneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] ?? "#58a6ff";
}

export interface LaneAssignment {
  sha: string;
  lane: number;
}

/**
 * Topologically sort commits (newest first) and assign visual lanes.
 * Uses a greedy lane-packing algorithm:
 *  - Each branch starts in the first available lane.
 *  - Lanes are freed when a branch merges into another.
 *
 * Pure function — returns a Map<sha, lane>.
 */
export function assignLanes(
  commits: readonly CommitSummary[],
): Map<string, number> {
  const laneMap = new Map<string, number>();
  // activeLanes[lane] = the SHA currently "occupying" that lane
  const activeLanes: Array<string | null> = [];

  function findOrAllocateLane(sha: string): number {
    // Check if this SHA is already assigned a lane
    if (laneMap.has(sha)) return laneMap.get(sha)!;
    // Find first free lane
    const free = activeLanes.findIndex((s) => s === null);
    const lane = free >= 0 ? free : activeLanes.length;
    activeLanes[lane] = sha;
    laneMap.set(sha, lane);
    return lane;
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]!;

    // Allocate lane for this commit
    const lane = findOrAllocateLane(commit.sha);
    activeLanes[lane] = commit.sha;

    // Handle parents
    if (commit.parentShas.length === 0) {
      // Root commit — free its lane
      activeLanes[lane] = null;
    } else if (commit.parentShas.length === 1) {
      // Linear — pass lane to parent
      const parentSha = commit.parentShas[0]!;
      if (!laneMap.has(parentSha)) {
        laneMap.set(parentSha, lane);
        activeLanes[lane] = parentSha;
      } else {
        // Parent already has a lane — free current lane
        activeLanes[lane] = null;
      }
    } else {
      // Merge commit — first parent continues the current lane, others get new lanes
      const firstParent = commit.parentShas[0]!;
      if (!laneMap.has(firstParent)) {
        laneMap.set(firstParent, lane);
        activeLanes[lane] = firstParent;
      }

      for (const parent of commit.parentShas.slice(1)) {
        if (!laneMap.has(parent)) {
          const newLane = findOrAllocateLane(parent);
          laneMap.set(parent, newLane);
          activeLanes[newLane] = parent;
        }
      }
    }
  }

  return laneMap;
}

/**
 * Build GraphEdge list from commit parent relationships and lane assignments.
 * Pure function.
 */
export function buildEdges(
  commits: readonly CommitSummary[],
  laneMap: Map<string, number>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const shaIndex = new Map<string, number>(commits.map((c, i) => [c.sha, i]));

  for (const commit of commits) {
    for (const parentSha of commit.parentShas) {
      const fromLane = laneMap.get(commit.sha) ?? 0;
      const toLane = laneMap.get(parentSha) ?? fromLane;
      edges.push({
        fromSha: commit.sha,
        toSha: parentSha,
        lane: fromLane,
        color: getLaneColor(fromLane),
      });
    }
  }

  return edges;
}
