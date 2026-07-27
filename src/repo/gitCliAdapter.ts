// ─── Git CLI Adapter ─────────────────────────────────────────────────────────
// Pure parsing functions for git porcelain output. All functions are pure
// (no I/O) and are independently unit-testable.

import type {
  Branch,
  FileChange,
  FileStatus,
  Remote,
  StashEntry,
  CommitSummary,
  WorkingTree,
} from "./types";

// ── git status --porcelain=v1 parsing ────────────────────────────────────────

/** Maps git porcelain XY codes to our FileStatus enum. */
function porcelainStatusToEnum(xy: string): FileStatus {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  if (x === "?" && y === "?") return "Added"; // untracked handled separately
  if (x === "A" || y === "A") return "Added";
  if (x === "M" || y === "M") return "Modified";
  if (x === "D" || y === "D") return "Deleted";
  if (x === "R" || y === "R") return "Renamed";
  if (x === "C" || y === "C") return "Copied";
  if (x === "U" || y === "U") return "Unmerged";
  return "Modified";
}

export interface ParsedStatus {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
  conflicts: string[];
}

/**
 * Parse `git status --porcelain=v1` output into structured FileChange arrays.
 * Pure function — receives raw stdout string, returns typed data.
 */
export function parseStatusPorcelain(raw: string): ParsedStatus {
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: string[] = [];
  const conflicts: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.length < 3) continue;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const rest = line.slice(3);

    // Untracked
    if (x === "?" && y === "?") {
      untracked.push(rest.trim());
      continue;
    }

    // Conflict states
    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${x}${y}`)) {
      conflicts.push(rest.trim());
      continue;
    }

    // Renamed files have format: "old -> new"
    const isRename = x === "R" || y === "R";
    let path: string;
    let oldPath: string | undefined;
    if (isRename && rest.includes(" -> ")) {
      const parts = rest.split(" -> ");
      oldPath = parts[0]?.trim();
      path = parts[1]?.trim() ?? rest.trim();
    } else {
      path = rest.trim();
    }

    // Index (staged) status
    if (x !== " " && x !== "?") {
      staged.push({
        path,
        status: porcelainStatusToEnum(`${x} `),
        ...(oldPath ? { oldPath } : {}),
      });
    }

    // Working tree (unstaged) status
    if (y !== " " && y !== "?") {
      unstaged.push({
        path,
        status: porcelainStatusToEnum(` ${y}`),
        ...(oldPath ? { oldPath } : {}),
      });
    }
  }

  return { staged, unstaged, untracked, conflicts };
}

// ── git branch -vv parsing ────────────────────────────────────────────────────

/**
 * Parse `git branch -vv --all` output into Branch objects.
 * Example line:
 *   * main abc1234 [origin/main: ahead 1, behind 2] Last commit message
 */
export function parseBranchVV(raw: string): Branch[] {
  const branches: Branch[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    const isCurrent = line.startsWith("* ");
    // Strip leading "* " or "  " and "remotes/" prefix
    const body = line.slice(2).trim();
    const isRemote = body.startsWith("remotes/");
    const withoutRemotePrefix = isRemote ? body.slice("remotes/".length) : body;

    // Split: name sha [...tracking] message
    const parts = withoutRemotePrefix.match(
      /^(\S+)\s+([0-9a-f]+)\s+(?:\[([^\]]+)\]\s+)?(.*)$/,
    );
    if (!parts) continue;

    const name = parts[1] ?? "";
    const sha = parts[2] ?? "";
    const trackingInfo = parts[3] ?? null;
    const lastCommitMessage = parts[4] ?? "";

    let remote: string | null = null;
    let upstream: string | null = null;
    let aheadCount = 0;
    let behindCount = 0;

    if (trackingInfo) {
      // "[origin/main: ahead 1, behind 2]" or "[origin/main]"
      const colonIdx = trackingInfo.indexOf(":");
      upstream = colonIdx >= 0 ? trackingInfo.slice(0, colonIdx).trim() : trackingInfo.trim();
      remote = upstream.split("/")[0] ?? null;

      const aheadMatch = trackingInfo.match(/ahead\s+(\d+)/);
      const behindMatch = trackingInfo.match(/behind\s+(\d+)/);
      aheadCount = aheadMatch ? parseInt(aheadMatch[1] ?? "0", 10) : 0;
      behindCount = behindMatch ? parseInt(behindMatch[1] ?? "0", 10) : 0;
    }

    if (isRemote) {
      remote = name.split("/")[0] ?? null;
    }

    branches.push({
      name,
      sha,
      shortSha: sha.slice(0, 7),
      isRemote,
      remote,
      upstream,
      aheadCount,
      behindCount,
      isCurrentBranch: isCurrent,
      lastCommitMessage,
    });
  }

  return branches;
}

// ── git remote -v parsing ─────────────────────────────────────────────────────

/** Parse `git remote -v` output. Deduplicates fetch/push entries per remote. */
export function parseRemoteV(raw: string): Remote[] {
  const map = new Map<string, { fetchUrl?: string; pushUrl?: string }>();

  for (const line of raw.split("\n")) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/);
    if (!m) continue;
    const name = m[1]!;
    const url = m[2]!;
    const type = m[3] as "fetch" | "push";
    const entry = map.get(name) ?? {};
    if (type === "fetch") entry.fetchUrl = url;
    else entry.pushUrl = url;
    map.set(name, entry);
  }

  return Array.from(map.entries()).map(([name, { fetchUrl = "", pushUrl = "" }]) => ({
    name,
    fetchUrl,
    pushUrl: pushUrl || fetchUrl, // fall back to fetch URL if push not listed
  }));
}

// ── git stash list parsing ────────────────────────────────────────────────────

/**
 * Parse `git stash list` output.
 * Format: stash@{0}: On main: WIP on feature/xyz
 */
export function parseStashList(raw: string): StashEntry[] {
  const entries: StashEntry[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^stash@\{(\d+)\}:\s+(?:On\s+(\S+):\s+)?(.+)$/);
    if (!m) continue;
    entries.push({
      index: parseInt(m[1] ?? "0", 10),
      branchName: m[2] ?? "unknown",
      message: m[3] ?? line,
      sha: "", // filled in separately by RepositoryInspector
    });
  }

  return entries;
}

// ── git log --format parsing ──────────────────────────────────────────────────

const LOG_SEPARATOR = "---GITCOPILOT---";

/**
 * Parse structured log output using a custom separator format.
 * Expected format string: `--format=%H|%h|%s|%an|%ae|%aI|%P`
 */
export function parseCommitLog(raw: string, branchLabelMap: Map<string, string[]>, tagLabelMap: Map<string, string[]>): CommitSummary[] {
  const commits: CommitSummary[] = [];

  for (const entry of raw.split(LOG_SEPARATOR)) {
    const line = entry.trim();
    if (!line) continue;
    const fields = line.split("|");
    if (fields.length < 7) continue;

    const sha = fields[0] ?? "";
    const shortSha = fields[1] ?? "";
    const message = fields[2] ?? "";
    const authorName = fields[3] ?? "";
    const authorEmail = fields[4] ?? "";
    const timestamp = fields[5] ?? "";
    const parentShas = (fields[6] ?? "")
      .split(" ")
      .map((s) => s.trim())
      .filter(Boolean);

    commits.push({
      sha,
      shortSha,
      message,
      author: { name: authorName, email: authorEmail },
      timestamp,
      parentShas,
      branchLabels: branchLabelMap.get(sha) ?? [],
      tagLabels: tagLabelMap.get(sha) ?? [],
      isMergeCommit: parentShas.length > 1,
    });
  }

  return commits;
}

export const GIT_LOG_FORMAT = `${LOG_SEPARATOR}%H|%h|%s|%an|%ae|%aI|%P`;
