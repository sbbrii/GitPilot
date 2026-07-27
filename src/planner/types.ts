// ─── Planner Types ────────────────────────────────────────────────────────────

export type RiskLevel = "safe" | "reversible" | "destructive";

export interface GitCommand {
  readonly program: "git";
  readonly args: readonly string[];
  readonly cwd: string;
  /** Minimal env overrides — GIT_EDITOR, GIT_PAGER, etc. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface PlannedOperation {
  readonly id: string; // UUID v4
  readonly sequenceIndex: number;
  readonly intent: string;
  readonly command: GitCommand;
  readonly riskLevel: RiskLevel;
  readonly riskRationale: string;
  readonly reversible: boolean;
  readonly reversalCommand: GitCommand | null;
  readonly requiresDryRun: boolean;
  readonly requiresApproval: boolean;
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
}

export interface Plan {
  readonly id: string; // UUID v4
  readonly createdAt: string; // ISO-8601
  readonly userIntent: string;
  readonly operations: readonly PlannedOperation[];
  readonly status: "pending" | "approved" | "executing" | "completed" | "failed" | "cancelled";
}
