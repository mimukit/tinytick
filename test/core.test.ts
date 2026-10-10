import { describe, expect, it } from "vitest";
import { OpenApi } from "../src/api/client";
import { formatTickTickTime, nextMonday, parseTickTickTime, reminderLabel, taskDayKey } from "../src/api/dates";
import { TickTickApiError } from "../src/api/errors";
import { V2Api, normalizeSessionCookie } from "../src/api/v2";
import { applyV2Delta, isStale, mapLimit, snapshotFromV2, syncOpen, syncV2 } from "../src/store/snapshot";
import { UndoStack, previousFields } from "../src/undo/stack";
import { datePatch, diffFields, toggleTagPatch } from "../src/views/patches";
import { NOW, TODAY, day, fakeFetch, snapshotOf, task } from "./fixtures";

describe("dates", () => {
  it("round-trips the TickTick format with a +HHMM offset", () => {
    const s = formatTickTickTime(new Date(2026, 9, 8, 15, 0));
    expect(s).toMatch(/^2026-10-08T15:00:00\.000[+-]\d{4}$/);
    expect(parseTickTickTime(s)?.getTime()).toBe(new Date(2026, 9, 8, 15, 0).getTime());
  });

  it("reads an all-day date in the task's own zone", () => {
    // Midnight 8 Oct in Shanghai is 16:00 on 7 Oct in UTC.
    expect(taskDayKey("2026-10-07T16:00:00.000+0000", true, "Asia/Shanghai")).toBe("2026-10-08");
  });

  it("finds next Monday", () => {
    expect(nextMonday(TODAY).getDate()).toBe(12);
  });
});

describe("OpenApi", () => {
  it("sends the bearer token and only the changed fields on update", async () => {
    const f = fakeFetch({ "POST /open/v1/task/t1": (b) => ({ body: b }) });
    await new OpenApi("tok", f.impl).updateTask("t1", "p1", { priority: 5 });
    expect(f.calls[0].headers.Authorization).toBe("Bearer tok");
    expect(f.calls[0].body).toEqual({ priority: 5, id: "t1", projectId: "p1" });
  });

  it("retries a 429 and then succeeds", async () => {
    let n = 0;
    const f = fakeFetch({ "GET /open/v1/project": () => (n++ === 0 ? { status: 429 } : { body: [] }) });
    await expect(new OpenApi("tok", f.impl, 1).listProjects()).resolves.toEqual([]);
    expect(f.calls).toHaveLength(2);
  });

  it("throws an auth error on 401", async () => {
    const f = fakeFetch({ "GET /open/v1/project": () => ({ status: 401 }) });
    const error = await new OpenApi("tok", f.impl).listProjects().catch((e) => e);
    expect(error).toBeInstanceOf(TickTickApiError);
    expect(error.isAuth).toBe(true);
  });

  it("reads tags given as strings or objects", async () => {
    const f = fakeFetch({ "GET /open/v1/tag": () => ({ body: ["a", { name: "b" }] }) });
    expect(await new OpenApi("tok", f.impl).listTags()).toEqual([{ name: "a" }, { name: "b" }]);
  });
});

describe("syncOpen", () => {
  const routes = {
    "GET /open/v1/project": () => ({ body: [{ id: "p1", name: "Personal" }, { id: "p9", name: "Old", closed: true }] }),
    "GET /open/v1/project/group": () => ({ status: 404 }),
    "GET /open/v1/project/p1/data": () => ({ body: { tasks: [{ id: "a", projectId: "p1", title: "A", status: 0 }] } }),
    "GET /open/v1/tag": () => ({ body: [] }),
  };

  it("loads lists, the Inbox and tasks, and skips closed lists", async () => {
    const f = fakeFetch({
      ...routes,
      "GET /open/v1/project/inbox/data": () => ({ body: { tasks: [{ id: "i", projectId: "inbox42", title: "I", status: 0, tags: ["x"] }] } }),
    });
    const snap = await syncOpen(new OpenApi("tok", f.impl), undefined, NOW);
    expect(snap.inboxId).toBe("inbox42");
    expect(snap.projects.map((p) => p.id)).toEqual(["p1"]);
    expect(snap.tasks.map((t) => t.id).sort()).toEqual(["a", "i"]);
    expect(snap.tags).toEqual([{ name: "x" }]);
    expect(f.calls.some((c) => c.path.includes("p9"))).toBe(false);
  });

  it("falls back to /task/undone when the Inbox endpoint fails", async () => {
    const f = fakeFetch({
      ...routes,
      "POST /open/v1/task/undone": (b) => ({ body: (b as { projectIds: string[] }).projectIds[0] === "inbox" ? [{ id: "u", projectId: "inbox7", title: "U" }] : [] }),
    });
    const snap = await syncOpen(new OpenApi("tok", f.impl), undefined, NOW);
    expect(snap.inboxId).toBe("inbox7");
    expect(snap.tasks.map((t) => t.id)).toContain("u");
  });
});

describe("mapLimit", () => {
  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBe(4);
  });
});

describe("isStale", () => {
  const snap = snapshotOf([]);
  it("is stale after the refresh age", () => {
    expect(isStale(snap, "10", NOW.getTime() + 11 * 60_000)).toBe(true);
    expect(isStale(snap, "10", NOW.getTime() + 9 * 60_000)).toBe(false);
  });
  it("never refreshes on never, except an empty cache", () => {
    expect(isStale(snap, "never", NOW.getTime() + 1e9)).toBe(false);
    expect(isStale({ ...snap, syncedAt: 0 }, "never")).toBe(true);
  });
});

describe("v2", () => {
  it("normalizes a pasted cookie", () => {
    expect(normalizeSessionCookie("abc")).toBe("abc");
    expect(normalizeSessionCookie("t=abc")).toBe("abc");
    expect(normalizeSessionCookie("foo=1; t=abc; bar=2")).toBe("abc");
  });

  it("builds a snapshot from a full check", () => {
    const snap = snapshotFromV2(
      {
        checkPoint: 5,
        inboxId: "inbox1",
        projectProfiles: [{ id: "p1", name: "Personal" }],
        syncTaskBean: { update: [{ id: "a", projectId: "p1", title: "A", status: 0 }, { id: "b", projectId: "p1", title: "B", status: 2 }] },
      },
      NOW,
    );
    expect(snap.source).toBe("v2");
    expect(snap.checkPoint).toBe(5);
    expect(snap.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("applies a delta: updates, completions and deletions", () => {
    const base = snapshotOf([task({ id: "a" }), task({ id: "b" }), task({ id: "c" })], { source: "v2", checkPoint: 5 });
    const next = applyV2Delta(base, {
      checkPoint: 9,
      syncTaskBean: {
        update: [
          { id: "a", projectId: "p1", title: "A2", status: 0 },
          { id: "b", projectId: "p1", title: "B", status: 2 },
          { id: "d", projectId: "p1", title: "D", status: 0 },
        ],
        delete: [{ taskId: "c", projectId: "p1" }],
      },
    });
    expect(next.tasks.map((t) => `${t.id}:${t.title}`).sort()).toEqual(["a:A2", "d:D"]);
    expect(next.checkPoint).toBe(9);
  });

  it("asks for a delta with a checkpoint and a full sync without one", async () => {
    const f = fakeFetch({
      "GET /api/v2/batch/check/0": () => ({ body: { checkPoint: 3, syncTaskBean: { update: [] } } }),
      "GET /api/v2/batch/check/3": () => ({ body: { checkPoint: 4, syncTaskBean: { update: [] } } }),
    });
    const v2 = new V2Api("t=abc", "dev", f.impl);
    const first = await syncV2(v2, undefined, {}, NOW);
    const second = await syncV2(v2, first, {}, NOW);
    await syncV2(v2, second, { full: true }, NOW);
    expect(f.calls.map((c) => c.path)).toEqual(["/api/v2/batch/check/0", "/api/v2/batch/check/3", "/api/v2/batch/check/0"]);
    expect(f.calls[0].headers.Cookie).toBe("t=abc");
  });
});

describe("undo", () => {
  it("keeps the last 10 entries", () => {
    const stack = new UndoStack();
    for (let i = 0; i < 12; i++) stack.push({ kind: "reopen", label: `e${i}`, taskId: String(i), projectId: "p", task: task() });
    expect(stack.size).toBe(10);
    expect(stack.pop()?.label).toBe("e11");
    expect(stack.size).toBe(9);
  });

  it("records previous values, with null for a field that was not set", () => {
    const t = task({ priority: 3 });
    expect(previousFields(t, { priority: 5, dueDate: "x" })).toEqual({ priority: 3, dueDate: null });
  });
});

describe("patches", () => {
  it("moves an all-day task to a new day", () => {
    const t = task({ dueDate: day(0), isAllDay: true });
    const p = datePatch(t, new Date(2026, 9, 9));
    expect(p.dueDate).toMatch(/^2026-10-09T00:00:00/);
    expect(p.isAllDay).toBe(true);
  });

  it("keeps the time of a timed task and the length of a range", () => {
    const t = task({ startDate: day(0, 14), dueDate: day(0, 16), isAllDay: false });
    const p = datePatch(t, new Date(2026, 9, 9));
    expect(p.dueDate).toMatch(/^2026-10-09T16:00:00/);
    expect(p.startDate).toMatch(/^2026-10-09T14:00:00/);
    expect(p.isAllDay).toBe(false);
  });

  it("clears the dates", () => {
    expect(datePatch(task({ dueDate: day(0) }), null)).toMatchObject({ dueDate: null, startDate: null });
  });

  it("toggles a tag", () => {
    expect(toggleTagPatch(task({ tags: ["a"] }), "a")).toEqual({ tags: [] });
    expect(toggleTagPatch(task({ tags: ["a"] }), "b")).toEqual({ tags: ["a", "b"] });
  });

  it("diffs only changed fields, treating empty as unset", () => {
    const t = task({ title: "x", priority: 3 });
    expect(diffFields(t, { title: "x", priority: 5, content: "", tags: [] })).toEqual({ priority: 5 });
  });
});

describe("reminderLabel", () => {
  it("reads TickTick triggers", () => {
    expect(reminderLabel("TRIGGER:PT0S")).toBe("On time");
    expect(reminderLabel("TRIGGER:-PT30M")).toBe("30 min before");
    expect(reminderLabel("TRIGGER:-PT1H")).toBe("1 hour before");
    expect(reminderLabel("TRIGGER:-P1D")).toBe("1 day before");
    expect(reminderLabel("TRIGGER:-P2DT9H")).toBe("2 days 9 hours before");
    expect(reminderLabel("TRIGGER:P0DT9H0M0S")).toBe("9 hours after");
    expect(reminderLabel("odd")).toBe("odd");
  });
});
