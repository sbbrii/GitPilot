// ─── Typed Event Bus ──────────────────────────────────────────────────────────
// A strictly-typed pub/sub broker. All inter-component communication goes
// through named channels defined in EventMap below.

import type { RepoState } from "../repo/types";
import type { PlannedOperation } from "../planner/types";
import type { SafetyReport } from "../safety/types";
import type { ApprovalRequest, ExecutionResult, ExecutionError } from "../executor/types";
import type { CommitGraphData } from "../graph/types";

export interface EventMap {
  "repo.state.updated": RepoState;
  "repo.scan.started": void;
  "repo.scan.failed": Error;
  "plan.produced": PlannedOperation[];
  "plan.rejected": { reason: string; issues: string[] };
  "safety.report.ready": SafetyReport;
  "approval.requested": ApprovalRequest;
  "approval.granted": ApprovalRequest;
  "approval.denied": ApprovalRequest;
  "approval.expired": ApprovalRequest;
  "command.started": { operationId: string; command: string[] };
  "command.stdout": { operationId: string; chunk: string };
  "command.stderr": { operationId: string; chunk: string };
  "command.executed": ExecutionResult;
  "command.failed": ExecutionError;
  "llm.stream.token": string;
  "llm.stream.done": void;
  "llm.error": Error;
  "graph.data.ready": CommitGraphData;
  "recovery.state.detected": { type: string; files: string[] };
}

type EventHandler<T> = (payload: T) => void | Promise<void>;

export class EventBus {
  private readonly handlers = new Map<
    keyof EventMap,
    Set<EventHandler<unknown>>
  >();

  on<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler as EventHandler<unknown>);
    return () => set.delete(handler as EventHandler<unknown>);
  }

  once<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      return handler(payload);
    });
    return unsubscribe;
  }

  emit<K extends keyof EventMap>(
    event: K,
    ...args: EventMap[K] extends void ? [] : [EventMap[K]]
  ): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    const payload = args[0] as EventMap[K];
    for (const handler of set) {
      try {
        // Fire-and-forget — async handlers are not awaited
        void (handler as EventHandler<EventMap[K]>)(payload);
      } catch (e) {
        console.error(`[EventBus] Unhandled error in handler for "${event}":`, e);
      }
    }
  }

  /** Remove all handlers for a given event, or all events if none specified. */
  clear(event?: keyof EventMap): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

/** Singleton bus shared across the extension host process. */
export const bus = new EventBus();
