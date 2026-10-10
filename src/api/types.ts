// TickTick data model, as documented at developer.ticktick.com/docs/openapi.md.

/** 0 none, 1 low, 3 medium, 5 high. */
export type Priority = 0 | 1 | 3 | 5;

/** 0 open, 2 completed, -1 Won't Do. */
export type TaskStatus = 0 | 2 | -1;

export interface ChecklistItem {
  id: string;
  title: string;
  /** 0 open, 1 checked. */
  status: 0 | 1;
  sortOrder?: number;
  startDate?: string;
  isAllDay?: boolean;
  timeZone?: string;
  completedTime?: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  priority?: Priority;
  reminders?: string[];
  repeatFlag?: string;
  tags?: string[];
  status?: TaskStatus;
  kind?: "TEXT" | "NOTE" | "CHECKLIST";
  parentId?: string;
  items?: ChecklistItem[];
  sortOrder?: number;
  completedTime?: string;
  createdTime?: string;
  modifiedTime?: string;
  etag?: string;
  /** v2 only. Set when the task is pinned. */
  pinnedTime?: string | null;
}

export interface Project {
  id: string;
  name: string;
  color?: string;
  sortOrder?: number;
  closed?: boolean;
  groupId?: string;
  kind?: "TASK" | "NOTE";
  viewMode?: string;
}

export interface ProjectGroup {
  id: string;
  name: string;
  sortOrder?: number;
}

export interface Tag {
  name: string;
  label?: string;
  color?: string;
}

export interface ProjectData {
  project?: Project;
  tasks?: Task[];
}

/** The fields a write may change. */
export type TaskPatch = Partial<Omit<Task, "id">>;
