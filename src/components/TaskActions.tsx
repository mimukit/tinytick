import { Action, ActionPanel, Icon, useNavigation } from "@raycast/api";
import { addDays, nextMonday, startOfDay } from "../api/dates";
import { taskWebUrl } from "../api/client";
import type { Priority, Task } from "../api/types";
import { complete, move, refresh, remove, reopen, togglePin, undoLast, updateFields, wontDo } from "../store/actions";
import { useLive } from "../store/live";
import { prefs } from "../store/service";
import { datePatch, toggleTagPatch } from "../views/patches";
import { GROUP_TITLES, SORT_TITLES, type GroupBy, type SortBy } from "../views/select";
import { DateForm } from "./DateForm";
import { PRIORITY_COLOR } from "./format";
import { Picker } from "./Picker";
import { EditTaskForm } from "./EditTaskForm";
import { QuickAddView } from "./QuickAddView";
import { AddChecklistItemForm, TaskScreen } from "./TaskScreen";

export interface ListControls {
  groupBy: GroupBy;
  sortBy: SortBy;
  setGroupBy: (g: GroupBy) => void;
  setSortBy: (s: SortBy) => void;
  showCompleted: boolean;
  toggleCompleted: () => void;
  showDetail: boolean;
  toggleDetail: () => void;
  /** Defaults for Quick Add opened from this view. */
  quickAddDefaults?: { projectId?: string; dueToday?: boolean };
}

const PRIORITIES: { value: Priority; title: string }[] = [
  { value: 5, title: "High" },
  { value: 3, title: "Medium" },
  { value: 1, title: "Low" },
  { value: 0, title: "None" },
];

export function ViewActions({ controls }: { controls: ListControls }) {
  return (
    <ActionPanel.Section title="View">
      <QuickAddAction controls={controls} />
      <Action.Push
        title="Group By…"
        icon={Icon.AppWindowGrid2x2}
        shortcut={{ modifiers: ["cmd", "shift"], key: "g" }}
        target={
          <Picker
            title="Group By"
            options={(Object.keys(GROUP_TITLES) as GroupBy[]).map((g) => ({
              id: g,
              title: GROUP_TITLES[g],
              selected: controls.groupBy === g,
              onPick: () => controls.setGroupBy(g),
            }))}
          />
        }
      />
      <Action.Push
        title="Sort By…"
        icon={Icon.ArrowUp}
        shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
        target={
          <Picker
            title="Sort By"
            options={(Object.keys(SORT_TITLES) as SortBy[]).map((s) => ({
              id: s,
              title: SORT_TITLES[s],
              selected: controls.sortBy === s,
              onPick: () => controls.setSortBy(s),
            }))}
          />
        }
      />
      <Action
        title={controls.showCompleted ? "Hide Completed" : "Show Completed"}
        icon={Icon.CheckCircle}
        shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        onAction={controls.toggleCompleted}
      />
      <Action
        title={controls.showDetail ? "Hide Details" : "Show Details"}
        icon={Icon.Sidebar}
        shortcut={{ modifiers: ["cmd"], key: "i" }}
        onAction={controls.toggleDetail}
      />
      <Action title="Sync Now" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={() => void refresh({ full: true })} />
    </ActionPanel.Section>
  );
}

export function QuickAddAction({ controls }: { controls?: ListControls }) {
  const { push } = useNavigation();
  return (
    <Action
      title="Quick Add Task"
      icon={Icon.Plus}
      shortcut={{ modifiers: ["cmd"], key: "n" }}
      onAction={() =>
        push(
          <QuickAddView
            defaultProjectId={controls?.quickAddDefaults?.projectId}
            defaultDue={controls?.quickAddDefaults?.dueToday ? new Date() : undefined}
            popOnCreate
          />,
        )
      }
    />
  );
}

export function UndoAction() {
  const live = useLive();
  if (!live.undoSize) return null;
  return (
    <Action
      title={`Undo ${live.undoLabel ?? ""}`.trim()}
      icon={Icon.Undo}
      shortcut={{ modifiers: ["cmd"], key: "z" }}
      onAction={() => void undoLast()}
    />
  );
}

/** The actions for an open task row. Enter completes the task. */
export function TaskActions({ task, controls }: { task: Task; controls?: ListControls }) {
  const { push } = useNavigation();
  const { snapshot } = useLive();
  const v2 = prefs().enableV2;
  const today = startOfDay(new Date());
  const setDate = (day: Date | null, label: string) => void updateFields(task, datePatch(task, day), label);
  const pinned = !!task.pinnedTime && task.pinnedTime !== "-1";
  const lists = [
    ...(snapshot.inboxId ? [{ id: snapshot.inboxId, name: "Inbox" }] : []),
    ...snapshot.projects.map((p) => ({ id: p.id, name: p.name })),
  ];
  const tagNames = [...new Set([...snapshot.tags.map((t) => t.name), ...(task.tags ?? [])])];

  const datePresets: { title: string; day: Date | null }[] = [
    { title: "Today", day: today },
    { title: "Tomorrow", day: addDays(today, 1) },
    { title: "Day After Tomorrow", day: addDays(today, 2) },
    { title: "Next Monday", day: nextMonday(today) },
    { title: "In a Week", day: addDays(today, 7) },
  ];

  return (
    <ActionPanel title={task.title}>
      <ActionPanel.Section>
        <Action title="Complete" icon={Icon.CheckCircle} onAction={() => void complete(task)} />
        <Action
          title="Open Task"
          icon={Icon.Sidebar}
          shortcut={{ modifiers: ["cmd"], key: "return" }}
          onAction={() => push(<TaskScreen taskId={task.id} />)}
        />
        <UndoAction />
      </ActionPanel.Section>
      <ActionPanel.Section title="Task">
        <Action.Push
          title="Set Date…"
          icon={Icon.Calendar}
          shortcut={{ modifiers: ["cmd"], key: "d" }}
          target={
            <Picker
              title="Set Date"
              options={[
                ...datePresets.map((d) => ({ id: d.title, title: d.title, icon: Icon.Calendar, onPick: () => setDate(d.day, "Set date") })),
                { id: "type", title: "Type a Date…", icon: Icon.Pencil, onPick: () => push(<DateForm task={task} />) },
                { id: "clear", title: "Clear Date", icon: Icon.XMarkCircle, onPick: () => setDate(null, "Clear date") },
              ]}
            />
          }
        />
        <Action.Push
          title="Set Priority…"
          icon={Icon.Flag}
          shortcut={{ modifiers: ["cmd"], key: "p" }}
          target={
            <Picker
              title="Set Priority"
              options={PRIORITIES.map((p) => ({
                id: String(p.value),
                title: p.title,
                icon: { source: Icon.Flag, tintColor: PRIORITY_COLOR[p.value] },
                selected: (task.priority ?? 0) === p.value,
                onPick: () => updateFields(task, { priority: p.value }, "Set priority"),
              }))}
            />
          }
        />
        <Action.Push
          title="Move to List…"
          icon={Icon.Folder}
          shortcut={{ modifiers: ["cmd"], key: "m" }}
          target={
            <Picker
              title="Move to List"
              options={lists.map((l) => ({ id: l.id, title: l.name, selected: l.id === task.projectId, onPick: () => move(task, l.id) }))}
            />
          }
        />
        <Action.Push
          title="Tags…"
          icon={Icon.Tag}
          shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}
          target={
            <Picker
              title="Toggle Tag"
              options={tagNames.map((name) => ({
                id: name,
                title: `#${name}`,
                // Not `selected`: picking a tag the task has removes it.
                icon: task.tags?.includes(name) ? Icon.Checkmark : Icon.Circle,
                onPick: () => updateFields(task, toggleTagPatch(task, name), "Change tags"),
              }))}
            />
          }
        />
        <Action title="Edit Task" icon={Icon.Pencil} shortcut={{ modifiers: ["cmd"], key: "e" }} onAction={() => push(<EditTaskForm task={task} />)} />
        <Action
          title="Add Checklist Item"
          icon={Icon.CheckList}
          shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
          onAction={() => push(<AddChecklistItemForm taskId={task.id} />)}
        />
        {v2 && (
          <Action
            title={pinned ? "Unpin" : "Pin"}
            icon={Icon.Pin}
            shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
            onAction={() => void togglePin(task)}
          />
        )}
        {v2 && (
          <Action title="Won't Do" icon={Icon.XMarkCircle} shortcut={{ modifiers: ["cmd", "shift"], key: "w" }} onAction={() => void wontDo(task)} />
        )}
      </ActionPanel.Section>
      {controls ? (
        <ViewActions controls={controls} />
      ) : (
        <ActionPanel.Section>
          <QuickAddAction />
        </ActionPanel.Section>
      )}
      <ActionPanel.Section>
        <Action.OpenInBrowser title="Open in TickTick Web" url={taskWebUrl(task)} shortcut={{ modifiers: ["cmd"], key: "o" }} />
        <Action.CopyToClipboard title="Copy Title" content={task.title} shortcut={{ modifiers: ["cmd", "shift"], key: "." }} />
        <Action
          title="Delete Task"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ["cmd"], key: "backspace" }}
          onAction={() => void remove(task)}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
}

/** The actions for a completed row. Enter opens the task; Reopen has no key. */
export function CompletedTaskActions({ task, controls, onReopened }: { task: Task; controls?: ListControls; onReopened?: () => void }) {
  const { push } = useNavigation();
  return (
    <ActionPanel title={task.title}>
      <ActionPanel.Section>
        <Action title="Open Task" icon={Icon.Sidebar} onAction={() => push(<TaskScreen taskId={task.id} fallback={task} />)} />
        <Action
          title="Reopen"
          icon={Icon.ArrowCounterClockwise}
          onAction={async () => {
            if (await reopen(task)) onReopened?.();
          }}
        />
        <UndoAction />
      </ActionPanel.Section>
      {controls && <ViewActions controls={controls} />}
      <ActionPanel.Section>
        <Action.OpenInBrowser title="Open in TickTick Web" url={taskWebUrl(task)} shortcut={{ modifiers: ["cmd"], key: "o" }} />
        <Action.CopyToClipboard title="Copy Title" content={task.title} shortcut={{ modifiers: ["cmd", "shift"], key: "." }} />
      </ActionPanel.Section>
    </ActionPanel>
  );
}
