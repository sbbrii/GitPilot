// ─── LLM Types ────────────────────────────────────────────────────────────────

export interface ToolCallInput {
  readonly name: string;
  readonly input: unknown;
}

export interface ToolResult {
  readonly toolUseId: string;
  readonly content: string;
  readonly isError?: boolean;
}

export interface ConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: string;
}

export interface ChatRequest {
  readonly message: string;
  readonly repoPath: string;
}

export interface StreamChunk {
  readonly type: "token" | "done" | "error";
  readonly content?: string;
  readonly error?: string;
}
