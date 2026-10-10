import { Action, ActionPanel, Color, Form, Icon, List, useNavigation } from "@raycast/api";
import { useState } from "react";
import { formatTickTickTime } from "../api/dates";
import type { ChecklistItem, Task } from "../api/types";
import { newObjectId } from "../parse/quickadd";
import { addSubtask, create, setChecklist, setParent } from "../store/actions";
import { useLive } from "../store/live";
import { checklistProgress, childTasks } from "../views/select";
import { taskAccessories, taskIcon } from "./format";
import { Picker } from "./Picker";
import { TaskActions } from "./TaskActions";
import { TaskDetail } from "./TaskDetail";

function sortedItems(task: Task): ChecklistItem[] {
  return [...(task.items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function useTask(taskId: string, fallback?: Task): Task | undefined {
  const { snapshot } = useLive();
  return snapshot.tasks.find((t) => t.id === taskId) ?? fallback;
}

export async function addChecklistItem(task: Task, title: string): Promise<boolean> {
  const items = sortedItems(task);
  return setChecklist(task, [...items, { id: newObjectId(), title: title.trim(), status: 0 }], "Add item");
}

/** The task screen: details, then checklist items, then subtasks. */
export function TaskScreen({ taskId, fallback }: { taskId: string; fallback?: Task }) {
  const task = useTask(taskId, fallback);
  const { snapshot } = useLive();
  const [text, setText] = useState("");

  if (!task) {
    return (
      <List>
        <List.EmptyView title="This task is no longer in the cache" description="It may be completed or deleted. Sync to refresh." />
      </List>
    );
  }

  const items = sortedItems(task);
  const children = childTasks(snapshot, task.id);
  const progress = checklistProgress(task);
  const siblings = snapshot.tasks.filter((t) => t.projectId === task.projectId && t.id !== task.id && t.parentId !== task.id);

  const toggle = (item: ChecklistItem) =>
    setChecklist(
      task,
      items.map((i) =>
        i.id === item.id ? { ...i, status: i.status === 1 ? 0 : 1, completedTime: i.status === 1 ? undefined : formatTickTickTime(new Date()) } : i,
      ),
      item.status === 1 ? "Uncheck item" : "Check item",
    );
  const removeItem = (item: ChecklistItem) => setChecklist(task, items.filter((i) => i.id !== item.id), "Delete item");
  const shift = (item: ChecklistItem, by: -1 | 1) => {
    const i = items.findIndex((x) => x.id === item.id);
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    void setChecklist(task, next, "Reorder items");
  };
  const toTask = async (item: ChecklistItem) => {
    const created = await create({ title: item.title, projectId: task.projectId });
    if (created) await removeItem(item);
  };

  const addAction = text.trim() ? (
    <Action
      title="Add Item"
      icon={Icon.Plus}
      onAction={async () => {
        const value = text;
        setText("");
        await addChecklistItem(task, value);
      }}
    />
  ) : null;

  const structureActions = (
    <ActionPanel.Section title="Structure">
      {text.trim() && (
        <Action
          title="Add as Subtask"
          icon={Icon.List}
          shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
          onAction={async () => {
            const value = text;
            setText("");
            await addSubtask(task, { title: value.trim() });
          }}
        />
      )}
      <Action.Push
        title="Set Parent Task…"
        icon={Icon.ArrowUp}
        target={
          <Picker
            title="Set Parent Task"
            options={siblings.map((s) => ({ id: s.id, title: s.title, selected: s.id === task.parentId, onPick: () => setParent(task, s.id) }))}
          />
        }
      />
      {task.parentId && <Action title="Remove Parent" icon={Icon.ArrowDown} onAction={() => void setParent(task, "")} />}
    </ActionPanel.Section>
  );

  return (
    <List
      navigationTitle={task.title}
      searchBarPlaceholder="Add a checklist item…"
      searchText={text}
      onSearchTextChange={setText}
      filtering={false}
      isShowingDetail
    >
      {text.trim() && (
        <List.Item
          id="add"
          title={`Add “${text.trim()}”`}
          icon={Icon.Plus}
          actions={
            <ActionPanel>
              {addAction}
              {structureActions}
            </ActionPanel>
          }
        />
      )}
      <List.Section title="Task">
        <List.Item
          id={`task-${task.id}`}
          title={task.title}
          icon={taskIcon(task)}
          detail={<TaskDetail task={task} snapshot={snapshot} />}
          actions={
            (task.status ?? 0) === 0 ? (
              <TaskActions task={task} />
            ) : (
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Title" content={task.title} />
              </ActionPanel>
            )
          }
        />
      </List.Section>
      <List.Section title={progress ? `Checklist ${progress}` : "Checklist"}>
        {items.map((item, index) => (
          <List.Item
            key={item.id}
            id={`item-${item.id}`}
            title={item.title}
            icon={item.status === 1 ? { source: Icon.CheckCircle, tintColor: Color.Green } : Icon.Circle}
            detail={<TaskDetail task={task} snapshot={snapshot} />}
            actions={
              <ActionPanel>
                {addAction}
                <Action title={item.status === 1 ? "Uncheck" : "Check"} icon={Icon.CheckCircle} onAction={() => void toggle(item)} />
                <ActionPanel.Section>
                  <Action.Push
                    title="Rename"
                    icon={Icon.Pencil}
                    shortcut={{ modifiers: ["cmd"], key: "e" }}
                    target={<RenameItemForm task={task} item={item} />}
                  />
                  {index > 0 && (
                    <Action title="Move Up" icon={Icon.ArrowUp} shortcut={{ modifiers: ["cmd", "opt"], key: "arrowUp" }} onAction={() => shift(item, -1)} />
                  )}
                  {index < items.length - 1 && (
                    <Action
                      title="Move Down"
                      icon={Icon.ArrowDown}
                      shortcut={{ modifiers: ["cmd", "opt"], key: "arrowDown" }}
                      onAction={() => shift(item, 1)}
                    />
                  )}
                  <Action title="Convert to Task" icon={Icon.ArrowRightCircle} shortcut={{ modifiers: ["cmd", "shift"], key: "t" }} onAction={() => void toTask(item)} />
                  <Action
                    title="Delete Item"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                    onAction={() => void removeItem(item)}
                  />
                </ActionPanel.Section>
                {structureActions}
              </ActionPanel>
            }
          />
        ))}
        {!items.length && !text.trim() && (
          <List.Item id="no-items" title="No checklist items" subtitle="Type in the search bar to add one" icon={Icon.Info} />
        )}
      </List.Section>
      {children.length > 0 && (
        <List.Section title="Subtasks">
          {children.map((child) => (
            <List.Item
              key={child.id}
              id={`child-${child.id}`}
              title={child.title}
              icon={taskIcon(child)}
              accessories={taskAccessories(child, snapshot, { showList: false })}
              detail={<TaskDetail task={child} snapshot={snapshot} />}
              actions={<TaskActions task={child} />}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}

function RenameItemForm({ task, item }: { task: Task; item: ChecklistItem }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="Rename Item"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            onSubmit={async (values: { title: string }) => {
              pop();
              const title = values.title.trim();
              if (!title || title === item.title) return;
              await setChecklist(
                task,
                sortedItems(task).map((i) => (i.id === item.id ? { ...i, title } : i)),
                "Rename item",
              );
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Item" defaultValue={item.title} />
    </Form>
  );
}

/** `⌘⇧N` from a task row: add one checklist item without opening the task. */
export function AddChecklistItemForm({ taskId }: { taskId: string }) {
  const { pop } = useNavigation();
  const task = useTask(taskId);
  return (
    <Form
      navigationTitle={task ? `Add to “${task.title}”` : "Add Checklist Item"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Add Item"
            icon={Icon.Plus}
            onSubmit={async (values: { title: string }) => {
              pop();
              if (task && values.title.trim()) await addChecklistItem(task, values.title);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Item" placeholder="Checklist item" />
    </Form>
  );
}
