// Holds the row order of a list while you edit its tasks. Tinycast keeps the
// highlight on a row number, so a row that re-sorts away leaves the highlight
// on another task. The held order keeps each row where it was until a refresh.
import type { Task } from "../api/types";
import { isOpen } from "../store/snapshot";
import type { TaskSection } from "./select";

export interface SectionLayout {
  key: string;
  title: string;
  ids: string[];
}

export function layoutOf(sections: TaskSection[]): SectionLayout[] {
  return sections.map((s) => ({ key: s.key, title: s.title, ids: s.tasks.map((t) => t.id) }));
}

/**
 * The fresh sections in the held order. A held row keeps its section and place
 * with its latest data, even when an edit moves it out of the view. A completed
 * or deleted row drops. A new row goes after its fresh neighbour.
 */
export function holdSections(fresh: TaskSection[], held: SectionLayout[], tasks: Task[]): TaskSection[] {
  const byId = new Map(tasks.filter(isOpen).map((t) => [t.id, t]));
  const out: TaskSection[] = held.map((s) => ({
    key: s.key,
    title: s.title,
    tasks: s.ids.flatMap((id) => byId.get(id) ?? []),
  }));
  const placed = new Set(out.flatMap((s) => s.tasks.map((t) => t.id)));

  fresh.forEach((section, si) => {
    section.tasks.forEach((task, ti) => {
      if (placed.has(task.id)) return;
      let target = out.find((s) => s.key === section.key);
      if (!target) {
        target = { key: section.key, title: section.title, tasks: [] };
        const before = fresh.slice(0, si).reverse().find((f) => out.some((s) => s.key === f.key));
        out.splice(before ? out.findIndex((s) => s.key === before.key) + 1 : 0, 0, target);
      }
      const ids = target.tasks.map((t) => t.id);
      const neighbour = section.tasks.slice(0, ti).reverse().find((t) => ids.includes(t.id));
      target.tasks.splice(neighbour ? ids.indexOf(neighbour.id) + 1 : 0, 0, task);
      placed.add(task.id);
    });
  });
  return out.filter((s) => s.tasks.length);
}
