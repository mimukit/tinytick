// The per-window undo stack. It lives in memory, so it ends when the window closes.
import type { Task, TaskPatch } from "../api/types";

export type UndoEntry =
  /** Restore these fields with one update call. */
  | { kind: "fields"; label: string; taskId: string; projectId: string; previous: TaskPatch }
  /** Reopen a task that was completed. It keeps the task, because the cache drops completed tasks. */
  | { kind: "reopen"; label: string; taskId: string; projectId: string; task: Task }
  /** Move a task back to the list it came from. */
  | { kind: "move"; label: string; taskId: string; fromProjectId: string; toProjectId: string };

export const UNDO_LIMIT = 10;

export class UndoStack {
  private entries: UndoEntry[] = [];

  constructor(private readonly limit = UNDO_LIMIT) {}

  push(entry: UndoEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  pop(): UndoEntry | undefined {
    return this.entries.pop();
  }

  peek(): UndoEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  get size(): number {
    return this.entries.length;
  }
}

/**
 * The previous values of the fields a patch changes. A field that was not set
 * comes back as `null`, which clears it on undo.
 */
export function previousFields(task: Task, patch: TaskPatch): TaskPatch {
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
    previous[key] = task[key] === undefined ? null : task[key];
  }
  return previous as TaskPatch;
}
