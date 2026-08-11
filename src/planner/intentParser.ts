// ─── Intent Parser ─────────────────────────────────────────────────────────────
// Extracts intent structure and common shortcuts from natural language requests.
// Pure functions — fully unit-testable.

export interface ParsedIntent {
  rawIntent: string;
  category: "query" | "commit" | "branch" | "merge" | "rebase" | "stash" | "remote" | "unknown";
  targetBranch?: string | undefined;
  commitMessage?: string | undefined;
}

/**
 * Parse natural language user intent to classify high-level category and parameters.
 * Helps pre-seed options or validate LLM plan orientation. Pure function.
 */
export function parseIntent(intent: string): ParsedIntent {
  const trimmed = intent.trim();
  const lc = trimmed.toLowerCase();

  // Commit intent
  if (lc.startsWith("commit") || lc.includes("commit my changes")) {
    const msgMatch = trimmed.match(/commit(?:\s+with\s+message|\s+-m)?\s+["']?([^"']+)["']?/i);
    return {
      rawIntent: trimmed,
      category: "commit",
      commitMessage: msgMatch?.[1]?.trim(),
    };
  }

  // Branch intent
  if (lc.includes("create branch") || lc.includes("checkout -b") || lc.includes("switch to new branch")) {
    const branchMatch = trimmed.match(/(?:branch|switch to|checkout -b)\s+([a-zA-Z0-9_\-\/\.]+)/i);
    return {
      rawIntent: trimmed,
      category: "branch",
      targetBranch: branchMatch?.[1],
    };
  }

  // Merge intent
  if (lc.startsWith("merge")) {
    const branchMatch = trimmed.match(/merge\s+([a-zA-Z0-9_\-\/\.]+)/i);
    return {
      rawIntent: trimmed,
      category: "merge",
      targetBranch: branchMatch?.[1],
    };
  }

  // Rebase intent
  if (lc.startsWith("rebase")) {
    const branchMatch = trimmed.match(/rebase\s+(?:onto\s+)?([a-zA-Z0-9_\-\/\.]+)/i);
    return {
      rawIntent: trimmed,
      category: "rebase",
      targetBranch: branchMatch?.[1],
    };
  }

  // Stash intent
  if (lc.includes("stash")) {
    return { rawIntent: trimmed, category: "stash" };
  }

  // Query / Inspection intent
  if (lc.startsWith("what") || lc.startsWith("show") || lc.startsWith("list") || lc.startsWith("how")) {
    return { rawIntent: trimmed, category: "query" };
  }

  return { rawIntent: trimmed, category: "unknown" };
}
