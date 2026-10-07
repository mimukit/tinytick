// Pure builders for the field patches the row actions send.
import { formatTickTickTime, parseTickTickTime, startOfDay, withTimeOf } from "../api/dates";
import type { Task, TaskPatch } from "../api/types";

/**
 * Moves a task to a new day. A timed task keeps its time of day, and a range
 * keeps its length. `null` clears the dates.
 */
export function datePatch(task: Task, day: Date | null): TaskPatch {
  if (!day) {
    return { dueDate: null, startDate: null, isAllDay: false } as unknown as TaskPatch;
  }
  const oldDue = parseTickTickTime(task.dueDate);
  const oldStart = parseTickTickTime(task.startDate);
  const timed = !!oldDue && task.isAllDay === false;
  const newDue = timed ? withTimeOf(day, oldDue!) : startOfDay(day);
  const patch: TaskPatch = {
    dueDate: formatTickTickTime(newDue),
    isAllDay: !timed,
    timeZone: task.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  if (oldStart && oldDue && oldStart.getTime() !== oldDue.getTime()) {
    patch.startDate = formatTickTickTime(new Date(newDue.getTime() - (oldDue.getTime() - oldStart.getTime())));
  } else {
    patch.startDate = patch.dueDate;
  }
  return patch;
}

/** Sets an exact due date and time from a form. */
export function exactDatePatch(due: Date, allDay: boolean, start?: Date | null): TaskPatch {
  const dueValue = formatTickTickTime(allDay ? startOfDay(due) : due);
  return {
    dueDate: dueValue,
    startDate: start ? formatTickTickTime(allDay ? startOfDay(start) : start) : dueValue,
    isAllDay: allDay,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function toggleTagPatch(task: Task, tag: string): TaskPatch {
  const tags = task.tags ?? [];
  return { tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] };
}

/** An empty string, an empty list and a missing value all mean "not set". */
function normalized(value: unknown): string {
  if (value === undefined || value === null || value === "") return "null";
  if (Array.isArray(value) && value.length === 0) return "null";
  return JSON.stringify(value);
}

/** The fields whose values differ between a task and an edited copy. */
export function diffFields(before: Task, after: TaskPatch): TaskPatch {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    const old = (before as unknown as Record<string, unknown>)[key];
    if (normalized(old) !== normalized(value)) patch[key] = value;
  }
  return patch as TaskPatch;
}
