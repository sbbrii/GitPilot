// ─── Graph Types ──────────────────────────────────────────────────────────────

export interface GraphNode {
  readonly sha: string;
  readonly shortSha: string;
  readonly message: string;
  readonly author: string;
  readonly timestamp: string;
  readonly lane: number;
  readonly y: number; // Topological index (0 = newest)
  readonly branchLabels: readonly string[];
  readonly tagLabels: readonly string[];
  readonly isHead: boolean;
  readonly isMerge: boolean;
}

export interface GraphEdge {
  readonly fromSha: string;
  readonly toSha: string;
  /** Visual lane the edge travels through */
  readonly lane: number;
  readonly color: string;
}

export interface CommitGraphData {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly laneCount: number;
  readonly branchColors: Readonly<Record<string, string>>;
  readonly generatedAt: string;
}
