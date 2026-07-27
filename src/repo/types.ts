// ─── Repository State Types ───────────────────────────────────────────────────

export type FileStatus =
  | "Added"
  | "Modified"
  | "Deleted"
  | "Renamed"
  | "Copied"
  | "Unmerged";

export interface FileChange {
  readonly path: string;
  readonly status: FileStatus;
  /** Populated for renames/copies only */
  readonly oldPath?: string;
}

export interface Branch {
  readonly name: string;
  readonly sha: string;
  readonly shortSha: string;
  readonly isRemote: boolean;
  readonly remote: string | null;
  /** e.g. "origin/main" */
  readonly upstream: string | null;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly isCurrentBranch: boolean;
  readonly lastCommitMessage: string;
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl: string;
  readonly pushUrl: string;
}

export interface WorkingTree {
  readonly staged: readonly FileChange[];
  readonly unstaged: readonly FileChange[];
  readonly untracked: readonly string[];
  /** Paths with unresolved merge conflicts */
  readonly conflicts: readonly string[];
}

export interface StashEntry {
  readonly index: number;
  readonly message: string;
  readonly sha: string;
  readonly branchName: string;
}

export interface CommitSummary {
  readonly sha: string;
  readonly shortSha: string;
  readonly message: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly timestamp: string; // ISO-8601
  readonly parentShas: readonly string[];
  readonly branchLabels: readonly string[];
  readonly tagLabels: readonly string[];
  readonly isMergeCommit: boolean;
}

export interface HeadState {
  readonly sha: string;
  readonly shortSha: string;
  /** null when in detached HEAD state */
  readonly branch: string | null;
  readonly isDetached: boolean;
  readonly message: string;
}

export interface MergeState {
  readonly inProgress: boolean;
  readonly type: "merge" | "rebase" | "cherry-pick" | "revert" | null;
  readonly conflictedFiles: readonly string[];
}

export interface RepoConfig {
  readonly userName: string | null;
  readonly userEmail: string | null;
  readonly defaultBranch: string;
}

export interface RepoState {
  readonly repoPath: string;
  readonly capturedAt: string; // ISO-8601
  readonly head: HeadState;
  readonly branches: readonly Branch[];
  readonly remotes: readonly Remote[];
  readonly workingTree: WorkingTree;
  readonly stash: readonly StashEntry[];
  readonly commitLog: readonly CommitSummary[];
  readonly mergeState: MergeState;
  readonly config: RepoConfig;
}

/** Sentinel for when we are not inside a git repo. */
export interface NoRepoState {
  readonly kind: "no-repo";
  readonly path: string;
}

export type RepoStateResult = { kind: "repo"; state: RepoState } | NoRepoState;
