// ─── Safety Types ─────────────────────────────────────────────────────────────

export type SafetySeverity = "info" | "warning" | "critical";

export interface SafetyFinding {
  readonly operationId: string;
  readonly severity: SafetySeverity;
  /** Machine-readable code for programmatic handling */
  readonly code: string;
  readonly message: string;
  readonly recommendation: string;
}

export interface SafetyReport {
  readonly planId: string;
  readonly generatedAt: string; // ISO-8601
  readonly overallRisk: "safe" | "reversible" | "destructive";
  readonly findings: readonly SafetyFinding[];
  /** Operation IDs that must not proceed due to critical findings */
  readonly blockedOperationIds: readonly string[];
  readonly requiresManualReview: boolean;
}

export type RiskCode =
  | "HISTORY_REWRITE"
  | "FORCE_PUSH"
  | "HARD_RESET"
  | "CLEAN_UNTRACKED"
  | "BRANCH_DELETE_UNMERGED"
  | "BRANCH_DELETE_MERGED"
  | "DETACHED_HEAD_RESULT"
  | "UNCOMMITTED_CHANGES"
  | "DIVERGED_REMOTE"
  | "STASH_DROP"
  | "INTERACTIVE_REBASE"
  | "BLOCKED_COMMAND"
  | "MERGE_IN_PROGRESS"
  | "CHERRY_PICK_IN_PROGRESS";
