// The local cache shape and the pure functions that fill and change it.
// No Raycast import here, so Vitest can run it in Node.
import type { OpenApi } from "../api/client";
import { addDays, formatTickTickTime, startOfDay } from "../api/dates";
import type { V2Api, V2CheckReply } from "../api/v2";
import type { Project, ProjectGroup, Tag, Task, TaskPatch } from "../api/types";

export interface Snapshot {
  version: 1;
  syncedAt: number;
  source: "open" | "v2";
  inboxId?: string;
  projects: Project[];
  groups: ProjectGroup[];
  tags: Tag[];
  /** Open tasks only. Completed tasks are fetched on demand. */
  tasks: Task[];
  /** v2 only: the point for the next delta sync. */
  checkPoint?: number;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  version: 1,
  syncedAt: 0,
  source: "open",
  projects: [],
  groups: [],
  tags: [],
  tasks: [],
};

export function isOpen(task: Task): boolean {
  return (task.status ?? 0) === 0;
}

/** Runs `fn` over `items` with at most `limit` calls in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function dedupe(tasks: Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const t of tasks) byId.set(t.id, t);
  return [...byId.values()];
}

function tagsFromTasks(tasks: Task[]): Tag[] {
  const names = new Set<string>();
  for (const t of tasks) for (const tag of t.tags ?? []) names.add(tag);
  return [...names].sort().map((name) => ({ name }));
}

function findInboxId(tasks: Task[], projects: Project[]): string | undefined {
  const known = new Set(projects.map((p) => p.id));
  return tasks.find((t) => !known.has(t.projectId) && t.projectId.startsWith("inbox"))?.projectId;
}

/**
 * Loads the Inbox. `GET /project/inbox/data` is not documented, so a failure
 * falls back to `POST /task/undone` with `"inbox"`, which only covers a 14-day window.
 */
export async function loadInbox(api: OpenApi, now = new Date()): Promise<{ tasks: Task[]; inboxId?: string }> {
  try {
    const data = await api.getInboxData();
    const tasks = data.tasks ?? [];
    return { tasks, inboxId: data.project?.id ?? tasks[0]?.projectId };
  } catch {
    const today = startOfDay(now);
    const tasks = await api.undoneTasks({
      projectIds: ["inbox"],
      startDate: formatTickTickTime(addDays(today, -7)),
      endDate: formatTickTickTime(addDays(today, 7)),
    });
    return { tasks, inboxId: tasks[0]?.projectId };
  }
}

/** A full sync over the Open API: one call per list, four at a time. */
export async function syncOpen(api: OpenApi, previous?: Snapshot, now = new Date()): Promise<Snapshot> {
  const projects = (await api.listProjects()).filter((p) => !p.closed);
  const [groups, inbox, perProject, tags] = await Promise.all([
    api.listProjectGroups().catch(() => [] as ProjectGroup[]),
    loadInbox(api, now),
    mapLimit(projects, 4, (p) => api.getProjectData(p.id).then((d) => d.tasks ?? [])),
    api.listTags().catch(() => [] as Tag[]),
  ]);
  const tasks = dedupe([...inbox.tasks, ...perProject.flat()]).filter(isOpen);
  return {
    version: 1,
    syncedAt: now.getTime(),
    source: "open",
    inboxId: inbox.inboxId ?? findInboxId(tasks, projects) ?? previous?.inboxId,
    projects,
    groups,
    tags: tags.length ? tags : tagsFromTasks(tasks),
    tasks,
  };
}

/** Builds a snapshot from a v2 full check. */
export function snapshotFromV2(reply: V2CheckReply, now = new Date()): Snapshot {
  const tasks = (reply.syncTaskBean?.update ?? []).filter(isOpen);
  const projects = (reply.projectProfiles ?? []).filter((p) => !p.closed);
  return {
    version: 1,
    syncedAt: now.getTime(),
    source: "v2",
    inboxId: reply.inboxId ?? findInboxId(tasks, projects),
    projects,
    groups: reply.projectGroups ?? [],
    tags: reply.tags?.length ? reply.tags : tagsFromTasks(tasks),
    tasks,
    checkPoint: reply.checkPoint,
  };
}

/** Applies a v2 delta check to a snapshot. */
export function applyV2Delta(snapshot: Snapshot, reply: V2CheckReply, now = new Date()): Snapshot {
  let next = snapshot;
  for (const task of reply.syncTaskBean?.update ?? []) {
    next = isOpen(task) ? upsertTask(next, task) : removeTask(next, task.id);
  }
  for (const gone of reply.syncTaskBean?.delete ?? []) next = removeTask(next, gone.taskId);
  const projects = new Map(next.projects.map((p) => [p.id, p]));
  for (const p of reply.projectProfiles ?? []) {
    if (p.closed) projects.delete(p.id);
    else projects.set(p.id, p);
  }
  return {
    ...next,
    syncedAt: now.getTime(),
    source: "v2",
    projects: [...projects.values()],
    groups: reply.projectGroups?.length ? reply.projectGroups : next.groups,
    tags: reply.tags?.length ? reply.tags : next.tags,
    inboxId: reply.inboxId ?? next.inboxId,
    checkPoint: reply.checkPoint ?? next.checkPoint,
  };
}

/** A one-call v2 sync. With a previous v2 checkpoint it asks for the delta only. */
export async function syncV2(v2: V2Api, previous?: Snapshot, opts: { full?: boolean } = {}, now = new Date()): Promise<Snapshot> {
  const canDelta = !opts.full && previous?.source === "v2" && typeof previous.checkPoint === "number" && previous.checkPoint > 0;
  if (canDelta) return applyV2Delta(previous, await v2.batchCheck(previous.checkPoint), now);
  return snapshotFromV2(await v2.batchCheck(0), now);
}

export function upsertTask(snapshot: Snapshot, task: Task): Snapshot {
  const exists = snapshot.tasks.some((t) => t.id === task.id);
  return {
    ...snapshot,
    tasks: exists ? snapshot.tasks.map((t) => (t.id === task.id ? task : t)) : [...snapshot.tasks, task],
  };
}

export function removeTask(snapshot: Snapshot, taskId: string): Snapshot {
  return { ...snapshot, tasks: snapshot.tasks.filter((t) => t.id !== taskId) };
}

export function patchTask(snapshot: Snapshot, taskId: string, patch: TaskPatch): Snapshot {
  return { ...snapshot, tasks: snapshot.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) };
}

/** Replaces the open tasks of one list, as after a refetch of that list. */
export function replaceProjectTasks(snapshot: Snapshot, projectId: string, tasks: Task[]): Snapshot {
  return {
    ...snapshot,
    tasks: [...snapshot.tasks.filter((t) => t.projectId !== projectId), ...tasks.filter(isOpen)],
  };
}

export function projectName(snapshot: Snapshot, projectId: string): string {
  if (projectId === snapshot.inboxId) return "Inbox";
  return snapshot.projects.find((p) => p.id === projectId)?.name ?? (projectId.startsWith("inbox") ? "Inbox" : "Unknown list");
}

export function parseSnapshot(raw: string | undefined): Snapshot | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Snapshot;
    return value && value.version === 1 && Array.isArray(value.tasks) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function isStale(snapshot: Snapshot, refreshAge: string, now = Date.now()): boolean {
  if (snapshot.syncedAt === 0) return true;
  if (refreshAge === "never") return false;
  const minutes = Number(refreshAge) || 10;
  return now - snapshot.syncedAt > minutes * 60_000;
}
