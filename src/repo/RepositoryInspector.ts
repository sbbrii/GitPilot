// ─── Repository Inspector ─────────────────────────────────────────────────────
// Orchestrates all git data collection into a single RepoState snapshot.
// Uses child_process.spawn (argv arrays, shell:false) for all git calls.

import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import { EventEmitter } from "events";
import { bus } from "../core/eventBus";
import { logger } from "../core/logger";
import { config } from "../core/config";
import { NotAGitRepositoryError, GitCommandError, GitCommandTimedOutError, toError } from "../core/errors";
import type { RepoState, HeadState, MergeState, RepoConfig } from "./types";
import {
  parseStatusPorcelain,
  parseBranchVV,
  parseRemoteV,
  parseStashList,
  parseCommitLog,
  GIT_LOG_FORMAT,
} from "./gitCliAdapter";

const log = logger.scope("RepositoryInspector");

/** Minimal env for all git subprocesses — prevents interactive prompts. */
function buildGitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
    GIT_EDITOR: "true",
    GIT_PAGER: "cat",
    LANG: "C",
  };
}

/**
 * Spawn a git command and collect stdout/stderr.
 * - Uses argv array, shell: false — no shell injection possible.
 * - Enforces a per-call timeout.
 */
export function spawnGit(
  args: string[],
  cwd: string,
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = cp.spawn("git", args, {
      cwd,
      env: buildGitEnv(),
      shell: false, // CRITICAL: never true
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      reject(new GitCommandTimedOutError(["git", ...args], timeoutMs));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

    proc.on("close", (code) => {
      if (timedOut) return;
      clearTimeout(timer);
      const exitCode = code ?? -1;
      resolve({ stdout, stderr, exitCode });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new GitCommandError(["git", ...args], -1, err.message, err));
    });
  });
}

/** Check if a path is inside a git repository. */
async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const result = await spawnGit(["rev-parse", "--git-dir"], repoPath, 5_000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Parse HEAD state — handles detached HEAD gracefully. */
async function inspectHead(repoPath: string): Promise<HeadState> {
  const [shaResult, symbolicResult] = await Promise.all([
    spawnGit(["rev-parse", "HEAD"], repoPath, 5_000).catch(() => ({ stdout: "", exitCode: 1 })),
    spawnGit(["symbolic-ref", "--quiet", "HEAD"], repoPath, 5_000).catch(() => ({ stdout: "", exitCode: 1 })),
  ]);

  const sha = shaResult.stdout.trim();
  const shortSha = sha.slice(0, 7);

  // If symbolic-ref fails → detached HEAD
  const isDetached = symbolicResult.exitCode !== 0 || !symbolicResult.stdout.trim();
  let branch: string | null = null;
  if (!isDetached) {
    const ref = symbolicResult.stdout.trim();
    branch = ref.replace(/^refs\/heads\//, "");
  }

  // Get HEAD commit message
  let message = "";
  if (sha) {
    const msgResult = await spawnGit(
      ["log", "-1", "--format=%s", "HEAD"],
      repoPath,
      5_000,
    ).catch(() => ({ stdout: "" }));
    message = msgResult.stdout.trim();
  }

  return { sha, shortSha, branch, isDetached, message };
}

/** Detect in-progress merge/rebase/cherry-pick state by checking .git/ files. */
function detectMergeState(gitDir: string): MergeState {
  const check = (file: string) => {
    try {
      return fs.existsSync(path.join(gitDir, file));
    } catch {
      return false;
    }
  };

  const readConflicts = (): string[] => {
    try {
      const indexResult = fs.readFileSync(path.join(gitDir, "MERGE_MSG"), "utf8");
      return []; // conflicts parsed from status separately
    } catch {
      return [];
    }
  };

  if (check("MERGE_HEAD")) {
    return { inProgress: true, type: "merge", conflictedFiles: readConflicts() };
  }
  if (check("rebase-merge") || check("rebase-apply")) {
    return { inProgress: true, type: "rebase", conflictedFiles: [] };
  }
  if (check("CHERRY_PICK_HEAD")) {
    return { inProgress: true, type: "cherry-pick", conflictedFiles: [] };
  }
  if (check("REVERT_HEAD")) {
    return { inProgress: true, type: "revert", conflictedFiles: [] };
  }

  return { inProgress: false, type: null, conflictedFiles: [] };
}

/** Read user.name / user.email / init.defaultBranch from git config. */
async function inspectConfig(repoPath: string): Promise<RepoConfig> {
  const get = async (key: string): Promise<string | null> => {
    const r = await spawnGit(["config", "--get", key], repoPath, 3_000).catch(() => ({ stdout: "", exitCode: 1 }));
    return r.exitCode === 0 ? r.stdout.trim() || null : null;
  };

  const [userName, userEmail, defaultBranch] = await Promise.all([
    get("user.name"),
    get("user.email"),
    get("init.defaultBranch"),
  ]);

  return {
    userName,
    userEmail,
    defaultBranch: defaultBranch ?? "main",
  };
}

export class RepositoryInspector {
  private cachedState: RepoState | null = null;
  private scanPromise: Promise<RepoState> | null = null;
  private gitDir: string | null = null;

  constructor(private readonly repoPath: string) {}

  /** Get cached state or trigger a fresh scan. Debounces concurrent calls. */
  async getRepoState(forceRefresh = false): Promise<RepoState> {
    if (!forceRefresh && this.cachedState) return this.cachedState;
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.scan().finally(() => { this.scanPromise = null; });
    return this.scanPromise;
  }

  private async scan(): Promise<RepoState> {
    log.debug("Scanning repository", { path: this.repoPath });
    bus.emit("repo.scan.started");

    const isRepo = await isGitRepo(this.repoPath);
    if (!isRepo) {
      throw new NotAGitRepositoryError(this.repoPath);
    }

    // Locate .git directory (handles worktrees)
    const gitDirResult = await spawnGit(["rev-parse", "--git-dir"], this.repoPath, 5_000);
    this.gitDir = path.resolve(this.repoPath, gitDirResult.stdout.trim());

    // Run all independent git commands in parallel for speed
    const [
      statusResult,
      branchResult,
      remoteResult,
      stashResult,
    ] = await Promise.all([
      spawnGit(["status", "--porcelain=v1"], this.repoPath).catch((e) => { log.warn("status failed", e); return { stdout: "" }; }),
      spawnGit(["branch", "-vv", "--all"], this.repoPath).catch((e) => { log.warn("branch failed", e); return { stdout: "" }; }),
      spawnGit(["remote", "-v"], this.repoPath).catch(() => ({ stdout: "" })),
      spawnGit(["stash", "list"], this.repoPath).catch(() => ({ stdout: "" })),
    ]);

    const parsedStatus = parseStatusPorcelain(statusResult.stdout);
    const branches = parseBranchVV(branchResult.stdout);
    const remotes = parseRemoteV(remoteResult.stdout);
    const stash = parseStashList(stashResult.stdout);

    // Build branch/tag → SHA lookup for commit log decoration
    const branchLabelMap = new Map<string, string[]>();
    for (const b of branches) {
      const labels = branchLabelMap.get(b.sha) ?? [];
      labels.push(b.name);
      branchLabelMap.set(b.sha, labels);
    }

    // Fetch tags
    const tagResult = await spawnGit(
      ["tag", "--list", "--format=%(objectname:short)|%(refname:short)"],
      this.repoPath,
    ).catch(() => ({ stdout: "" }));
    const tagLabelMap = new Map<string, string[]>();
    for (const line of tagResult.stdout.split("\n")) {
      const [sha, tag] = line.trim().split("|");
      if (sha && tag) {
        const labels = tagLabelMap.get(sha) ?? [];
        labels.push(tag);
        tagLabelMap.set(sha, labels);
      }
    }

    // Fetch commit log
    const depth = config.commitLogDepth;
    const logResult = await spawnGit(
      ["log", `--format=${GIT_LOG_FORMAT}`, `--max-count=${depth}`, "--all"],
      this.repoPath,
    ).catch(() => ({ stdout: "" }));
    const commitLog = parseCommitLog(logResult.stdout, branchLabelMap, tagLabelMap);

    // Inspect HEAD and config in parallel
    const [head, repoConfig] = await Promise.all([
      inspectHead(this.repoPath),
      inspectConfig(this.repoPath),
    ]);

    const mergeState = detectMergeState(this.gitDir);

    const state: RepoState = {
      repoPath: this.repoPath,
      capturedAt: new Date().toISOString(),
      head,
      branches,
      remotes,
      workingTree: {
        staged: parsedStatus.staged,
        unstaged: parsedStatus.unstaged,
        untracked: parsedStatus.untracked,
        conflicts: [...parsedStatus.conflicts, ...mergeState.conflictedFiles],
      },
      stash,
      commitLog,
      mergeState,
      config: repoConfig,
    };

    this.cachedState = state;
    log.info("Repository scan complete", {
      branches: branches.length,
      commits: commitLog.length,
      staged: parsedStatus.staged.length,
    });

    bus.emit("repo.state.updated", state);

    // Emit graph data
    return state;
  }

  invalidateCache(): void {
    this.cachedState = null;
  }

  getGitDir(): string | null {
    return this.gitDir;
  }
}
