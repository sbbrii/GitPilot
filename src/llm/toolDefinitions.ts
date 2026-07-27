// ─── Zod Schemas + Tool Definitions ──────────────────────────────────────────
// All LLM tool inputs are validated against Zod schemas before any action.
// Tool definitions are typed for use with the Anthropic SDK.

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

// ── Zod Schemas ───────────────────────────────────────────────────────────────

/** Validates a single git command argv. */
export const GitCommandSchema = z.object({
  program: z.literal("git"),
  args: z
    .array(z.string().min(1).max(256))
    .min(1)
    .max(32)
    .describe("Argv array for git command. NO shell strings — args only."),
  cwd: z.string().min(1).describe("Working directory for the command"),
  env: z.record(z.string()).optional().describe("Optional env overrides"),
});

/** Validates a single PlannedOperation as produced by the LLM. */
export const PlannedOperationSchema = z.object({
  id: z.string().uuid(),
  sequenceIndex: z.number().int().min(0),
  intent: z.string().min(1).max(500),
  command: GitCommandSchema,
  riskLevel: z.enum(["safe", "reversible", "destructive"]),
  riskRationale: z.string().min(1),
  reversible: z.boolean(),
  reversalCommand: GitCommandSchema.nullable(),
  requiresDryRun: z.boolean(),
  requiresApproval: z.boolean(),
  preconditions: z.array(z.string()),
  postconditions: z.array(z.string()),
});

export type ValidatedPlannedOperation = z.infer<typeof PlannedOperationSchema>;

export const PlanSchema = z.object({
  operations: z.array(PlannedOperationSchema).min(1).max(20),
});

// ── Tool Schemas for Anthropic (JSON Schema format) ───────────────────────────

const gitCommandInputSchema = {
  type: "object" as const,
  properties: {
    program: { type: "string", enum: ["git"] },
    args: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 256 },
      minItems: 1,
      maxItems: 32,
      description: "ARGV array. Never shell strings. No metacharacters.",
    },
    cwd: { type: "string", description: "Working directory absolute path" },
    env: { type: "object", additionalProperties: { type: "string" }, description: "Optional env overrides" },
  },
  required: ["program", "args", "cwd"],
};

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "inspect_repo",
    description:
      "Retrieve the current repository state. Use this to understand the current branches, HEAD, working tree, stash, remotes, and recent commit history before planning any operations.",
    input_schema: {
      type: "object",
      properties: {
        includeCommitLog: { type: "boolean", description: "Whether to include recent commit log", default: true },
        commitLogDepth: { type: "integer", minimum: 1, maximum: 500, description: "How many commits to include", default: 50 },
      },
      required: [],
    },
  },
  {
    name: "plan_commands",
    description:
      "Generate an ordered sequence of git operations to achieve the user's intent. Each operation must have a clear rationale, risk classification, and reversibility flag. The program field must always be 'git'. Args must be an argv array — never shell strings.",
    input_schema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "The user's natural language intent" },
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "UUID v4" },
              sequenceIndex: { type: "integer", minimum: 0 },
              intent: { type: "string", description: "What this specific step achieves" },
              command: gitCommandInputSchema,
              riskLevel: { type: "string", enum: ["safe", "reversible", "destructive"] },
              riskRationale: { type: "string" },
              reversible: { type: "boolean" },
              reversalCommand: { ...gitCommandInputSchema, nullable: true },
              requiresDryRun: { type: "boolean" },
              requiresApproval: { type: "boolean" },
              preconditions: { type: "array", items: { type: "string" } },
              postconditions: { type: "array", items: { type: "string" } },
            },
            required: ["id", "sequenceIndex", "intent", "command", "riskLevel", "riskRationale", "reversible", "reversalCommand", "requiresDryRun", "requiresApproval", "preconditions", "postconditions"],
          },
          minItems: 1,
          maxItems: 20,
        },
      },
      required: ["intent", "operations"],
    },
  },
  {
    name: "check_safety",
    description:
      "Analyse a list of planned operations for risk. Returns a SafetyReport with findings and recommendations. Always call this after plan_commands and before execute_command.",
    input_schema: {
      type: "object",
      properties: {
        planId: { type: "string", description: "The ID of the plan being checked" },
        operationIds: { type: "array", items: { type: "string" }, description: "List of operation IDs to check" },
      },
      required: ["planId"],
    },
  },
  {
    name: "execute_command",
    description:
      "Execute a single approved PlannedOperation. For write operations: call with dry_run=true first to generate a preview, show it to the user, get approval, then call again with dry_run=false and the approvalId. Safe/read-only operations can use dry_run=false directly.",
    input_schema: {
      type: "object",
      properties: {
        operationId: { type: "string", description: "The ID of the PlannedOperation to execute" },
        dry_run: { type: "boolean", description: "If true, generate a preview without executing" },
        approvalId: { type: "string", description: "Required when dry_run=false for non-safe operations" },
      },
      required: ["operationId", "dry_run"],
    },
  },
  {
    name: "explain",
    description:
      "Generate a human-readable explanation of a git concept, command, result, or error. Use this to explain planned operations to the user and to answer follow-up questions.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What to explain" },
        context: {
          type: "object",
          properties: {
            operationId: { type: "string" },
            error: { type: "string" },
            additionalContext: { type: "string" },
          },
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "render_graph",
    description:
      "Refresh the commit graph webview. Optionally highlight specific commits or branches after an operation.",
    input_schema: {
      type: "object",
      properties: {
        highlightCommits: { type: "array", items: { type: "string" }, description: "SHAs to highlight" },
        highlightBranches: { type: "array", items: { type: "string" }, description: "Branch names to highlight" },
        focusSha: { type: "string", description: "SHA to scroll the graph to" },
      },
      required: [],
    },
  },
];
