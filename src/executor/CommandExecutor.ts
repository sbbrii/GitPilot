// ─── Command Executor ─────────────────────────────────────────────────────────
// Executes approved PlannedOperations via child_process.spawn with full
// safety enforcement, streaming, and error handling.

import * as cp from "child_process";
import { randomUUID } from "crypto";
import { bus } from "../core/eventBus";
import { logger } from "../core/logger";
import { config } from "../core/config";
import {
  GitCommandError,
  GitCommandTimedOutError,
  BlockedCommandError,
  ShellInjectionAttemptError,
} from "../core/errors";
import { classifyCommand, validateArgvSafety } from "../safety/commandClassifier";
import { assertPreconditions } from "../safety/preconditionChecker";
import { generateDryRunPreview } from "./dryRunEngine";
import { ApprovalGate } from "./approvalGate";
import { AuditLogger } from "./auditLogger";
import type { PlannedOperation } from "../planner/types";
import type { RepoState } from "../repo/types";
import type { ExecutionResult, ExecutionError, DryRunPreview } from "./types";

const log = logger.scope("CommandExecutor");

/** Minimal env that prevents git from blocking on prompts. */
function safeGitEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
    GIT_EDITOR: "true",
    GIT_PAGER: "cat",
    LANG: "C",
    ...overrides,
  };
}

export class CommandExecutor {
  constructor(
    private readonly approvalGate: ApprovalGate,
    private readonly auditLogger: AuditLogger,
  ) {}

  /** Generate a dry-run preview without executing. Always safe to call. */
  async preview(op: PlannedOperation): Promise<DryRunPreview> {
    validateArgvSafety(op.command.args); // throws on shell injection attempt
    return generateDryRunPreview(op);
  }

  /**
   * Execute an approved PlannedOperation.
   *
   * Safety gates enforced (in order):
   *   1. Argv safety validation (no shell metacharacters)
   *   2. Command classifier re-check (defence in depth)
   *   3. Precondition validation against live RepoState
   *   4. Approval assertion (valid, non-expired approval must exist)
   *   5. Spawn with shell:false, timeout, argv-only
   */
  async execute(
    op: PlannedOperation,
    repoState: RepoState,
    approvalId?: string,
  ): Promise<ExecutionResult> {
    // Gate 1: Argv safety
    validateArgvSafety(op.command.args);

    // Gate 2: Re-classify (defence in depth — LLM cannot bypass this)
    const classification = classifyCommand(op.command.args);

    // Gate 3: Preconditions
    assertPreconditions(op, repoState);

    // Gate 4: Approval (safe/read-only ops bypass approval requirement)
    let resolvedApprovalId = approvalId ?? `auto-${randomUUID()}`;
    if (classification.requiresApproval) {
      if (!approvalId) {
        throw new Error(`Operation ${op.id} requires explicit approval before execution`);
      }
      this.approvalGate.assertApproved(op.id);
    }

    // Gate 5: Execute
    const startTime = Date.now();
    log.info("Executing git command", { args: op.command.args, operationId: op.id });
    bus.emit("command.started", { operationId: op.id, command: ["git", ...op.command.args] });

    let stdout = "";
    let stderr = "";
    let exitCode = -1;
    let timedOut = false;

    try {
      const result = await this.spawn(op, (chunk, type) => {
        if (type === "stdout") {
          stdout += chunk;
          bus.emit("command.stdout", { operationId: op.id, chunk });
        } else {
          stderr += chunk;
          bus.emit("command.stderr", { operationId: op.id, chunk });
        }
      });
      exitCode = result.exitCode;
    } catch (e) {
      if (e instanceof GitCommandTimedOutError) timedOut = true;
      const endTime = Date.now();
      const error: ExecutionError = {
        operationId: op.id,
        error: e instanceof Error ? e.message : String(e),
        code: timedOut ? "GIT_COMMAND_TIMEOUT" : "GIT_COMMAND_FAILED",
        stdout,
        stderr,
        exitCode: -1,
        recoverable: op.reversalCommand !== null,
        remediation: op.reversalCommand
          ? `Run: git ${op.reversalCommand.args.join(" ")}`
          : "Check git status for current state.",
      };
      bus.emit("command.failed", error);
      throw e;
    }

    const endTime = Date.now();
    const success = exitCode === 0;

    const executionResult: ExecutionResult = {
      operationId: op.id,
      approvalId: resolvedApprovalId,
      executedAt: new Date(startTime).toISOString(),
      completedAt: new Date(endTime).toISOString(),
      durationMs: endTime - startTime,
      success,
      exitCode,
      stdout,
      stderr,
    };

    this.auditLogger.record(executionResult, ["git", ...op.command.args]);

    if (!success) {
      const error: ExecutionError = {
        operationId: op.id,
        error: `git ${op.command.args[0]} exited with code ${exitCode}`,
        code: "GIT_COMMAND_FAILED",
        stdout,
        stderr,
        exitCode,
        recoverable: op.reversalCommand !== null,
        remediation: this.generateRemediation(op, stderr),
      };
      bus.emit("command.failed", error);
      throw new GitCommandError(["git", ...op.command.args], exitCode, stderr);
    }

    log.info("Command executed successfully", { operationId: op.id, durationMs: endTime - startTime });
    bus.emit("command.executed", executionResult);
    return executionResult;
  }

  private spawn(
    op: PlannedOperation,
    onData: (chunk: string, type: "stdout" | "stderr") => void,
  ): Promise<{ exitCode: number }> {
    const timeoutMs = op.command.args.includes("push") || op.command.args.includes("fetch")
      ? 120_000
      : config.executorTimeoutMs;

    return new Promise((resolve, reject) => {
      let timedOut = false;
      const proc = cp.spawn("git", op.command.args as string[], {
        cwd: op.command.cwd,
        env: safeGitEnv(op.command.env as Record<string, string> ?? {}),
        shell: false, // ← ABSOLUTE invariant, never change
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        reject(new GitCommandTimedOutError(["git", ...op.command.args], timeoutMs));
      }, timeoutMs);

      proc.stdout.on("data", (chunk: Buffer) => onData(chunk.toString("utf8"), "stdout"));
      proc.stderr.on("data", (chunk: Buffer) => onData(chunk.toString("utf8"), "stderr"));
      proc.on("close", (code) => {
        if (timedOut) return;
        clearTimeout(timer);
        resolve({ exitCode: code ?? -1 });
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private generateRemediation(op: PlannedOperation, stderr: string): string {
    if (stderr.includes("CONFLICT")) {
      return "Merge conflicts detected. Resolve conflicts in the editor, then run: git add . && git merge --continue";
    }
    if (stderr.includes("rejected")) {
      return "Push was rejected by remote. Pull first with: git pull --rebase";
    }
    if (op.reversalCommand) {
      return `To undo: git ${op.reversalCommand.args.join(" ")}`;
    }
    return "Check git status for the current repository state.";
  }
}
