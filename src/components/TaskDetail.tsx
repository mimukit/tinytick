import { Color, Icon, List } from "@raycast/api";
import { parseTickTickTime, reminderLabel } from "../api/dates";
import type { Task } from "../api/types";
import { projectName, type Snapshot } from "../store/snapshot";
import { checklistProgress, childTasks, isOverdue } from "../views/select";
import { PRIORITY_COLOR, dueText, priorityLabel, priorityOf, taskMarkdown } from "./format";

const STAMP = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function stamp(value: string | undefined): string | undefined {
  const date = parseTickTickTime(value);
  return date && STAMP.format(date);
}

/** The detail pane for a task row: notes and checklist, then every field of the task. */
export function TaskDetail({ task, snapshot }: { task: Task; snapshot: Snapshot }) {
  const M = List.Item.Detail.Metadata;
  const due = dueText(task);
  const progress = checklistProgress(task);
  const subtasks = childTasks(snapshot, task.id).length;
  const parent = task.parentId ? snapshot.tasks.find((t) => t.id === task.parentId) : undefined;
  const created = stamp(task.createdTime);
  const modified = stamp(task.modifiedTime);
  const completed = stamp(task.completedTime);
  return (
    <List.Item.Detail
      markdown={taskMarkdown(task)}
      metadata={
        <M>
          <M.Label title="List" icon={Icon.Folder} text={projectName(snapshot, task.projectId)} />
          <M.Label
            title="Date"
            icon={Icon.Calendar}
            text={due ? { value: due, color: isOverdue(task) ? Color.Red : Color.PrimaryText } : "No date"}
          />
          <M.Label title="Priority" icon={{ source: Icon.Flag, tintColor: PRIORITY_COLOR[priorityOf(task)] }} text={priorityLabel(task)} />
          {task.repeatFlag && <M.Label title="Repeat" icon={Icon.Repeat} text={task.repeatFlag.replace("RRULE:", "")} />}
          {!!task.reminders?.length && <M.Label title="Reminders" icon={Icon.Bell} text={task.reminders.map(reminderLabel).join(", ")} />}
          {!!task.tags?.length && (
            <M.TagList title="Tags">
              {task.tags.map((t) => (
                <M.TagList.Item key={t} text={`#${t}`} color={Color.Purple} />
              ))}
            </M.TagList>
          )}
          {progress && <M.Label title="Checklist" icon={Icon.CheckList} text={progress} />}
          {!!subtasks && <M.Label title="Subtasks" icon={Icon.List} text={String(subtasks)} />}
          {parent && <M.Label title="Parent" icon={Icon.ArrowUp} text={parent.title} />}
          {(created || modified || completed) && <M.Separator />}
          {completed && <M.Label title="Completed" text={completed} />}
          {created && <M.Label title="Created" text={created} />}
          {modified && <M.Label title="Updated" text={modified} />}
        </M>
      }
    />
  );
}
