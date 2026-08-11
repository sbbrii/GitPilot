// ─── Dry-Run Engine ───────────────────────────────────────────────────────────
// Generates a human-readable preview for each git command before execution.

import { spawnGit } from "../repo/RepositoryInspector";
import type { PlannedOperation } from "../planner/types";
import type { DryRunPreview } from "./types";
import { logger } from "../core/logger";

const log = logger.scope("DryRunEngine");

/**
 * Produce a dry-run preview for a planned operation.
 * Strategy differs by subcommand — each has a tailored preview approach.
 */
export async function generateDryRunPreview(
  op: PlannedOperation,
): Promise<DryRunPreview> {
  const subcommand = op.command.args[0];
  const commandDisplay = `git ${op.command.args.join(" ")}`;
  log.debug("Generating dry-run preview", { subcommand, operationId: op.id });

  try {
    switch (subcommand) {
      case "commit":
        return await commitDryRun(op, commandDisplay);
      case "push":
        return await pushDryRun(op, commandDisplay);
      case "merge":
        return await mergeDryRun(op, commandDisplay);
      case "rebase":
        return await rebaseDryRun(op, commandDisplay);
      case "reset":
        return await resetDryRun(op, commandDisplay);
      case "clean":
        return await cleanDryRun(op, commandDisplay);
      case "branch":
        return await branchDryRun(op, commandDisplay);
      case "stash":
        return await stashDryRun(op, commandDisplay);
      case "pull":
        return await pullDryRun(op, commandDisplay);
      case "checkout":
      case "switch":
        return await switchDryRun(op, commandDisplay);
      default:
        return genericPreview(op, commandDisplay);
    }
  } catch (e) {
    log.warn("Dry-run failed, using generic preview", { error: e });
    return genericPreview(op, commandDisplay);
  }
}

// ── Per-command dry-run strategies ────────────────────────────────────────────

async function commitDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  const args = [...op.command.args, "--dry-run"];
  const result = await spawnGit(args, op.command.cwd, 10_000);
  const diff = await spawnGit(["diff", "--staged", "--stat"], op.command.cwd, 10_000).catch(() => ({ stdout: "" }));
  return {
    operationId: op.id,
    commandDisplay,
    explanation: `Creates a new commit with the currently staged changes.\n\n${op.intent}`,
    diff: diff.stdout || null,
    stateDelta: result.stdout || result.stderr,
  };
}

async function pushDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  const args = [...op.command.args, "--dry-run"];
  const result = await spawnGit(args, op.command.cwd, 20_000);
  const outgoing = await spawnGit(["log", "@{u}..HEAD", "--oneline"], op.command.cwd, 5_000).catch(() => ({ stdout: "(Could not determine outgoing commits)" }));
  return {
    operationId: op.id,
    commandDisplay,
    explanation: `Pushes local commits to the remote.\n\nOutgoing commits:\n${outgoing.stdout || "(none)"}`,
    diff: null,
    stateDelta: result.stdout || result.stderr || "Dry run completed with no output.",
  };
}

async function mergeDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  // Show what would be merged using diff
  const target = op.command.args.find((a) => !a.startsWith("-"));
  const diffArgs = target ? ["diff", "--stat", `HEAD...${target}`] : ["diff", "--stat"];
  const diffResult = await spawnGit(diffArgs, op.command.cwd, 10_000).catch(() => ({ stdout: "" }));
  return {
    operationId: op.id,
    commandDisplay,
    explanation: `Merges the specified branch into the current branch. ${op.intent}`,
    diff: diffResult.stdout || null,
    stateDelta: `Would merge: ${diffResult.stdout || "no differences found"}`,
  };
}

async function rebaseDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  const target = op.command.args.find((a) => !a.startsWith("-"));
  const logArgs = target ? ["log", "--oneline", `${target}..HEAD`] : ["log", "--oneline", "-10"];
  const logResult = await spawnGit(logArgs, op.command.cwd, 5_000).catch(() => ({ stdout: "" }));
  return {
    operationId: op.id,
    commandDisplay,
    explanation: `Rewrites commit history by replaying commits on top of the target branch.\n⚠️ This modifies git history.`,
    diff: null,
    stateDelta: `Commits that will be replayed:\n${logResult.stdout || "(none)"}`,
  };
}

async function resetDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  const isHard = op.command.args.includes("--hard");
  const target = op.command.args.find((a) => !a.startsWith("-")) ?? "HEAD";
  const diffArgs = ["diff", "--stat", target];
  if (!isHard) diffArgs.push("--staged");
  const diffResult = await spawnGit(diffArgs, op.command.cwd, 5_000).catch(() => ({ stdout: "" }));
  const explanation = isHard
    ? `⚠️ HARD RESET: Discards ALL uncommitted changes and moves HEAD to ${target}. This CANNOT be undone for uncommitted work.`
    : `Moves HEAD to ${target}. Your working tree changes are preserved.`;
  return {
    operationId: op.id,
    commandDisplay,
    explanation,
    diff: diffResult.stdout || null,
    stateDelta: diffResult.stdout ? `Changes that will be affected:\n${diffResult.stdout}` : "No staged changes",
  };
}

async function cleanDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  const previewArgs = op.command.args.filter((a) => a !== "-f" && a !== "--force").concat("-n");
  const result = await spawnGit(["clean", ...previewArgs.slice(1)], op.command.cwd, 5_000).catch(() => ({ stdout: "" }));
  return {
    operationId: op.id,
    commandDisplay,
    explanation: "⚠️ PERMANENTLY DELETES untracked files. These cannot be recovered.",
    diff: null,
    stateDelta: result.stdout || "No untracked files would be removed.",
  };
}

async function branchDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  const isDelete = op.command.args.includes("-d") || op.command.args.includes("-D");
  const branchName = op.command.args.find((a) => !a.startsWith("-"));
  let stateDelta = `Would ${isDelete ? "delete" : "create"} branch '${branchName}'.`;
  if (isDelete && branchName) {
    const unmerged = await spawnGit(["log", branchName, "--not", "--remotes", "--oneline"], op.command.cwd, 5_000).catch(() => ({ stdout: "" }));
    if (unmerged.stdout.trim()) {
      stateDelta += `\n\nUnmerged commits that would be orphaned:\n${unmerged.stdout}`;
    }
  }
  return { operationId: op.id, commandDisplay, explanation: op.intent, diff: null, stateDelta };
}

async function stashDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  const sub2 = op.command.args[1];
  let stateDelta = "";
  if (sub2 === "push") {
    const statusResult = await spawnGit(["status", "--short"], op.command.cwd, 5_000).catch(() => ({ stdout: "" }));
    stateDelta = `Would stash:\n${statusResult.stdout || "(nothing to stash)"}`;
  } else if (sub2 === "pop" || sub2 === "apply") {
    const listResult = await spawnGit(["stash", "list"], op.command.cwd, 5_000).catch(() => ({ stdout: "" }));
    stateDelta = `Top stash entry:\n${listResult.stdout.split("\n")[0] ?? "(empty stash)"}`;
  } else {
    stateDelta = `Would ${sub2 ?? "operate on"} stash.`;
  }
  return { operationId: op.id, commandDisplay, explanation: op.intent, diff: null, stateDelta };
}

async function pullDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  const fetchArgs = ["fetch", "--dry-run"];
  const remote = op.command.args.find((a) => !a.startsWith("-")) ?? "origin";
  fetchArgs.push(remote);
  const result = await spawnGit(fetchArgs, op.command.cwd, 20_000).catch(() => ({ stdout: "", stderr: "", exitCode: 1 }));
  const incoming = await spawnGit(["log", "HEAD..@{u}", "--oneline"], op.command.cwd, 5_000).catch(() => ({ stdout: "" }));
  return {
    operationId: op.id,
    commandDisplay,
    explanation: `Fetches and integrates remote changes.\n\nIncoming commits:\n${incoming.stdout || "(already up to date)"}`,
    diff: null,
    stateDelta: result.stdout || result.stderr || "Fetch dry run complete.",
  };
}

async function switchDryRun(op: PlannedOperation, commandDisplay: string): Promise<DryRunPreview> {
  const target = op.command.args.find((a) => !a.startsWith("-"));
  return {
    operationId: op.id,
    commandDisplay,
    explanation: `Switches to branch '${target}'. Your current uncommitted changes may follow if compatible.`,
    diff: null,
    stateDelta: `HEAD will point to: ${target ?? "unknown"}`,
  };
}

function genericPreview(op: PlannedOperation, commandDisplay: string): DryRunPreview {
  return {
    operationId: op.id,
    commandDisplay,
    explanation: op.intent,
    diff: null,
    stateDelta: `Command will execute: ${commandDisplay}`,
  };
}
