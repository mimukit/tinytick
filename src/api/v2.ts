// A small client for the unofficial TickTick web API (`/api/v2`). Every caller
// must check the `enableV2` preference first. The API is undocumented and can break.
import { API_BASE, type FetchLike } from "./client";
import { TickTickApiError } from "./errors";
import type { Project, ProjectGroup, Tag, Task } from "./types";

export interface V2CheckReply {
  checkPoint?: number;
  inboxId?: string;
  projectProfiles?: Project[];
  projectGroups?: ProjectGroup[];
  tags?: Tag[];
  syncTaskBean?: {
    update?: Task[];
    delete?: { taskId: string; projectId: string }[];
    empty?: boolean;
  };
}

export interface V2TaskBatch {
  add?: Partial<Task>[];
  update?: Partial<Task>[];
  delete?: { taskId: string; projectId: string }[];
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Accepts a bare `t` value, `t=...`, or a whole Cookie header, and returns the `t` value. */
export function normalizeSessionCookie(input: string): string {
  const trimmed = input.trim();
  const match = /(?:^|;\s*)t=([^;\s]+)/.exec(trimmed);
  return match ? match[1] : trimmed;
}

export class V2SessionError extends Error {
  constructor() {
    super("The TickTick v2 session expired. Paste a new session cookie in the Account command.");
    this.name = "V2SessionError";
  }
}

export class V2Api {
  constructor(
    private readonly cookie: string,
    private readonly deviceId: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        Cookie: `t=${normalizeSessionCookie(this.cookie)}`,
        "User-Agent": USER_AGENT,
        "X-Device": JSON.stringify({
          platform: "web",
          os: "macOS 10.15.7",
          device: "Chrome 124.0",
          name: "",
          version: 6430,
          id: this.deviceId,
          channel: "website",
          campaign: "",
          websocket: "",
        }),
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new V2SessionError();
    if (!res.ok) throw new TickTickApiError(res.status, path, text);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** `0` for a full sync, or a previous `checkPoint` for the changes since then. */
  batchCheck(checkPoint = 0): Promise<V2CheckReply> {
    return this.request<V2CheckReply>("GET", `/api/v2/batch/check/${checkPoint}`);
  }

  batchTask(batch: V2TaskBatch): Promise<unknown> {
    return this.request("POST", "/api/v2/batch/task", { add: [], update: [], delete: [], ...batch });
  }

  setParent(taskId: string, projectId: string, parentId: string): Promise<unknown> {
    return this.request("POST", "/api/v2/batch/taskParent", [{ taskId, projectId, parentId }]);
  }
}
