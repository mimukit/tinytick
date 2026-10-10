// Pure view logic: which tasks a view shows, how they group, how they sort.
import { addDays, dayKey, formatDueLabel, parseTickTickTime, startOfDay, taskDayKey } from "../api/dates";
import type { Task } from "../api/types";
import { isOpen, projectName, type Snapshot } from "../store/snapshot";

export type ViewId = "today" | "tomorrow" | "next7" | "inbox" | "all" | `project:${string}` | `completed:${string}`;
export type GroupBy = "none" | "time" | "list" | "priority" | "tag";
export type SortBy = "date" | "priority" | "title" | "list" | "created";

export const VIEW_TITLES: Record<string, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  next7: "Next 7 Days",
  inbox: "Inbox",
  all: "All",
};

/** Completed views, by how many days before today they reach back. */
export const COMPLETED_RANGES: Record<string, { title: string; days: number }> = {
  today: { title: "Completed Today", days: 0 },
  yesterday: { title: "Completed Since Yesterday", days: 1 },
  week: { title: "Completed Last 7 Days", days: 6 },
  month: { title: "Completed Last 30 Days", days: 29 },
};

export const GROUP_TITLES: Record<GroupBy, string> = {
  none: "None",
  time: "Time",
  list: "List",
  priority: "Priority",
  tag: "Tag",
};

export const SORT_TITLES: Record<SortBy, string> = {
  date: "Date",
  priority: "Priority",
  title: "Title",
  list: "List",
  created: "Created",
};

interface TaskDays {
  start?: string;
  due?: string;
}

function days(task: Task): TaskDays {
  const due = taskDayKey(task.dueDate, task.isAllDay, task.timeZone);
  const start = taskDayKey(task.startDate, task.isAllDay, task.timeZone) ?? due;
  return { start, due: due ?? start };
}

/** True when the task is due before today. A range task is overdue when its due day passed. */
export function isOverdue(task: Task, now = new Date()): boolean {
  const { due } = days(task);
  return !!due && due < dayKey(now);
}

/**
 * The Today rule, matching TickTick: due today, overdue, or a start-to-due range that covers today.
 */
export function isInDayWindow(task: Task, from: string, to: string): boolean {
  const { start, due } = days(task);
  if (!due) return false;
  return (start ?? due) <= to && due >= from;
}

export function selectView(snapshot: Snapshot, view: ViewId, now = new Date()): Task[] {
  const today = dayKey(now);
  const open = snapshot.tasks.filter(isOpen);
  switch (view) {
    case "today":
      return open.filter((t) => isOverdue(t, now) || isInDayWindow(t, today, today));
    case "tomorrow": {
      const tomorrow = dayKey(addDays(startOfDay(now), 1));
      return open.filter((t) => isInDayWindow(t, tomorrow, tomorrow));
    }
    case "next7": {
      const end = dayKey(addDays(startOfDay(now), 6));
      return open.filter((t) => isOverdue(t, now) || isInDayWindow(t, today, end));
    }
    case "inbox":
      return open.filter((t) => t.projectId === snapshot.inboxId || (!snapshot.inboxId && t.projectId.startsWith("inbox")));
    case "all":
      return open;
    default: {
      // Completed views come from the server, not from the cache.
      if (view.startsWith("completed:")) return [];
      const projectId = view.slice("project:".length);
      return open.filter((t) => t.projectId === projectId);
    }
  }
}

function dueTime(task: Task): number {
  return parseTickTickTime(task.dueDate ?? task.startDate)?.getTime() ?? Number.POSITIVE_INFINITY;
}

function isPinned(task: Task): boolean {
  return !!task.pinnedTime && task.pinnedTime !== "-1";
}

export function sortTasks(tasks: Task[], sortBy: SortBy, snapshot: Snapshot): Task[] {
  const order = new Map(snapshot.projects.map((p, i) => [p.id, p.sortOrder ?? i]));
  const byDate = (a: Task, b: Task) => dueTime(a) - dueTime(b);
  const byPriority = (a: Task, b: Task) => (b.priority ?? 0) - (a.priority ?? 0);
  const byTitle = (a: Task, b: Task) => a.title.localeCompare(b.title);
  const compare: Record<SortBy, (a: Task, b: Task) => number> = {
    date: (a, b) => byDate(a, b) || byPriority(a, b) || byTitle(a, b),
    priority: (a, b) => byPriority(a, b) || byDate(a, b) || byTitle(a, b),
    title: byTitle,
    list: (a, b) =>
      (a.projectId === snapshot.inboxId ? -Infinity : order.get(a.projectId) ?? 0) -
        (b.projectId === snapshot.inboxId ? -Infinity : order.get(b.projectId) ?? 0) ||
      byDate(a, b),
    created: (a, b) =>
      (parseTickTickTime(b.createdTime)?.getTime() ?? 0) - (parseTickTickTime(a.createdTime)?.getTime() ?? 0) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  };
  return [...tasks].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)) || compare[sortBy](a, b));
}

export interface TaskSection {
  key: string;
  title: string;
  tasks: Task[];
}

const PRIORITY_SECTION: Record<number, string> = { 5: "High", 3: "Medium", 1: "Low", 0: "No Priority" };

function timeSection(task: Task, now: Date): { key: string; title: string } {
  if (isOverdue(task, now)) return { key: "z-overdue", title: "Overdue" };
  const today = dayKey(now);
  const { start, due } = days(task);
  if (!due) return { key: "9-nodate", title: "No Date" };
  if ((start ?? due) <= today && due >= today) return { key: "1-today", title: "Today" };
  const first = start && start > today ? start : due;
  const tomorrow = dayKey(addDays(startOfDay(now), 1));
  if (first === tomorrow) return { key: "2-tomorrow", title: "Tomorrow" };
  const week = dayKey(addDays(startOfDay(now), 6));
  if (first <= week) {
    const date = parseTickTickTime(task.startDate ?? task.dueDate)!;
    return { key: `3-${first}`, title: formatDueLabel(date, true, now) };
  }
  return { key: "8-later", title: "Later" };
}

/** Groups already-sorted tasks. Sections keep the order of their first task, except fixed orders below. */
export function groupTasks(tasks: Task[], groupBy: GroupBy, snapshot: Snapshot, now = new Date()): TaskSection[] {
  if (groupBy === "none") return tasks.length ? [{ key: "all", title: "", tasks }] : [];
  const sections = new Map<string, TaskSection>();
  const add = (key: string, title: string, task: Task) => {
    const section = sections.get(key) ?? { key, title, tasks: [] };
    section.tasks.push(task);
    sections.set(key, section);
  };
  for (const task of tasks) {
    if (groupBy === "time") {
      const s = timeSection(task, now);
      add(s.key, s.title, task);
    } else if (groupBy === "list") {
      add(`list-${task.projectId}`, projectName(snapshot, task.projectId), task);
    } else if (groupBy === "priority") {
      const p = task.priority ?? 0;
      add(`prio-${9 - p}`, PRIORITY_SECTION[p] ?? "No Priority", task);
    } else {
      const tag = task.tags?.[0];
      add(tag ? `tag-a-${tag}` : "tag-z", tag ? `#${tag}` : "No Tag", task);
    }
  }
  const list = [...sections.values()];
  if (groupBy === "time" || groupBy === "priority") list.sort((a, b) => a.key.localeCompare(b.key));
  if (groupBy === "tag") list.sort((a, b) => a.key.localeCompare(b.key));
  return list;
}

/** Child tasks of a task, by `parentId`. */
export function childTasks(snapshot: Snapshot, parentId: string): Task[] {
  return snapshot.tasks.filter((t) => t.parentId === parentId);
}

/** "3/5" for a task with checklist items, else undefined. */
export function checklistProgress(task: Task): string | undefined {
  const items = task.items ?? [];
  if (!items.length) return undefined;
  return `${items.filter((i) => i.status === 1).length}/${items.length}`;
}

/** Counts for the menu bar: overdue and today. */