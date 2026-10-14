import { describe, expect, it } from "vitest";
import { WriteQueue } from "../src/api/queue";
import { UndoStack } from "../src/undo/stack";
import { task } from "./fixtures";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("write queue", () => {
  it("starts a write for a task only after the earlier one settles", async () => {
    const q = new WriteQueue();
    const order: string[] = [];
    const first = deferred();
    const a = q.run("t1", async () => {
      order.push("a start");
      await first.promise;
      order.push("a end");
    });
    const b = q.run("t1", async () => {
      order.push("b start");
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["a start"]);
    expect(q.pending("t1")).toBe(2);
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a start", "a end", "b start"]);
    expect(q.pending("t1")).toBe(0);
  });

  it("runs the next write when the earlier one fails, and keeps the failure for its caller", async () => {
    const q = new WriteQueue();
    const a = q.run("t1", async () => {
      throw new Error("boom");
    });
    const b = q.run("t1", async () => "ok");
    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("ok");
  });

  it("does not hold a write behind a write for another task", async () => {
    const q = new WriteQueue();
    const first = deferred();
    void q.run("t1", () => first.promise);
    await expect(q.run("t2", async () => "ok")).resolves.toBe("ok");
    first.resolve();
  });

  it("counts only the later writes once a caller resumes", async () => {
    const q = new WriteQueue();
    const a = q.run("t1", async () => undefined);
    const second = deferred();
    void q.run("t1", () => second.promise);
    await a;
    expect(q.pending("t1")).toBe(1);
    second.resolve();
  });
});

describe("undo remove", () => {
  it("drops one entry and keeps the others in order", () => {
    const stack = new UndoStack();
    const a = { kind: "reopen" as const, label: "a", taskId: "1", projectId: "p", task: task() };
    const b = { kind: "reopen" as const, label: "b", taskId: "2", projectId: "p", task: task() };
    stack.push(a);
    stack.push(b);
    stack.remove(a);
    expect(stack.size).toBe(1);
    expect(stack.peek()).toBe(b);
  });
});
