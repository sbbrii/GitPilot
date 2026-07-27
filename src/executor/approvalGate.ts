// ─── Approval Gate ────────────────────────────────────────────────────────────
// Manages the lifecycle of approval requests: creation, resolution, and expiry.

import { randomUUID } from "crypto";
import { bus } from "../core/eventBus";
import { config } from "../core/config";
import { ApprovalRequiredError, ApprovalExpiredError } from "../core/errors";
import { logger } from "../core/logger";
import type { ApprovalRequest, DryRunPreview } from "./types";
import type { PlannedOperation } from "../planner/types";
import type { SafetyReport } from "../safety/types";

const log = logger.scope("ApprovalGate");

export class ApprovalGate {
  private readonly store = new Map<string, ApprovalRequest>();

  /**
   * Create a new ApprovalRequest for an operation.
   * Publishes approval.requested event for the UI to pick up.
   */
  createRequest(
    op: PlannedOperation,
    planId: string,
    preview: DryRunPreview,
    report: SafetyReport,
  ): ApprovalRequest {
    const now = Date.now();
    const expiryMs = config.approvalExpiryMs;

    const warnings = report.findings
      .filter((f) => f.operationId === op.id && (f.severity === "warning" || f.severity === "critical"))
      .map((f) => f.message);

    const requiresTyped = op.riskLevel === "destructive";

    const request: ApprovalRequest = {
      id: randomUUID(),
      planId,
      operationId: op.id,
      presentedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + expiryMs).toISOString(),
      dryRunOutput: preview.stateDelta,
      dryRunDiff: preview.diff,
      riskLevel: op.riskLevel,
      riskWarnings: warnings,
      decision: "pending",
      resolvedAt: null,
      requiresTypedConfirmation: requiresTyped,
      typedConfirmationPhrase: requiresTyped ? `git ${op.command.args.slice(0, 2).join(" ")}` : null,
    };

    this.store.set(request.id, request);
    log.info("Approval requested", { approvalId: request.id, operationId: op.id, risk: op.riskLevel });
    bus.emit("approval.requested", request);
    return request;
  }

  grant(approvalId: string, typedPhrase?: string): void {
    const request = this.getActiveRequest(approvalId);
    if (request.requiresTypedConfirmation && request.typedConfirmationPhrase) {
      if (typedPhrase?.trim() !== request.typedConfirmationPhrase) {
        throw new Error(
          `Typed confirmation mismatch. Expected: "${request.typedConfirmationPhrase}"`,
        );
      }
    }
    request.decision = "approved";
    request.resolvedAt = new Date().toISOString();
    log.info("Approval granted", { approvalId });
    bus.emit("approval.granted", request);
  }

  deny(approvalId: string): void {
    const request = this.getActiveRequest(approvalId);
    request.decision = "denied";
    request.resolvedAt = new Date().toISOString();
    log.info("Approval denied", { approvalId });
    bus.emit("approval.denied", request);
  }

  /**
   * Verify that a valid, non-expired approval exists for an operation.
   * Throws ApprovalRequiredError or ApprovalExpiredError if not.
   */
  assertApproved(operationId: string): ApprovalRequest {
    const request = [...this.store.values()].find(
      (r) => r.operationId === operationId && r.decision === "approved",
    );

    if (!request) throw new ApprovalRequiredError(operationId);
    if (new Date(request.expiresAt) < new Date()) {
      request.decision = "pending";
      bus.emit("approval.expired", request);
      throw new ApprovalExpiredError(request.id);
    }

    return request;
  }

  private getActiveRequest(approvalId: string): ApprovalRequest {
    const request = this.store.get(approvalId);
    if (!request) throw new Error(`Approval ${approvalId} not found`);
    if (request.decision !== "pending") throw new Error(`Approval ${approvalId} already resolved as ${request.decision}`);
    if (new Date(request.expiresAt) < new Date()) {
      bus.emit("approval.expired", request);
      throw new ApprovalExpiredError(approvalId);
    }
    return request;
  }

  purgeExpired(): void {
    const now = new Date();
    for (const [id, request] of this.store.entries()) {
      if (new Date(request.expiresAt) < now && request.decision === "pending") {
        request.decision = "pending"; // stays pending but is effectively expired
        this.store.delete(id);
      }
    }
  }
}
