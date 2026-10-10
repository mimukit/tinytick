import { describe, expect, it } from "vitest";
import { checklistProgress, groupTasks, isOverdue, selectView, sortTasks, todayCounts } from "../src/views/select";
import { NOW, day, snapshotOf, task } from "./fixtures";

describe("selectView today", () => {
  const dueToday = task({ title: "due today", dueDate: day(0), isAllDay: true });
  const overdue = task({ title: "overdue", dueDate: day(-2), isAllDay: true });
  const range = task({ title: "range", startDate: day(-1, 9), dueDate: day(2, 17), isAllDay: false });
  const future = task({ title: "future", dueDate: day(3), isAllDay: true });
  const noDate = task({ title: "no date" });
  const done = task({ title: "done", dueDate: day(0), status: 2 });
  const snap = snapshotOf([dueToday, overdue, range, future, noDate, done]);

  it("includes due today, overdue, and a range that covers today", () => {
    const titles = selectView(snap, "today", NOW).map((t) => t.title).sort();
    expect(titles).toEqual(["due today", "overdue", "range"]);
  });

  it("keeps a range that covers today out of Overdue", () => {
    expect(isOverdue(range, NOW)).toBe(false);
    expect(isOverdue(overdue, NOW)).toBe(true);
  });

  it("counts overdue and today for the menu bar", () => {
    expect(todayCounts(snap, NOW)).toEqual({ overdue: 1, today: 2 });
  });

  it("selects tomorrow, next 7 days, inbox and a list", () => {
    const inboxTask = task({ projectId: "inbox1", title: "inbox" });
    const s = snapshotOf([...snap.tasks, inboxTask, task({ projectId: "p2", title: "work", dueDate: day(1) })]);
    expect(selectView(s, "tomorrow", NOW).map((t) => t.title).sort()).toEqual(["range", "work"]);
    expect(selectView(s, "next7", NOW).map((t) => t.title)).toContain("future");
    expect(selectView(s, "inbox", NOW).map((t) => t.title)).toEqual(["inbox"]);
    expect(selectView(s, "project:p2", NOW).map((t) => t.title)).toEqual(["work"]);
  });
});

describe("sortTasks", () => {
  const a = task({ title: "b", priority: 1, dueDate: day(0, 9), isAllDay: false });
  const b = task({ title: "a", priority: 5, dueDate: day(0, 15), isAllDay: false });
  const c = task({ title: "c", priority: 3 });
  const snap = snapshotOf([a, b, c]);

  it("sorts by date with undated last", () => {
    expect(sortTasks([c, b, a], "date", snap).map((t) => t.title)).toEqual(["b", "a", "c"]);
  });

  it("sorts by priority, high first", () => {
    expect(sortTasks([a, b, c], "priority", snap).map((t) => t.title)).toEqual(["a", "c", "b"]);
  });

  it("sorts by title", () => {
    expect(sortTasks([c, a, b], "title", snap).map((t) => t.title)).toEqual(["a", "b", "c"]);
  });

  it("puts a pinned task first", () => {
    const pinned = task({ title: "z", pinnedTime: "2026-10-01T00:00:00.000+0000" });
    expect(sortTasks([a, pinned], "title", snapshotOf([a, pinned]))[0].title).toBe("z");
  });
});

describe("groupTasks", () => {
  const overdue = task({ title: "o", dueDate: day(-1), isAllDay: true, priority: 5, tags: ["x"] });
  const today = task({ title: "t", dueDate: day(0), isAllDay: true, projectId: "p2" });
  const snap = snapshotOf([overdue, today]);

  it("groups by time with Overdue last", () => {
    expect(groupTasks([today, overdue], "time", snap, NOW).map((s) => s.title)).toEqual(["Today", "Overdue"]);
  });

  it("groups by list", () => {
    expect(groupTasks([overdue, today], "list", snap, NOW).map((s) => s.title)).toEqual(["Personal", "Work"]);
  });

  it("groups by priority, high first", () => {
    expect(groupTasks([today, overdue], "priority", snap, NOW).map((s) => s.title)).toEqual(["High", "No Priority"]);
  });

  it("groups by first tag", () => {
    expect(groupTasks([today, overdue], "tag", snap, NOW).map((s) => s.title)).toEqual(["#x", "No Tag"]);
  });

  it("puts everything in one section for none", () => {
    expect(groupTasks([today, overdue], "none", snap, NOW)).toHaveLength(1);
  });
});

describe("checklistProgress", () => {
  it("counts checked items", () => {
    const t = task({
      items: [
        { id: "1", title: "a", status: 1 },
        { id: "2", title: "b", status: 0 },
        { id: "3", title: "c", status: 1 },
      ],
    });
    expect(checklistProgress(t)).toBe("2/3");
    expect(checklistProgress(task())).toBeUndefined();
  });
});
