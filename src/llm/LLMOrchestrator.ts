// ─── LLM Orchestrator ─────────────────────────────────────────────────────────
// Manages the multi-turn conversation with Claude, handles tool-calling loops,
// and streams real response tokens to the chat panel via the event bus.

import Anthropic from "@anthropic-ai/sdk";
import * as vscode from "vscode";
import { bus } from "../core/eventBus";
import { logger } from "../core/logger";
import { config } from "../core/config";
import { LLMError } from "../core/errors";
import { SYSTEM_PROMPT } from "./promptTemplates";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import { TOOL_HANDLERS } from "./toolHandlers";
import type { ToolHandlerContext } from "./toolHandlers";
import type { ConversationMessage } from "./types";

const log = logger.scope("LLMOrchestrator");

const MAX_TOOL_CALLS_PER_TURN = 30;
const MAX_HISTORY_MESSAGES = 40;

export class LLMOrchestrator {
  private client: Anthropic | null = null;
  private history: ConversationMessage[] = [];

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly ctx: ToolHandlerContext,
  ) {}

  private async getClient(): Promise<Anthropic> {
    if (this.client) return this.client;
    const apiKey = await config.getApiKey(this.secrets);
    if (!apiKey) {
      throw new LLMError("Anthropic API key not configured. Run: Git Copilot: Set API Key");
    }
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  /**
   * Process a user message through the streaming tool-calling loop.
   * Text tokens are emitted to the bus in real-time as they arrive from the API.
   */
  async chat(userMessage: string): Promise<void> {
    const client = await this.getClient().catch((e) => {
      bus.emit("llm.error", e instanceof Error ? e : new Error(String(e)));
      throw e;
    });

    log.info("Chat turn started", { messageLength: userMessage.length });

    // Add user message to history
    this.history.push({
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString(),
    });

    // Trim history to context budget
    if (this.history.length > MAX_HISTORY_MESSAGES) {
      this.history = this.history.slice(-MAX_HISTORY_MESSAGES);
    }

    const messages: Anthropic.MessageParam[] = this.history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let toolCallCount = 0;
    let assistantResponse = "";

    // Tool-calling loop — each iteration may produce tool calls which continue the loop
    while (true) {
      if (toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
        bus.emit("llm.error", new LLMError("Tool call limit reached. Turn aborted."));
        break;
      }

      // ── Streaming API call ──────────────────────────────────────────────────
      let response: Anthropic.Message;
      try {
        const stream = client.messages.stream({
          model: config.llmModel,
          max_tokens: config.llmMaxTokens,
          system: SYSTEM_PROMPT,
          tools: TOOL_DEFINITIONS,
          messages,
        });

        // Emit real streaming tokens as they arrive
        let iterationText = "";
        stream.on("text", (textDelta) => {
          iterationText += textDelta;
          assistantResponse += textDelta;
          bus.emit("llm.stream.token", textDelta);
        });

        response = await stream.finalMessage();
      } catch (e) {
        const err = new LLMError(
          `Anthropic API error: ${e instanceof Error ? e.message : String(e)}`,
          e,
        );
        log.error("LLM API call failed", err);
        bus.emit("llm.error", err);
        throw err;
      }

      // If stop_reason is end_turn or max_tokens, we're done with this turn
      if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
        break;
      }

      // ── Handle tool_use blocks ─────────────────────────────────────────────
      if (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );

        // Add the full assistant message (including tool_use blocks) to conversation
        messages.push({ role: "assistant", content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          toolCallCount++;
          log.debug("Tool call", { name: toolUse.name, id: toolUse.id });

          const handler = TOOL_HANDLERS[toolUse.name];
          if (!handler) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }),
              is_error: true,
            });
            continue;
          }

          try {
            const result = await handler(toolUse.input, this.ctx);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: result,
            });
          } catch (e) {
            log.error("Tool handler error", { tool: toolUse.name, error: e });
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
              is_error: true,
            });
          }
        }

        // Add tool results as a user message and continue the loop
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Any other unexpected stop reason — exit loop defensively
      log.warn("Unexpected stop_reason", { stop_reason: response.stop_reason });
      break;
    }

    bus.emit("llm.stream.done");

    // Record assistant turn in conversation history
    if (assistantResponse) {
      this.history.push({
        role: "assistant",
        content: assistantResponse,
        timestamp: new Date().toISOString(),
      });
    }

    log.info("Chat turn complete", { toolCallCount, responseLength: assistantResponse.length });
  }

  clearHistory(): void {
    this.history = [];
  }

  getHistory(): ConversationMessage[] {
    return [...this.history];
  }
}
