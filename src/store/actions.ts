// Every write a screen can make. Each one changes the cache, pushes its undo
// entry and shows its toast first, then calls the server. On error it reverts
// the cache, drops the undo entry and shows a failure toast.
import { Alert, Toast, confirmAlert, showToast } from "@raycast/api";
import { errorMessage } from "../api/errors";
import type { ChecklistItem, Task, TaskPatch } from "../api/types";
import { WriteQueue } from "../api/queue";
import { UndoStack, previousFields, type UndoEntry } from "../undo/stack";
import { commitSnapshot, getLive, setLive } from "./live";
import { openApi, prefs, syncNow, v2Api } from "./service";
import { isStale, patchTask, removeTask, replaceProjectTasks, upsertTask, type Snapshot } from "./snapshot";

const undo = new UndoStack();
const writes = new WriteQueue();

function publishUndo(): void {
  setLive({ undoSize: undo.size, undoLabel: undo.peek()?.label });
}

function pushUndo(entry: UndoEntry): UndoEntry {
  undo.push(entry);
  publishUndo();
  return entry;
}

function dropUndo(entry: UndoEntry | undefined): void {
  if (!entry) return;
  undo.remove(entry);
  publishUndo();
}

function snapshot(): Snapshot {
  return getLive().snapshot;
}

/** Not awaited by the writes, so the toast shows before the server answers. */
async function successToast(title: string, message: string | undefined, withUndo: boolean): Promise<void> {
  await showToast({
    style: Toast.Style.Success,
    title,
    message,
    ...(withUndo ? { primaryAction: { title: "Undo", onAction: () => void undoLast() } } : {}),
  });
}

async function fail(title: string, error: unknown): Promise<void> {
  await showToast({ style: Toast.Style.Failure, title, message: errorMessage(error) });
}

/** A manual sync, or a background one. Errors show as a toast. */
export async function refresh(opts: { full?: boolean; quiet?: boolean } = {}): Promise<Snapshot | undefined> {
  if (getLive().loading) return undefined;
  setLive({ loading: true });
  try {
    const next = await syncNow({ full: opts.full });
    commitSnapshot(next);
    if (!opts.quiet) await showToast({ style: Toast.Style.Success, title: `Synced ${next.projects.length} lists, ${next.tasks.length} tasks` });
    return next;
  } catch (error) {
    await fail("Sync failed", error);
    return undefined;
  } finally {
    setLive({ loading: false });
  }
}

/** Starts a background refresh when the cache is older than the refresh age. */
export function refreshIfStale(): void {
  if (isStale(snapshot(), prefs().refreshAge)) void refresh({ quiet: true });
}

async function sendUpdate(task: Task, patch: TaskPatch): Promise<Task | undefined> {
  const api = await openApi();
  if (prefs().safeUpdates) {
    const fresh = await api.getTask(task.projectId, task.id);
    return api.updateTask(task.id, task.projectId, { ...fresh, ...patch });
  }
  return api.updateTask(task.id, task.projectId, patch);
}

function findTask(id: string): Task | undefined {
  return snapshot().tasks.find((t) => t.id === id);
}

/**
 * Changes some fields of a task. Pushes an undo entry unless told not to.
 * `toast` is the success toast title. Without it, a success shows no toast.
 */
export async function updateFields(task: Task, patch: TaskPatch, label: string, opts: { undo?: boolean; toast?: string } = {}): Promise<boolean> {
  const before = findTask(task.id) ?? task;
  const previous = previousFields(before, patch);
  commitSnapshot(patchTask(snapshot(), task.id, patch));
  const entry = opts.undo !== false ? pushUndo({ kind: "fields", label, taskId: task.id, projectId: before.projectId, previous }) : undefined;
  if (opts.toast) void successToast(opts.toast, before.title, !!entry);
  try {
    const reply = await writes.run(task.id, () => sendUpdate(before, patch));
    // A later write for this task is still out. Its own reply is the newer one.
    const latest = writes.pending(task.id) === 0;
    const current = findTask(task.id);
    if (latest && current && reply && typeof reply === "object" && reply.id) commitSnapshot(upsertTask(snapshot(), { ...current, ...reply }));
    return true;
  } catch (error) {
    commitSnapshot(patchTask(snapshot(), task.id, previous));
    dropUndo(entry);
    await fail(`Could not ${label.toLowerCase()}`, error);
    return false;
  }
}

async function refetchProject(projectId: string): Promise<void> {
  const api = await openApi();
  const isInbox = projectId === snapshot().inboxId || projectId.startsWith("inbox");
  const data = isInbox ? await api.getInboxData().catch(() => ({ tasks: undefined })) : await api.getProjectData(projectId);
  if (data.tasks) commitSnapshot(replaceProjectTasks(snapshot(), projectId, data.tasks));
}

export async function complete(task: Task): Promise<void> {
  commitSnapshot(removeTask(snapshot(), task.id));
  // TickTick makes the next occurrence of a repeating task on the server.
  // Reopen does not remove that occurrence, so a repeating complete gets no undo.
  const entry = task.repeatFlag ? undefined : pushUndo({ kind: "reopen", label: "Complete", taskId: task.id, projectId: task.projectId, task });
  void successToast("Completed", task.title, !!entry);
  try {
    await writes.run(task.id, async () => (await openApi()).completeTask(task.projectId, task.id));
  } catch (error) {
    commitSnapshot(upsertTask(snapshot(), task));
    dropUndo(entry);
    await fail("Could not complete the task", error);
    return;
  }
  if (task.repeatFlag) {
    // Refetch the list to get the next occurrence.
    try {
      await refetchProject(task.projectId);
    } catch (error) {
      await fail("Completed, but the next occurrence did not load", error);
    }
  }
}

/** Reopens a completed or Won't Do task. */
export async function reopen(task: Task): Promise<boolean> {
  const wasOpen = !!findTask(task.id);
  commitSnapshot(upsertTask(snapshot(), { ...task, status: 0, completedTime: undefined }));
  try {
    const reply = await writes.run(task.id, async () => (await openApi()).updateTask(task.id, task.projectId, { status: 0 }));
    const current = findTask(task.id);
    if (current && writes.pending(task.id) === 0 && reply && reply.id) commitSnapshot(upsertTask(snapshot(), { ...current, ...reply, status: 0, completedTime: undefined }));
    return true;
  } catch (error) {
    commitSnapshot(wasOpen ? upsertTask(snapshot(), task) : removeTask(snapshot(), task.id));
    await fail("Could not reopen the task", error);
    return false;
  }
}

/** Moves a task to another list. `toast` is the success toast title. */
export async function move(task: Task, toProjectId: string, opts: { undo?: boolean; toast?: string } = {}): Promise<boolean> {
  if (task.projectId === toProjectId) return true;
  const fromProjectId = task.projectId;
  commitSnapshot(patchTask(snapshot(), task.id, { projectId: toProjectId }));
  const entry = opts.undo !== false ? pushUndo({ kind: "move", label: "Move", taskId: task.id, fromProjectId, toProjectId }) : undefined;
  if (opts.toast) void successToast(opts.toast, task.title, !!entry);
  try {
    await writes.run(task.id, async () => (await openApi()).moveTasks([{ fromProjectId, toProjectId, taskId: task.id }]));
    return true;
  } catch (error) {
    commitSnapshot(patchTask(snapshot(), task.id, { projectId: fromProjectId }));
    dropUndo(entry);
    await fail("Could not move the task", error);
    return false;
  }
}

export async function remove(task: Task): Promise<boolean> {
  const ok = await confirmAlert({
    title: "Delete this task?",
    message: task.title,
    primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
  });
  if (!ok) return false;
  commitSnapshot(removeTask(snapshot(), task.id));
  void successToast("Deleted", task.title, false);
  try {
    await writes.run(task.id, async () => (await openApi()).deleteTask(task.projectId, task.id));
    return true;
  } catch (error) {
    commitSnapshot(upsertTask(snapshot(), task));
    await fail("Could not delete the task", error);
    return false;
  }
}

export async function create(body: TaskPatch & { title: string }): Promise<Task | undefined> {
  try {
    const task = await (await openApi()).createTask(body);
    if (task?.id) commitSnapshot(upsertTask(snapshot(), task));
    return task;
  } catch (error) {
    await fail("Could not add the task", error);
    return undefined;
  }
}

async function applyUndo(entry: UndoEntry): Promise<boolean> {
  if (entry.kind === "move") {
    const task = findTask(entry.taskId);
    return task ? move(task, entry.fromProjectId, { undo: false }) : false;
  }
  if (entry.kind === "reopen") return reopen(findTask(entry.taskId) ?? entry.task);
  const task = findTask(entry.taskId) ?? { id: entry.taskId, projectId: entry.projectId, title: "" };
  return updateFields(task, entry.previous, entry.label, { undo: false });
}

/** The toast title after an undo, in words that say what the task is now. */
function undoneTitle(entry: UndoEntry): string {
  if (entry.kind === "reopen") return entry.label === "Complete" ? "Marked as not done" : "Reopened";
  if (entry.kind === "move") return "Moved back to the old list";
  return RESTORED[entry.label] ?? `${entry.label} undone`;
}

const RESTORED: Record<string, string> = {
  "Set date": "Old date restored",
  "Clear date": "Old date restored",
  "Set priority": "Old priority restored",
  "Change tags": "Old tags restored",
  Edit: "Old task details restored",
};

/** Reverts the last row write in this window. On failure the entry goes back on the stack. */
export async function undoLast(): Promise<void> {
  const entry = undo.pop();
  publishUndo();
  if (!entry) return;
  const title = findTask(entry.taskId)?.title ?? (entry.kind === "reopen" ? entry.task.title : undefined);
  void successToast(undoneTitle(entry), title, false);
  if (!(await applyUndo(entry))) pushUndo(entry);
}

export function setChecklist(task: Task, items: ChecklistItem[], label: string): Promise<boolean> {
  const patch: TaskPatch = { items: items.map((item, i) => ({ ...item, sortOrder: i })) };
  if (items.length && task.kind !== "CHECKLIST") patch.kind = "CHECKLIST";
  return updateFields(task, patch, label, { undo: false });
}

// v2 extras. The callers show these actions only when v2 is on.

/** The v2 client for a write. It throws when the v2 cookie is missing. */
async function v2ForWrite() {
  const v2 = await v2Api();
  if (!v2) throw new Error("Save a v2 cookie from the Account command.");
  return v2;
}

export async function wontDo(task: Task): Promise<void> {
  if (!prefs().enableV2) return;
  commitSnapshot(removeTask(snapshot(), task.id));
  const entry = pushUndo({ kind: "reopen", label: "Won't Do", taskId: task.id, projectId: task.projectId, task });
  void successToast("Won't Do", task.title, true);
  try {
    await writes.run(task.id, async () => (await v2ForWrite()).batchTask({ update: [{ id: task.id, projectId: task.projectId, status: -1 }] }));
  } catch (error) {
    commitSnapshot(upsertTask(snapshot(), task));
    dropUndo(entry);
    await fail("Could not mark the task Won't Do", error);
  }
}

export async function togglePin(task: Task): Promise<void> {
  if (!prefs().enableV2) return;
  const pinned = !!task.pinnedTime && task.pinnedTime !== "-1";
  const pinnedTime = pinned ? null : new Date().toISOString().replace("Z", "+0000");
  commitSnapshot(patchTask(snapshot(), task.id, { pinnedTime }));
  try {
    await writes.run(task.id, async () => (await v2ForWrite()).batchTask({ update: [{ id: task.id, projectId: task.projectId, pinnedTime }] }));
  } catch (error) {
    commitSnapshot(patchTask(snapshot(), task.id, { pinnedTime: task.pinnedTime ?? null }));
    await fail(pinned ? "Could not unpin" : "Could not pin", error);
  }
}

/**
 * Makes `task` a subtask of `parentId`, or a top-level task when `parentId` is empty.
 * It tries the Open API `parentId` field first, then the v2 endpoint when v2 is on.
 */
export async function setParent(task: Task, parentId: string): Promise<boolean> {
  const ok = await updateFields(task, { parentId }, parentId ? "Set parent" : "Remove parent", { undo: false });
  const v2 = await v2Api();
  if (v2 && parentId) {
    try {
      await v2.setParent(task.id, task.projectId, parentId);
    } catch (error) {
      await fail("The v2 parent link failed", error);
    }
  }
  return ok;
}

/** Creates a real subtask in the parent's list. */
export async function addSubtask(parent: Task, body: TaskPatch & { title: string }): Promise<Task | undefined> {
  const task = await create({ ...body, projectId: parent.projectId, parentId: parent.id });
  if (!task) return undefined;
  if (task.parentId !== parent.id) {
    const v2 = await v2Api();
    if (v2) await v2.setParent(task.id, task.projectId, parent.id).catch((e) => fail("The v2 parent link failed", e));
    commitSnapshot(patchTask(snapshot(), task.id, { parentId: parent.id }));
  }
  return task;
}
