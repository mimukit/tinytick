import { Action, ActionPanel, Form, Icon, useNavigation } from "@raycast/api";
import { useState } from "react";
import { parseTickTickTime } from "../api/dates";
import type { Task } from "../api/types";
import { updateFields } from "../store/actions";
import { exactDatePatch } from "../views/patches";

/** "Type a date": a date and time picker for one task. */
export function DateForm({ task }: { task: Task }) {
  const { pop } = useNavigation();
  const [allDay, setAllDay] = useState(task.isAllDay !== false);
  const due = parseTickTickTime(task.dueDate) ?? new Date();

  return (
    <Form
      navigationTitle="Set Date"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Set Date"
            icon={Icon.Calendar}
            onSubmit={async (values: { due: Date | null; allDay: boolean }) => {
              if (!values.due) return;
              pop();
              await updateFields(task, exactDatePatch(values.due, values.allDay), "Set date");
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text={task.title} />
      <Form.DatePicker id="due" title="Due" defaultValue={due} type={allDay ? Form.DatePicker.Type.Date : Form.DatePicker.Type.DateTime} />
      <Form.Checkbox id="allDay" label="All day" value={allDay} onChange={setAllDay} />
    </Form>
  );
}
