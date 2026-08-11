// ─── Plan Validator ───────────────────────────────────────────────────────────
// Validates LLM-produced plans against Zod schemas, business rules, and security policies.
// Pure functions — fully unit-testable.

import { PlanSchema, type ValidatedPlannedOperation } from "../llm/toolDefinitions";
import { PlanValidationError, ShellInjectionAttemptError, BlockedCommandError } from "../core/errors";
import { ALLOWED_SUBCOMMANDS, BLOCKED_SUBCOMMANDS, SHELL_METACHARACTERS } from "../safety/riskRules";
import type { PlannedOperation, Plan } from "./types";
import { randomUUID } from "crypto";

export interface PlanValidationResult {
  valid: boolean;
  issues: string[];
  validatedOperations?: PlannedOperation[];
}

/**
 * Validates a plan raw object emitted from the LLM tool-calling layer.
 * Enforces Zod schema correctness, program allowlisting ('git'), and metacharacter checks.
 */
export function validatePlanObject(rawPlan: unknown, userIntent: string): PlanValidationResult {
  const issues: string[] = [];

  const parseResult = PlanSchema.safeParse(rawPlan);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      issues.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { valid: false, issues };
  }

  const { operations } = parseResult.data;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]!;
    validateSingleOperation(op, i, issues);
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  const typedOps: PlannedOperation[] = operations.map((op) => ({
    id: op.id,
    sequenceIndex: op.sequenceIndex,
    intent: op.intent,
    command: {
      program: op.command.program,
      args: op.command.args,
      cwd: op.command.cwd,
      ...(op.command.env ? { env: op.command.env } : {}),
    },
    riskLevel: op.riskLevel,
    riskRationale: op.riskRationale,
    reversible: op.reversible,
    reversalCommand: op.reversalCommand
      ? {
          program: op.reversalCommand.program,
          args: op.reversalCommand.args,
          cwd: op.reversalCommand.cwd,
          ...(op.reversalCommand.env ? { env: op.reversalCommand.env } : {}),
        }
      : null,
    requiresDryRun: op.requiresDryRun,
    requiresApproval: op.requiresApproval,
    preconditions: op.preconditions,
    postconditions: op.postconditions,
  }));

  return {
    valid: true,
    issues: [],
    validatedOperations: typedOps,
  };
}

function validateSingleOperation(op: ValidatedPlannedOperation, index: number, issues: string[]): void {
  if (op.command.program !== "git") {
    issues.push(`Op #${index}: Program must be 'git', got '${op.command.program}'`);
  }

  const subcommand = op.command.args[0];
  if (!subcommand) {
    issues.push(`Op #${index}: Missing git subcommand`);
    return;
  }

  if (BLOCKED_SUBCOMMANDS.has(subcommand)) {
    issues.push(`Op #${index}: Subcommand '${subcommand}' is permanently blocked`);
  } else if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    issues.push(`Op #${index}: Subcommand '${subcommand}' is not in the allowed command set`);
  }

  for (const arg of op.command.args) {
    if (SHELL_METACHARACTERS.test(arg)) {
      issues.push(`Op #${index}: Argument contains dangerous metacharacters: '${arg}'`);
    }
  }

  if (op.reversalCommand) {
    if (op.reversalCommand.program !== "git") {
      issues.push(`Op #${index} (reversal): Program must be 'git'`);
    }
    for (const arg of op.reversalCommand.args) {
      if (SHELL_METACHARACTERS.test(arg)) {
        issues.push(`Op #${index} (reversal): Argument contains dangerous metacharacters: '${arg}'`);
      }
    }
  }
}

/** Assert plan validity or throw PlanValidationError. */
export function assertPlanValid(rawPlan: unknown, userIntent: string): PlannedOperation[] {
  const res = validatePlanObject(rawPlan, userIntent);
  if (!res.valid || !res.validatedOperations) {
    throw new PlanValidationError("Plan validation failed", res.issues);
  }
  return res.validatedOperations;
}
