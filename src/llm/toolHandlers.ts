// ─── Tool Handlers ────────────────────────────────────────────────────────────
// Routes validated LLM tool calls to the appropriate extension components.
// The LLM never gets direct access to these handlers — all calls go through
// schema validation first.

import { randomUUID } from "crypto";
import { PlanSchema } from "./toolDefinitions";
import { PlanValidationError, ShellInjectionAttemptError, BlockedCommandError } from "../core/errors";
import { validateArgvSafety } from "../safety/commandClassifier";
import { ALLOWED_SUBCOMMANDS, BLOCKED_SUBCOMMANDS, SHELL_METACHARACTERS } from "../safety/riskRules";
import { logger } from "../core/logger";
import type { RepositoryInspector } from "../repo/RepositoryInspector";
import type { SafetyChecker } from "../safety/SafetyChecker";
import type { CommandExecutor } from "../executor/CommandExecutor";
import type { ApprovalGate } from "../executor/approvalGate";
import type { GraphDataBuilder } from "../graph/GraphDataBuilder";
import type { PlannedOperation } from "../planner/types";

const log = logger.scope("ToolHandlers");

/** Simple in-memory plan store keyed by operation UUID. */
const planStore = new Map<string, PlannedOperation>();
const planIdByOperationId = new Map<string, string>();

export function storePlan(planId: string, operations: PlannedOperation[]): void {
  for (const op of operations) {
    planStore.set(op.id, op);
    planIdByOperationId.set(op.id, planId);
  }
}

export function getOperation(operationId: string): PlannedOperation | undefined {
  return planStore.get(operationId);
}

export interface ToolHandlerContext {
  inspector: RepositoryInspector;
  safetyChecker: SafetyChecker;
  executor: CommandExecutor;
  approvalGate: ApprovalGate;
  graphBuilder: GraphDataBuilder;
  repoPath: string;
}

export type ToolHandler = (input: unknown, ctx: ToolHandlerContext) => Promise<string>;

/** Additional validation layer applied to all LLM-produced commands. */
function validateCommandArgs(args: readonly string[], operationId: string): void {
  const subcommand = args[0];
  if (!subcommand) throw new PlanValidationError("Empty command args", ["args array is empty"]);
  if (BLOCKED_SUBCOMMANDS.has(subcommand)) {
    throw new BlockedCommandError(["git", ...args]);
  }
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new BlockedCommandError(["git", ...args]);
  }
  validateArgvSafety(args);

  // Extra: path containment check — cwd is verified by CommandExecutor
  if (args.some((a) => a.includes("..") && a.includes("/"))) {
    throw new ShellInjectionAttemptError(args.find((a) => a.includes("../")) ?? "");
  }
}

// ── Handler Implementations ───────────────────────────────────────────────────

const inspectRepoHandler: ToolHandler = async (input, ctx) => {
  const state = await ctx.inspector.getRepoState(true);
  return JSON.stringify(state);
};

const planCommandsHandler: ToolHandler = async (input, ctx) => {
  // Parse and validate against Zod schema
  const parseResult = PlanSchema.safeParse(input);
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new PlanValidationError("LLM plan failed schema validation", issues);
  }

  const { operations } = parseResult.data;

  // Additional argv safety validation for every command
  for (const op of operations) {
    validateCommandArgs(op.command.args, op.id);
    if (op.reversalCommand) {
      validateCommandArgs(op.reversalCommand.args, op.id);
    }
  }

  const planId = randomUUID();
  // Cast is safe after Zod validation
  const typedOps = operations as PlannedOperation[];
  storePlan(planId, typedOps);

  log.info("Plan stored", { planId, opCount: operations.length });
  return JSON.stringify({ planId, operationCount: operations.length, operations: typedOps });
};

const checkSafetyHandler: ToolHandler = async (input, ctx) => {
  const { planId } = input as { planId: string; operationIds?: string[] };
  const state = await ctx.inspector.getRepoState();

  // Collect all operations for this plan
  const ops: PlannedOperation[] = [];
  for (const [opId, pid] of planIdByOperationId.entries()) {
    if (pid === planId) {
      const op = planStore.get(opId);
      if (op) ops.push(op);
    }
  }

  if (ops.length === 0) return JSON.stringify({ error: "No operations found for plan", planId });

  ops.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const report = ctx.safetyChecker.analyze(planId, ops, state);
  return JSON.stringify(report);
};

const executeCommandHandler: ToolHandler = async (input, ctx) => {
  const { operationId, dry_run, approvalId } = input as {
    operationId: string;
    dry_run: boolean;
    approvalId?: string;
  };

  const op = planStore.get(operationId);
  if (!op) return JSON.stringify({ error: `Operation ${operationId} not found. Call plan_commands first.` });

  if (dry_run) {
    const preview = await ctx.executor.preview(op);
    return JSON.stringify(preview);
  }

  const state = await ctx.inspector.getRepoState();
  const result = await ctx.executor.execute(op, state, approvalId);
  ctx.inspector.invalidateCache();
  return JSON.stringify(result);
};

const explainHandler: ToolHandler = async (input, _ctx) => {
  // The 'explain' tool just returns the topic + context back for the LLM to use
  // The LLM itself generates the explanation as its response text
  const { topic, context } = input as { topic: string; context?: Record<string, unknown> };
  return JSON.stringify({ topic, context, note: "Generate a clear explanation of this topic for a developer audience." });
};

const renderGraphHandler: ToolHandler = async (input, ctx) => {
  const { highlightCommits = [], highlightBranches = [], focusSha } = input as {
    highlightCommits?: string[];
    highlightBranches?: string[];
    focusSha?: string;
  };

  const state = await ctx.inspector.getRepoState();
  const graphData = ctx.graphBuilder.build(state);

  // Graph panel is updated via event bus — the panel provider listens
  const { bus } = await import("../core/eventBus");
  bus.emit("graph.data.ready", graphData);

  return JSON.stringify({ rendered: true, nodeCount: graphData.nodes.length });
};

/** Static dispatch table — no dynamic routing via LLM-provided strings. */
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  inspect_repo: inspectRepoHandler,
  plan_commands: planCommandsHandler,
  check_safety: checkSafetyHandler,
  execute_command: executeCommandHandler,
  explain: explainHandler,
  render_graph: renderGraphHandler,
};
