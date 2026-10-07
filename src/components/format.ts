import { Color, Icon, type Image, type List } from "@raycast/api";
import { formatDueLabel, parseTickTickTime } from "../api/dates";
import type { Priority, Task } from "../api/types";
import { PRIORITY_LABEL } from "../parse/quickadd";
import { projectName, type Snapshot } from "../store/snapshot";
import { checklistProgress, isOverdue } from "../views/select";

export const PRIORITY_COLOR: Record<Priority, Color> = {
  0: Color.SecondaryText,
  1: Color.Blue,
  3: Color.Yellow,
  5: Color.Red,
};

export function priorityOf(task: Task): Priority {
  return (task.priority ?? 0) as Priority;
}

export function taskIcon(task: Task): Image.ImageLike {
  const done = (task.status ?? 0) !== 0;
  return {
    source: done ? Icon.CheckCircle : task.kind === "NOTE" ? Icon.Document : Icon.Circle,
    tintColor: PRIORITY_COLOR[priorityOf(task)],
  };
}

export function dueText(task: Task, now = new Date()): string | undefined {
  const due = parseTickTickTime(task.dueDate ?? task.startDate);
  if (!due) return undefined;
  const start = parseTickTickTime(task.startDate);
  const allDay = task.isAllDay !== false;
  if (start && task.dueDate && start.getTime() !== due.getTime()) {
    return `${formatDueLabel(start, allDay, now)} – ${formatDueLabel(due, allDay, now)}`;
  }
  return formatDueLabel(due, allDay, now);
}

export function taskAccessories(task: Task, snapshot: Snapshot, opts: { showList?: boolean; childCount?: number } = {}): List.Item.Accessory[] {
  const out: List.Item.Accessory[] = [];
  const pinned = !!task.pinnedTime && task.pinnedTime !== "-1";
  if (pinned) out.push({ icon: Icon.Pin, tooltip: "Pinned" });
  if (task.repeatFlag) out.push({ icon: Icon.Repeat, tooltip: "Repeats" });
  const progress = checklistProgress(task);
  if (progress) out.push({ icon: Icon.CheckList, text: progress, tooltip: "Checklist" });
  if (opts.childCount) out.push({ icon: Icon.List, text: String(opts.childCount), tooltip: "Subtasks" });
  for (const tag of (task.tags ?? []).slice(0, 2)) out.push({ tag: { value: `#${tag}`, color: Color.Purple } });
  if (opts.showList !== false) out.push({ text: { value: projectName(snapshot, task.projectId), color: Color.SecondaryText } });
  const due = dueText(task);
  if (due) out.push({ text: { value: due, color: isOverdue(task) ? Color.Red : Color.PrimaryText }, tooltip: "Due" });
  return out;
}

export function taskMarkdown(task: Task): string {
  const parts = [`## ${task.title}`];
  const body = (task.content || task.desc || "").trim();
  if (body) parts.push(body);
  const items = [...(task.items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (items.length) parts.push(items.map((i) => `- [${i.status === 1 ? "x" : " "}] ${i.title}`).join("\n"));
  return parts.join("\n\n");
}

export function priorityLabel(task: Task): string {
  return PRIORITY_LABEL[priorityOf(task)];
}
