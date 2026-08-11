// ─── Planner ──────────────────────────────────────────────────────────────────
// Higher-level planning module orchestrating intent parsing and plan validation.
// Includes an in-process plan registry so plans survive across LLM tool-call turns.

import { randomUUID } from "crypto";
import { parseIntent } from "./intentParser";
import { validatePlanObject } from "./planValidator";
import { bus } from "../core/eventBus";
import { logger } from "../core/logger";
import type { Plan, PlannedOperation } from "./types";

const log = logger.scope("Planner");

/**
 * In-process plan registry.
 * Keys are plan UUIDs. Survives across LLM tool-call turns within one session.
 */
const planRegistry = new Map<string, Plan>();

export class Planner {
  /**
   * Process a user intent string and validate raw plan structures received from
   * the LLM tool-calling layer.
   *
   * @param userIntent  Natural language description of what the user wants.
   * @param rawPlan     Raw object from LLM (validated by Zod inside planValidator).
   * @returns           Validated, registered Plan.
   * @throws            If Zod or business-rule validation fails.
   */
  createPlan(userIntent: string, rawPlan: unknown): Plan {
    const parsedIntent = parseIntent(userIntent);
    log.info("Creating plan", { category: parsedIntent.category, userIntent });

    const validation = validatePlanObject(rawPlan, userIntent);

    if (!validation.valid || !validation.validatedOperations) {
      log.warn("Plan validation failed", { issues: validation.issues });
      bus.emit("plan.rejected", { reason: "Validation failed", issues: validation.issues });
      throw new Error(`Plan validation failed: ${validation.issues.join("; ")}`);
    }

    const plan: Plan = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      userIntent,
      operations: validation.validatedOperations,
      status: "pending",
    };

    planRegistry.set(plan.id, plan);
    bus.emit("plan.produced", validation.validatedOperations as PlannedOperation[]);
    log.info("Plan registered", { planId: plan.id, opCount: plan.operations.length });
    return plan;
  }

  /**
   * Retrieve a registered plan by ID.
   * Returns undefined if the plan is not found (e.g., session was cleared).
   */
  getPlan(planId: string): Plan | undefined {
    return planRegistry.get(planId);
  }

  /**
   * Update a plan's execution status in the registry.
   * Called by the executor as operations succeed or fail.
   */
  updatePlanStatus(
    planId: string,
    status: Plan["status"],
  ): void {
    const plan = planRegistry.get(planId);
    if (!plan) {
      log.warn("updatePlanStatus: plan not found", { planId });
      return;
    }
    // Plan is readonly — reconstruct with updated status
    const updated: Plan = { ...plan, status };
    planRegistry.set(planId, updated);
    log.debug("Plan status updated", { planId, status });
  }

  /**
   * Clear all registered plans. Called on session reset / history clear.
   */
  clearRegistry(): void {
    planRegistry.clear();
    log.debug("Plan registry cleared");
  }

  /** List all plan IDs in the registry (for diagnostics). */
  listPlanIds(): string[] {
    return Array.from(planRegistry.keys());
  }
}
