// ─── Executor Types ───────────────────────────────────────────────────────────

export type ApprovalDecision = "pending" | "approved" | "denied";

export interface ApprovalRequest {
  readonly id: string; // UUID v4
  readonly planId: string;
  readonly operationId: string;
  readonly presentedAt: string; // ISO-8601
  readonly expiresAt: string;   // ISO-8601
  readonly dryRunOutput: string;
  readonly dryRunDiff: string | null;
  readonly riskLevel: "safe" | "reversible" | "destructive";
  readonly riskWarnings: readonly string[];
  decision: ApprovalDecision;
  resolvedAt: string | null;
  /** Only required for highest-risk commands */
  readonly requiresTypedConfirmation: boolean;
  readonly typedConfirmationPhrase: string | null;
}

export interface DryRunPreview {
  readonly operationId: string;
  readonly commandDisplay: string;
  readonly explanation: string;
  readonly diff: string | null;
  readonly stateDelta: string;
}

export interface ExecutionResult {
  readonly operationId: string;
  readonly approvalId: string;
  readonly executedAt: string;   // ISO-8601
  readonly completedAt: string;  // ISO-8601
  readonly durationMs: number;
  readonly success: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecutionError {
  readonly operationId: string;
  readonly error: string;
  readonly code: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly recoverable: boolean;
  readonly remediation: string;
}

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly command: readonly string[];
  readonly approvalId: string;
  readonly success: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
}
