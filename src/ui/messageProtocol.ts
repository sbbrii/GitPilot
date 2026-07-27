// ─── Webview Message Protocol ─────────────────────────────────────────────────
// All postMessage payloads between extension host and webviews are typed here.
// Webviews receive H2W messages; host receives W2H messages.

import type { CommitGraphData } from "../graph/types";

// ── Host → Chat Webview ──────────────────────────────────────────────────────
export type H2CMessage =
  | { type: "chat.token"; token: string }
  | { type: "chat.done" }
  | { type: "chat.error"; message: string }
  | { type: "chat.history"; messages: Array<{ role: "user" | "assistant"; content: string; ts: string }> }
  | { type: "approval.request"; id: string; commandDisplay: string; dryRunOutput: string; dryRunDiff: string | null; riskLevel: string; warnings: string[]; requiresTyped: boolean; phrase: string | null }
  | { type: "approval.expired"; id: string };

// ── Chat Webview → Host ──────────────────────────────────────────────────────
export type C2HMessage =
  | { type: "chat.send"; message: string }
  | { type: "approval.granted"; id: string; typedPhrase?: string }
  | { type: "approval.denied"; id: string }
  | { type: "ready" };

// ── Host → Graph Webview ─────────────────────────────────────────────────────
export type H2GMessage =
  | { type: "graph.data"; data: CommitGraphData }
  | { type: "graph.highlight"; shas: string[] }
  | { type: "graph.focus"; sha: string };

// ── Graph Webview → Host ─────────────────────────────────────────────────────
export type G2HMessage =
  | { type: "graph.commitClick"; sha: string }
  | { type: "graph.contextMenu"; sha: string; action: "cherry-pick" | "reset-to" | "branch-here" }
  | { type: "ready" };
