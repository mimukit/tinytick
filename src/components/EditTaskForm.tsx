import { Action, ActionPanel, Form, Icon, useNavigation } from "@raycast/api";
import { useState } from "react";
import { parseTickTickTime } from "../api/dates";
import type { Priority, Task, TaskPatch } from "../api/types";
import { move, updateFields } from "../store/actions";
import { useLive } from "../store/live";
import { diffFields, exactDatePatch } from "../views/patches";

const REPEATS: Record<string, string | undefined> = {
  none: undefined,
  daily: "RRULE:FREQ=DAILY;INTERVAL=1",
  weekdays: "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR",
  weekly: "RRULE:FREQ=WEEKLY;INTERVAL=1",
  monthly: "RRULE:FREQ=MONTHLY;INTERVAL=1",
  yearly: "RRULE:FREQ=YEARLY;INTERVAL=1",
};

const REMINDERS: Record<string, string | undefined> = {
  none: undefined,
  ontime: "TRIGGER:PT0S",
  "5m": "TRIGGER:-PT5M",
  "30m": "TRIGGER:-PT30M",
  "1h": "TRIGGER:-PT1H",
  "1d": "TRIGGER:-P1D",
};

function keyFor(map: Record<string, string | undefined>, value: string | undefined): string {
  if (!value) return "none";
  return Object.entries(map).find(([, v]) => v === value)?.[0] ?? "keep";
}

interface Values {
  title: string;
  content: string;
  projectId: string;
  priority: string;
  due: Date | null;
  start: Date | null;
  allDay: boolean;
  repeat: string;
  reminder: string;
  tags: string[];
}

export function EditTaskForm({ task }: { task: Task }) {
  const { pop } = useNavigation();
  const { snapshot } = useLive();
  const [allDay, setAllDay] = useState(task.isAllDay !== false);
  const due = parseTickTickTime(task.dueDate) ?? null;
  const start = parseTickTickTime(task.startDate);
  const hasRange = !!start && !!due && start.getTime() !== due.getTime();
  const repeatKey = keyFor(REPEATS, task.repeatFlag);
  const reminderKey = keyFor(REMINDERS, task.reminders?.[0]);
  const lists = [
    ...(snapshot.inboxId ? [{ id: snapshot.inboxId, name: "Inbox" }] : []),
    ...snapshot.projects.map((p) => ({ id: p.id, name: p.name })),
  ];
  if (!lists.some((l) => l.id === task.projectId)) lists.unshift({ id: task.projectId, name: "Current list" });
  const tagNames = [...new Set([...snapshot.tags.map((t) => t.name), ...(task.tags ?? [])])];

  async function submit(values: Values) {
    const edited: TaskPatch = {
      title: values.title.trim() || task.title,
      content: values.content,
      priority: Number(values.priority) as Priority,
      tags: values.tags,
    };
    if (values.due) Object.assign(edited, exactDatePatch(values.due, values.allDay, values.start));
    else if (task.dueDate) Object.assign(edited, { dueDate: null, startDate: null });
    if (values.repeat !== "keep") edited.repeatFlag = (REPEATS[values.repeat] ?? "") as string;
    if (values.reminder !== "keep") edited.reminders = REMINDERS[values.reminder] ? [REMINDERS[values.reminder]!] : [];
    pop();
    let current = task;
    if (values.projectId !== task.projectId) {
      if (!(await move(task, values.projectId))) return;
      current = { ...task, projectId: values.projectId };
    }
    const patch = diffFields(current, edited);
    if (Object.keys(patch).length) await updateFields(current, patch, "Edit");
  }

  return (
    <Form
      navigationTitle="Edit Task"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" icon={Icon.Check} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Title" defaultValue={task.title} />
      <Form.TextArea id="content" title="Notes" defaultValue={task.content ?? ""} />
      <Form.Dropdown id="projectId" title="List" defaultValue={task.projectId}>
        {lists.map((l) => (
          <Form.Dropdown.Item key={l.id} value={l.id} title={l.name} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="priority" title="Priority" defaultValue={String(task.priority ?? 0)}>
        <Form.Dropdown.Item value="5" title="High" />
        <Form.Dropdown.Item value="3" title="Medium" />
        <Form.Dropdown.Item value="1" title="Low" />
        <Form.Dropdown.Item value="0" title="None" />
      </Form.Dropdown>
      <Form.Separator />
      <Form.Checkbox id="allDay" label="All day" value={allDay} onChange={setAllDay} />
      <Form.DatePicker
        id="start"
        title="Start"
        info="Leave empty for a single due date."
        defaultValue={hasRange ? start : null}
        type={allDay ? Form.DatePicker.Type.Date : Form.DatePicker.Type.DateTime}
      />
      <Form.DatePicker id="due" title="Due" defaultValue={due} type={allDay ? Form.DatePicker.Type.Date : Form.DatePicker.Type.DateTime} />
      <Form.Dropdown id="repeat" title="Repeat" defaultValue={repeatKey}>
        {repeatKey === "keep" && <Form.Dropdown.Item value="keep" title={`Keep (${task.repeatFlag})`} />}
        <Form.Dropdown.Item value="none" title="Never" />
        <Form.Dropdown.Item value="daily" title="Daily" />
        <Form.Dropdown.Item value="weekdays" title="Weekdays" />
        <Form.Dropdown.Item value="weekly" title="Weekly" />
        <Form.Dropdown.Item value="monthly" title="Monthly" />
        <Form.Dropdown.Item value="yearly" title="Yearly" />
      </Form.Dropdown>
      <Form.Dropdown id="reminder" title="Reminder" defaultValue={reminderKey}>
        {reminderKey === "keep" && <Form.Dropdown.Item value="keep" title={`Keep (${task.reminders?.join(", ")})`} />}
        <Form.Dropdown.Item value="none" title="None" />
        <Form.Dropdown.Item value="ontime" title="On time" />
        <Form.Dropdown.Item value="5m" title="5 minutes before" />
        <Form.Dropdown.Item value="30m" title="30 minutes before" />
        <Form.Dropdown.Item value="1h" title="1 hour before" />
        <Form.Dropdown.Item value="1d" title="1 day before" />
      </Form.Dropdown>
      <Form.TagPicker id="tags" title="Tags" defaultValue={task.tags ?? []}>
        {tagNames.map((t) => (
          <Form.TagPicker.Item key={t} value={t} title={`#${t}`} />
        ))}
      </Form.TagPicker>
    </Form>
  );
}
