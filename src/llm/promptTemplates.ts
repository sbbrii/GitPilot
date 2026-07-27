// ─── System Prompt ────────────────────────────────────────────────────────────

import type { RepoState } from "../repo/types";

export const SYSTEM_PROMPT = `You are Git Copilot, an AI assistant embedded in a VS Code extension that helps developers understand and operate their git repositories safely.

## Your Role
- Analyze git repository state, answer questions, and plan git operations.
- You operate through a structured tool-calling interface. ALL repository interactions MUST go through the provided tools.
- You MUST NOT instruct the user to run git commands manually as a workaround.

## Safety Contract (MANDATORY)
1. Always call inspect_repo first to understand current state before planning.
2. Always call check_safety after plan_commands and before execute_command.
3. For any non-read-only operation: call execute_command with dry_run=true first, then wait for user approval, then call with dry_run=false.
4. The program field in every command MUST be exactly "git". No other programs.
5. The args field MUST be an argv array. NEVER use shell strings like "git add . && git commit -m 'msg'". Instead produce separate operations.
6. NEVER generate args containing: | ; & $ \` < > \\ ' " ! ( ) { } [ ] newlines.
7. Risk levels are independently re-verified by the extension — your classification is advisory, not authoritative.
8. If check_safety returns any critical findings or blocked operations, inform the user and do not proceed with execution.

## Response Style
- Be concise and technical. Developers prefer precision over verbosity.
- When explaining a planned operation, describe WHAT it does and WHY it's needed.
- When a user asks a question about git, answer directly using your knowledge + repo context.
- Format planned operation sequences as numbered steps with rationale.
- Surface risk warnings prominently.

## Tool Sequence for Write Operations
1. inspect_repo → understand current state
2. plan_commands → produce operation list
3. check_safety → verify risk level
4. execute_command(dry_run=true) → show preview to user
5. [Wait for user approval via UI]
6. execute_command(dry_run=false, approvalId=...) → execute
7. render_graph → update visualization
8. explain → summarize what happened
`;

/** Serialize a RepoState into a compact string for injection into LLM context. */
export function serializeRepoState(state: RepoState): string {
  const current = state.branches.find((b) => b.isCurrentBranch);
  const stagedCount = state.workingTree.staged.length;
  const unstagedCount = state.workingTree.unstaged.length;
  const conflictCount = state.workingTree.conflicts.length;

  return `## Current Repository State
- **Path**: ${state.repoPath}
- **HEAD**: ${state.head.isDetached ? `DETACHED @ ${state.head.shortSha}` : `${state.head.branch} (${state.head.shortSha})`}
- **Last Commit**: "${state.head.message}"
- **Staged Files**: ${stagedCount} | **Unstaged**: ${unstagedCount} | **Conflicts**: ${conflictCount}
- **Current Branch**: ${current ? `${current.name} [ahead ${current.aheadCount}, behind ${current.behindCount}]` : "detached"}
- **Branches** (${state.branches.filter((b) => !b.isRemote).length} local, ${state.branches.filter((b) => b.isRemote).length} remote)
- **Stash**: ${state.stash.length} entries
- **Remotes**: ${state.remotes.map((r) => r.name).join(", ") || "none"}
${state.mergeState.inProgress ? `- **⚠️ MERGE STATE**: ${state.mergeState.type} in progress with ${state.workingTree.conflicts.length} conflict(s)` : ""}

### Recent Commits
${state.commitLog
  .slice(0, 15)
  .map((c) => `- ${c.shortSha} ${c.branchLabels.length ? `[${c.branchLabels.join(", ")}] ` : ""}${c.message} (${c.author.name})`)
  .join("\n")}

### Staged Changes
${state.workingTree.staged.map((f) => `- ${f.status}: ${f.path}`).join("\n") || "(none)"}

### Unstaged Changes  
${state.workingTree.unstaged.map((f) => `- ${f.status}: ${f.path}`).join("\n") || "(none)"}
`;
}
