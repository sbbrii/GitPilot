// ─── Core Error Types ─────────────────────────────────────────────────────────

export class GitCopilotError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GitCopilotError";
  }
}

export class NotAGitRepositoryError extends GitCopilotError {
  constructor(path: string) {
    super(`Path is not a git repository: ${path}`, "NOT_A_GIT_REPO");
  }
}

export class GitCommandError extends GitCopilotError {
  constructor(
    public readonly command: string[],
    public readonly exitCode: number,
    public readonly stderr: string,
    cause?: unknown,
  ) {
    super(
      `Git command failed (exit ${exitCode}): ${command.join(" ")}\n${stderr}`,
      "GIT_COMMAND_FAILED",
      cause,
    );
  }
}

export class GitCommandTimedOutError extends GitCopilotError {
  constructor(command: string[], timeoutMs: number) {
    super(
      `Git command timed out after ${timeoutMs}ms: ${command.join(" ")}`,
      "GIT_COMMAND_TIMEOUT",
    );
  }
}

export class PlanValidationError extends GitCopilotError {
  constructor(
    message: string,
    public readonly validationIssues: string[],
  ) {
    super(`Plan validation failed: ${message}`, "PLAN_VALIDATION_FAILED");
  }
}

export class ApprovalRequiredError extends GitCopilotError {
  constructor(operationId: string) {
    super(
      `Operation ${operationId} requires user approval before execution`,
      "APPROVAL_REQUIRED",
    );
  }
}

export class ApprovalExpiredError extends GitCopilotError {
  constructor(approvalId: string) {
    super(`Approval ${approvalId} has expired`, "APPROVAL_EXPIRED");
  }
}

export class BlockedCommandError extends GitCopilotError {
  constructor(command: string[]) {
    super(
      `Command is permanently blocked and cannot be executed: ${command.join(" ")}`,
      "COMMAND_BLOCKED",
    );
  }
}

export class PreconditionFailedError extends GitCopilotError {
  constructor(
    public readonly precondition: string,
    public readonly remediation: string,
  ) {
    super(`Precondition failed: ${precondition}`, "PRECONDITION_FAILED");
  }
}

export class LLMError extends GitCopilotError {
  constructor(message: string, cause?: unknown) {
    super(message, "LLM_ERROR", cause);
  }
}

export class ShellInjectionAttemptError extends GitCopilotError {
  constructor(offendingArg: string) {
    super(
      `Shell metacharacter detected in command argument: ${offendingArg}`,
      "SHELL_INJECTION_ATTEMPT",
    );
  }
}

/** Narrow an unknown catch value into an Error instance. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(String(value));
}
