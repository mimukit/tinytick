import { formatTickTickTime, startOfDay, addDays } from "../src/api/dates";
import type { Task } from "../src/api/types";
import { EMPTY_SNAPSHOT, type Snapshot } from "../src/store/snapshot";

// Wednesday 7 October 2026, 16:00 local time.
export const NOW = new Date(2026, 9, 7, 16, 0, 0);
export const TODAY = startOfDay(NOW);

export const day = (offset: number, hour?: number) => {
  const d = addDays(TODAY, offset);
  if (hour !== undefined) d.setHours(hour);
  return formatTickTickTime(d);
};

let n = 0;
export function task(partial: Partial<Task> = {}): Task {
  n += 1;
  return { id: `t${n}`, projectId: "p1", title: `Task ${n}`, status: 0, ...partial };
}

export function snapshotOf(tasks: Task[], extra: Partial<Snapshot> = {}): Snapshot {
  return {
    ...EMPTY_SNAPSHOT,
    syncedAt: NOW.getTime(),
    inboxId: "inbox1",
    projects: [
      { id: "p1", name: "Personal", sortOrder: 1 },
      { id: "p2", name: "Work", sortOrder: 2 },
    ],
    tasks,
    ...extra,
  };
}

/** A fake fetch that answers by "METHOD path" and records each call. */
export function fakeFetch(routes: Record<string, (body: unknown) => { status?: number; body?: unknown }>) {
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    const path = url.replace("https://api.ticktick.com", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[`${method} ${path}`];
    const reply = route ? route(body) : { status: 404, body: { error: "no route" } };
    const status = reply.status ?? 200;
    const text = reply.body === undefined ? "" : JSON.stringify(reply.body);
    return new Response(text || null, { status });
  };
  return { impl, calls };
}
