// ─── Git CLI Adapter Unit Tests ──────────────────────────────────────────────
// Tests all pure parser functions against real git output samples.
// Zero I/O — 100% deterministic.

import { describe, it, expect } from "vitest";
import {
  parseStatusPorcelain,
  parseBranchVV,
  parseRemoteV,
  parseStashList,
  parseCommitLog,
} from "../../src/repo/gitCliAdapter";

// ── parseStatusPorcelain ──────────────────────────────────────────────────────

describe("parseStatusPorcelain", () => {
  it("parses staged and unstaged modifications", () => {
    const raw = [
      "M  src/foo.ts",   // staged modified
      " M src/bar.ts",   // unstaged modified
      "MM src/baz.ts",   // both staged and unstaged
    ].join("\n");
    const result = parseStatusPorcelain(raw);
    expect(result.staged.map((f) => f.path)).toContain("src/foo.ts");
    expect(result.staged.map((f) => f.path)).toContain("src/baz.ts");
    expect(result.unstaged.map((f) => f.path)).toContain("src/bar.ts");
    expect(result.unstaged.map((f) => f.path)).toContain("src/baz.ts");
  });

  it("parses untracked files", () => {
    const raw = "?? newfile.txt\n?? dir/other.js";
    const result = parseStatusPorcelain(raw);
    expect(result.untracked).toContain("newfile.txt");
    expect(result.untracked).toContain("dir/other.js");
    expect(result.staged).toHaveLength(0);
    expect(result.unstaged).toHaveLength(0);
  });

  it("parses renamed files with old/new paths", () => {
    const raw = "R  new-name.ts -> old-name.ts";
    const result = parseStatusPorcelain(raw);
    expect(result.staged[0]?.status).toBe("Renamed");
  });

  it("parses conflict states", () => {
    const raw = "UU src/conflicted.ts\nDD src/both-deleted.ts";
    const result = parseStatusPorcelain(raw);
    expect(result.conflicts).toContain("src/conflicted.ts");
    expect(result.conflicts).toContain("src/both-deleted.ts");
  });

  it("returns empty arrays for empty input", () => {
    const result = parseStatusPorcelain("");
    expect(result.staged).toHaveLength(0);
    expect(result.unstaged).toHaveLength(0);
    expect(result.untracked).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it("parses added and deleted files", () => {
    const raw = "A  src/new.ts\n D src/deleted.ts";
    const result = parseStatusPorcelain(raw);
    expect(result.staged.find((f) => f.path === "src/new.ts")?.status).toBe("Added");
    expect(result.unstaged.find((f) => f.path === "src/deleted.ts")?.status).toBe("Deleted");
  });
});

// ── parseBranchVV ─────────────────────────────────────────────────────────────

describe("parseBranchVV", () => {
  it("parses current branch with upstream tracking info", () => {
    const raw = "* main abc1234 [origin/main: ahead 2, behind 1] Fix login bug";
    const branches = parseBranchVV(raw);
    const branch = branches[0]!;
    expect(branch.isCurrentBranch).toBe(true);
    expect(branch.name).toBe("main");
    expect(branch.shortSha).toBe("abc1234");
    expect(branch.upstream).toBe("origin/main");
    expect(branch.aheadCount).toBe(2);
    expect(branch.behindCount).toBe(1);
    expect(branch.lastCommitMessage).toBe("Fix login bug");
  });

  it("parses local branch without tracking", () => {
    const raw = "  feature/new-ui def5678 Add new UI components";
    const branches = parseBranchVV(raw);
    const branch = branches[0]!;
    expect(branch.isCurrentBranch).toBe(false);
    expect(branch.name).toBe("feature/new-ui");
    expect(branch.upstream).toBeNull();
    expect(branch.aheadCount).toBe(0);
    expect(branch.behindCount).toBe(0);
  });

  it("parses remote tracking branch", () => {
    const raw = "  remotes/origin/develop aaa1111 Remote feature work";
    const branches = parseBranchVV(raw);
    const branch = branches[0]!;
    expect(branch.isRemote).toBe(true);
    expect(branch.name).toBe("origin/develop");
  });

  it("parses branch with only ahead count", () => {
    const raw = "* dev bbb2222 [origin/dev: ahead 3] WIP";
    const branches = parseBranchVV(raw);
    expect(branches[0]?.aheadCount).toBe(3);
    expect(branches[0]?.behindCount).toBe(0);
  });

  it("returns empty array for empty input", () => {
    expect(parseBranchVV("")).toHaveLength(0);
  });
});

// ── parseRemoteV ──────────────────────────────────────────────────────────────

describe("parseRemoteV", () => {
  it("parses fetch and push URLs for a single remote", () => {
    const raw = [
      "origin\thttps://github.com/user/repo.git (fetch)",
      "origin\thttps://github.com/user/repo.git (push)",
    ].join("\n");
    const remotes = parseRemoteV(raw);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]?.name).toBe("origin");
    expect(remotes[0]?.fetchUrl).toBe("https://github.com/user/repo.git");
    expect(remotes[0]?.pushUrl).toBe("https://github.com/user/repo.git");
  });

  it("parses multiple remotes", () => {
    const raw = [
      "origin\thttps://github.com/user/repo.git (fetch)",
      "origin\thttps://github.com/user/repo.git (push)",
      "upstream\thttps://github.com/org/repo.git (fetch)",
      "upstream\thttps://github.com/org/repo.git (push)",
    ].join("\n");
    const remotes = parseRemoteV(raw);
    expect(remotes).toHaveLength(2);
    expect(remotes.map((r) => r.name)).toContain("upstream");
  });

  it("falls back to fetchUrl when pushUrl is missing", () => {
    const raw = "origin\tgit@github.com:user/repo.git (fetch)";
    const remotes = parseRemoteV(raw);
    expect(remotes[0]?.pushUrl).toBe("git@github.com:user/repo.git");
  });

  it("returns empty array for empty input", () => {
    expect(parseRemoteV("")).toHaveLength(0);
  });
});

// ── parseStashList ────────────────────────────────────────────────────────────

describe("parseStashList", () => {
  it("parses standard stash entries", () => {
    const raw = [
      "stash@{0}: On main: WIP on feature",
      "stash@{1}: On develop: Fix before merge",
    ].join("\n");
    const entries = parseStashList(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.index).toBe(0);
    expect(entries[0]?.branchName).toBe("main");
    expect(entries[0]?.message).toBe("WIP on feature");
    expect(entries[1]?.index).toBe(1);
    expect(entries[1]?.branchName).toBe("develop");
  });

  it("returns empty array for empty input", () => {
    expect(parseStashList("")).toHaveLength(0);
  });
});

// ── parseCommitLog ────────────────────────────────────────────────────────────

describe("parseCommitLog", () => {
  it("parses a well-formed log with the custom separator format", () => {
    const sha1 = "a".repeat(40);
    const sha2 = "b".repeat(40);
    const raw = [
      `---GITCOPILOT---${sha1}|aaaaaaa|Fix auth bug|Alice|alice@example.com|2026-07-01T10:00:00Z|${sha2}`,
      `---GITCOPILOT---${sha2}|bbbbbbb|Initial commit|Bob|bob@example.com|2026-06-30T09:00:00Z|`,
    ].join("\n");

    const branchMap = new Map([[sha1, ["main"]]]);
    const tagMap = new Map([[sha2, ["v1.0.0"]]]);
    const commits = parseCommitLog(raw, branchMap, tagMap);

    expect(commits).toHaveLength(2);
    expect(commits[0]?.sha).toBe(sha1);
    expect(commits[0]?.message).toBe("Fix auth bug");
    expect(commits[0]?.author.name).toBe("Alice");
    expect(commits[0]?.branchLabels).toEqual(["main"]);
    expect(commits[0]?.isMergeCommit).toBe(false);
    expect(commits[0]?.parentShas).toEqual([sha2]);

    expect(commits[1]?.tagLabels).toEqual(["v1.0.0"]);
    expect(commits[1]?.parentShas).toHaveLength(0);
  });

  it("detects merge commits by parent count", () => {
    const sha = "c".repeat(40);
    const p1 = "d".repeat(40);
    const p2 = "e".repeat(40);
    const raw = `---GITCOPILOT---${sha}|ccccccc|Merge branch feature|Dev|d@d.com|2026-07-01T00:00:00Z|${p1} ${p2}`;
    const commits = parseCommitLog(raw, new Map(), new Map());
    expect(commits[0]?.isMergeCommit).toBe(true);
    expect(commits[0]?.parentShas).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(parseCommitLog("", new Map(), new Map())).toHaveLength(0);
  });
});
