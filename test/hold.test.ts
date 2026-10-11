import { describe, expect, it } from "vitest";
import { holdSections, layoutOf } from "../src/views/hold";
import { groupTasks } from "../src/views/select";
import { snapshotOf, task } from "./fixtures";

const titles = (sections: { title: string; tasks: { title: string }[] }[]) => sections.map((s) => [s.title, s.tasks.map((t) => t.title)]);

describe("holdSections", () => {
  const a = task({ title: "a", priority: 5 });
  const b = task({ title: "b", priority: 5 });
  const c = task({ title: "c", priority: 1 });
  const before = snapshotOf([a, b, c]);
  const held = layoutOf(groupTasks(before.tasks, "priority", before));

  it("keeps an edited row in its old section and place, with its new data", () => {
    const tasks = [a, { ...b, priority: 1 as const }, c];
    const fresh = groupTasks(tasks, "priority", snapshotOf(tasks));
    const out = holdSections(fresh, held, tasks);
    expect(titles(out)).toEqual([
      ["High", ["a", "b"]],
      ["Low", ["c"]],
    ]);
    expect(out[0].tasks[1].priority).toBe(1);
  });

  it("drops a completed or deleted row and an empty section", () => {
    const tasks = [a, { ...b, status: 2 as const }];
    const out = holdSections(groupTasks([a], "priority", snapshotOf(tasks)), held, tasks);
    expect(titles(out)).toEqual([["High", ["a"]]]);
  });

  it("keeps a row that an edit moved out of the view", () => {
    const tasks = [a, b, c];
    const out = holdSections(groupTasks([a, c], "priority", snapshotOf(tasks)), held, tasks);
    expect(titles(out)).toEqual([
      ["High", ["a", "b"]],
      ["Low", ["c"]],
    ]);
  });

  it("puts a new row after its fresh neighbour, and a new section in fresh order", () => {
    const d = task({ title: "d", priority: 5 });
    const e = task({ title: "e", priority: 3 });
    const tasks = [a, d, b, e, c];
    const out = holdSections(groupTasks(tasks, "priority", snapshotOf(tasks)), held, tasks);
    expect(titles(out)).toEqual([
      ["High", ["a", "d", "b"]],
      ["Medium", ["e"]],
      ["Low", ["c"]],
    ]);
  });
});
