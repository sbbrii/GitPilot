// ─── Audit Logger ─────────────────────────────────────────────────────────────
// Persists execution audit trail to VS Code workspace state (survives sessions).

import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { logger } from "../core/logger";
import type { AuditEntry, ExecutionResult } from "./types";

const log = logger.scope("AuditLogger");
const STORAGE_KEY = "gitCopilot.auditLog";
const MAX_ENTRIES = 1000;

export class AuditLogger {
  constructor(private readonly storage: vscode.Memento) {}

  record(result: ExecutionResult, command: readonly string[]): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      timestamp: result.executedAt,
      command,
      approvalId: result.approvalId,
      success: result.success,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };

    this.persist(entry);
    log.info("Audit entry recorded", { id: entry.id, command: command.join(" "), success: result.success });
    return entry;
  }

  private persist(entry: AuditEntry): void {
    try {
      const existing = this.storage.get<AuditEntry[]>(STORAGE_KEY, []);
      const updated = [...existing, entry].slice(-MAX_ENTRIES);
      void this.storage.update(STORAGE_KEY, updated);
    } catch (e) {
      log.error("Failed to persist audit entry", e);
    }
  }

  getAll(): AuditEntry[] {
    return this.storage.get<AuditEntry[]>(STORAGE_KEY, []);
  }

  clear(): Promise<void> {
    return this.storage.update(STORAGE_KEY, []);
  }
}
