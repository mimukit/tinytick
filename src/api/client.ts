// A typed client for the official TickTick Open API (`/open/v1`).
import { TickTickApiError } from "./errors";
import type { Project, ProjectData, ProjectGroup, Tag, Task, TaskPatch } from "./types";

export const API_BASE = "https://api.ticktick.com";
export const WEB_BASE = "https://ticktick.com";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface Move {
  fromProjectId: string;
  toProjectId: string;
  taskId: string;
}

export interface DateRangeQuery {
  projectIds?: string[];
  startDate: string;
  endDate: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pulls a task array out of a reply that is either an array or `{ tasks }`. */
function taskArray(reply: unknown): Task[] {
  if (Array.isArray(reply)) return reply as Task[];
  if (reply && typeof reply === "object" && Array.isArray((reply as { tasks?: unknown }).tasks)) {
    return (reply as { tasks: Task[] }).tasks;
  }
  return [];
}

export class OpenApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly retryDelayMs = 1000,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < 2) {
        await sleep(this.retryDelayMs * (attempt + 1));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new TickTickApiError(res.status, path, text);
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }
  }

  listProjects(): Promise<Project[]> {
    return this.request<Project[]>("GET", "/open/v1/project").then((r) => r ?? []);
  }

  listProjectGroups(): Promise<ProjectGroup[]> {
    return this.request<ProjectGroup[]>("GET", "/open/v1/project/group").then((r) => (Array.isArray(r) ? r : []));
  }

  getProjectData(projectId: string): Promise<ProjectData> {
    return this.request<ProjectData>("GET", `/open/v1/project/${encodeURIComponent(projectId)}/data`).then((r) => r ?? {});
  }

  getInboxData(): Promise<ProjectData> {
    return this.request<ProjectData>("GET", "/open/v1/project/inbox/data").then((r) => r ?? {});
  }

  undoneTasks(query: DateRangeQuery): Promise<Task[]> {
    return this.request<unknown>("POST", "/open/v1/task/undone", query).then(taskArray);
  }

  completedTasks(query: DateRangeQuery): Promise<Task[]> {
    return this.request<unknown>("POST", "/open/v1/task/completed", query).then(taskArray);
  }

  searchTasks(keywords: string): Promise<Task[]> {
    return this.request<unknown>("POST", "/open/v1/task/search", { keywords }).then(taskArray);
  }

  async listTags(): Promise<Tag[]> {
    const reply = await this.request<unknown>("GET", "/open/v1/tag");
    if (!Array.isArray(reply)) return [];
    return reply
      .map((t) => (typeof t === "string" ? { name: t } : (t as Tag)))
      .filter((t) => t && typeof t.name === "string");
  }

  getTask(projectId: string, taskId: string): Promise<Task> {
    return this.request<Task>("GET", `/open/v1/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`);
  }

  createTask(task: TaskPatch & { title: string }): Promise<Task> {
    return this.request<Task>("POST", "/open/v1/task", task);
  }

  /** Sends only the given fields plus `id` and `projectId`. */
  updateTask(id: string, projectId: string, patch: TaskPatch): Promise<Task | undefined> {
    return this.request<Task | undefined>("POST", `/open/v1/task/${encodeURIComponent(id)}`, { ...patch, id, projectId });
  }

  completeTask(projectId: string, taskId: string): Promise<void> {
    return this.request<void>(
      "POST",
      `/open/v1/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
    );
  }

  deleteTask(projectId: string, taskId: string): Promise<void> {
    return this.request<void>("DELETE", `/open/v1/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`);
  }

  moveTasks(moves: Move[]): Promise<void> {
    return this.request<void>("POST", "/open/v1/task/move", moves);
  }
}

/** The TickTick web app URL for a task. */
export function taskWebUrl(task: Pick<Task, "id" | "projectId">): string {
  return `${WEB_BASE}/webapp/#p/${task.projectId}/tasks/${task.id}`;
}
