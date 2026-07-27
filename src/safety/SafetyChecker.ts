// ─── Safety Checker ───────────────────────────────────────────────────────────
// Orchestrates risk classification and generates a SafetyReport for a plan.

import { randomUUID } from "crypto";
import { classifyCommand } from "./commandClassifier";
import { RISK_RULES, aggregateRiskLevel } from "./riskRules";
import { BlockedCommandError, ShellInjectionAttemptError } from "../core/errors";
import { logger } from "../core/logger";
import type { PlannedOperation, RiskLevel } from "../planner/types";
import type { RepoState } from "../repo/types";
import type { SafetyReport, SafetyFinding, RiskCode } from "./types";

const log = logger.scope("SafetyChecker");

export class SafetyChecker {
  /**
   * Analyse all operations in a plan and produce a SafetyReport.
   * This is the primary entry point — deterministic, LLM-independent.
   */
  analyze(
    planId: string,
    operations: readonly PlannedOperation[],
    repoState: RepoState,
  ): SafetyReport {
    const findings: SafetyFinding[] = [];
    const blockedOperationIds: string[] = [];
    const riskLevels: RiskLevel[] = [];

    // Add repo-state-derived findings first (merge in progress, etc.)
    this.addRepoStateFindings(planId, repoState, findings, operations, blockedOperationIds);

    for (const op of operations) {
      try {
        const classification = classifyCommand(op.command.args);
        riskLevels.push(classification.riskLevel);

        for (const code of classification.riskCodes) {
          const rule = RISK_RULES.get(code);
          if (!rule) continue;
          findings.push({
            operationId: op.id,
            severity: rule.defaultSeverity,
            code,
            message: rule.description,
            recommendation: rule.recommendation,
          });
          if (rule.blocking) blockedOperationIds.push(op.id);
        }

        // If op-level riskLevel was overridden by LLM to lower than what we classify, upgrade it
        if (
          (classification.riskLevel === "destructive" && op.riskLevel !== "destructive") ||
          (classification.riskLevel === "reversible" && op.riskLevel === "safe")
        ) {
          log.warn("LLM risk classification was upgraded by static classifier", {
            op: op.id,
            llmRisk: op.riskLevel,
            staticRisk: classification.riskLevel,
          });
          findings.push({
            operationId: op.id,
            severity: "warning",
            code: "HISTORY_REWRITE", // reuse closest applicable code
            message: `LLM classified this as '${op.riskLevel}' but static analysis determined '${classification.riskLevel}'.`,
            recommendation: "Trust the static classification — it is authoritative.",
          });
        }
      } catch (e) {
        if (e instanceof BlockedCommandError || e instanceof ShellInjectionAttemptError) {
          log.error("Blocked command in plan", { op: op.id, error: e.message });
          blockedOperationIds.push(op.id);
          const code: RiskCode = e instanceof ShellInjectionAttemptError ? "BLOCKED_COMMAND" : "BLOCKED_COMMAND";
          const rule = RISK_RULES.get("BLOCKED_COMMAND")!;
          findings.push({
            operationId: op.id,
            severity: "critical",
            code,
            message: e.message,
            recommendation: rule.recommendation,
          });
          riskLevels.push("destructive");
        } else {
          throw e;
        }
      }
    }

    // Check for uncommitted changes if any write ops are planned
    const hasWriteOps = operations.some((op) => {
      try {
        const cl = classifyCommand(op.command.args);
        return cl.riskLevel !== "safe";
      } catch { return false; }
    });

    if (hasWriteOps && (repoState.workingTree.staged.length > 0 || repoState.workingTree.unstaged.length > 0)) {
      const rule = RISK_RULES.get("UNCOMMITTED_CHANGES")!;
      findings.push({
        operationId: operations[0]?.id ?? planId,
        severity: rule.defaultSeverity,
        code: "UNCOMMITTED_CHANGES",
        message: rule.description,
        recommendation: rule.recommendation,
      });
    }

    // Check for diverged remote
    const currentBranch = repoState.branches.find((b) => b.isCurrentBranch);
    if (currentBranch && currentBranch.behindCount > 0 && hasWriteOps) {
      const rule = RISK_RULES.get("DIVERGED_REMOTE")!;
      findings.push({
        operationId: operations[0]?.id ?? planId,
        severity: rule.defaultSeverity,
        code: "DIVERGED_REMOTE",
        message: `Your branch '${currentBranch.name}' is ${currentBranch.behindCount} commit(s) behind '${currentBranch.upstream}'.`,
        recommendation: rule.recommendation,
      });
    }

    const overallRisk = aggregateRiskLevel(riskLevels.length > 0 ? riskLevels : ["safe"]);
    const hasCritical = findings.some((f) => f.severity === "critical");

    return {
      planId,
      generatedAt: new Date().toISOString(),
      overallRisk,
      findings,
      blockedOperationIds,
      requiresManualReview: hasCritical,
    };
  }

  private addRepoStateFindings(
    planId: string,
    state: RepoState,
    findings: SafetyFinding[],
    operations: readonly PlannedOperation[],
    blockedIds: string[],
  ): void {
    if (!state.mergeState.inProgress) return;

    const type = state.mergeState.type;
    const code: RiskCode = type === "cherry-pick" ? "CHERRY_PICK_IN_PROGRESS" : "MERGE_IN_PROGRESS";
    const rule = RISK_RULES.get(code);
    if (!rule) return;

    // Block all ops that aren't --continue or --abort
    for (const op of operations) {
      const isControlOp = op.command.args.includes("--continue") || op.command.args.includes("--abort");
      if (!isControlOp) {
        blockedIds.push(op.id);
        findings.push({
          operationId: op.id,
          severity: "critical",
          code,
          message: rule.description,
          recommendation: rule.recommendation,
        });
      }
    }
  }
}
