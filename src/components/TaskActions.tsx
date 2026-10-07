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

const PRIORITIES: { value: Priority; title: string; key: "0" | "1" | "2" | "3" }[] = [
  { value: 5, title: "High", key: "3" },
  { value: 3, title: "Medium", key: "2" },
  { value: 1, title: "Low", key: "1" },
  { value: 0, title: "None", key: "0" },
];

export function ViewActions({ controls }: { controls: ListControls }) {
  return (
    <ActionPanel.Section title="View">
      <ActionPanel.Submenu title="Group By" icon={Icon.AppWindowGrid2x2} shortcut={{ modifiers: ["cmd", "shift"], key: "g" }}>
        {(Object.keys(GROUP_TITLES) as GroupBy[]).map((g) => (
          <Action
            key={g}
            title={GROUP_TITLES[g]}
            icon={controls.groupBy === g ? Icon.Checkmark : undefined}
            onAction={() => controls.setGroupBy(g)}
          />
        ))}
      </ActionPanel.Submenu>
      <ActionPanel.Submenu title="Sort By" icon={Icon.ArrowUp} shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}>
        {(Object.keys(SORT_TITLES) as SortBy[]).map((s) => (
          <Action
            key={s}
            title={SORT_TITLES[s]}
            icon={controls.sortBy === s ? Icon.Checkmark : undefined}
            onAction={() => controls.setSortBy(s)}
          />
        ))}
      </ActionPanel.Submenu>
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
      <ActionPanel.Section title="Date">
        <Action title="Due Today" icon={Icon.Calendar} shortcut={{ modifiers: ["cmd"], key: "1" }} onAction={() => setDate(today, "Set date")} />
        <Action
          title="Due Tomorrow"
          icon={Icon.Calendar}
          shortcut={{ modifiers: ["cmd"], key: "2" }}
          onAction={() => setDate(addDays(today, 1), "Set date")}
        />
        <Action
          title="Due Next Week"
          icon={Icon.Calendar}
          shortcut={{ modifiers: ["cmd"], key: "3" }}
          onAction={() => setDate(nextMonday(today), "Set date")}
        />
        <ActionPanel.Submenu title="Set Date…" icon={Icon.Calendar} shortcut={{ modifiers: ["cmd"], key: "d" }}>
          <Action title="Today" onAction={() => setDate(today, "Set date")} />
          <Action title="Tomorrow" onAction={() => setDate(addDays(today, 1), "Set date")} />
          <Action title="Day After Tomorrow" onAction={() => setDate(addDays(today, 2), "Set date")} />
          <Action title="Next Monday" onAction={() => setDate(nextMonday(today), "Set date")} />
          <Action title="In a Week" onAction={() => setDate(addDays(today, 7), "Set date")} />
          <Action title="Type a Date…" icon={Icon.Pencil} onAction={() => push(<DateForm task={task} />)} />
          <Action title="Clear Date" icon={Icon.XMarkCircle} onAction={() => setDate(null, "Clear date")} />
        </ActionPanel.Submenu>
      </ActionPanel.Section>
      <ActionPanel.Section title="Priority">
        {PRIORITIES.map((p) => (
          <Action
            key={p.value}
            title={`Priority ${p.title}`}
            icon={{ source: Icon.Flag }}
            shortcut={{ modifiers: ["ctrl"], key: p.key }}
            onAction={() => void updateFields(task, { priority: p.value }, "Set priority")}
          />
        ))}
      </ActionPanel.Section>
      <ActionPanel.Section title="Organize">
        <ActionPanel.Submenu title="Move to List" icon={Icon.Folder} shortcut={{ modifiers: ["cmd"], key: "m" }}>
          {lists.map((l) => (
            <Action
              key={l.id}
              title={l.name}
              icon={l.id === task.projectId ? Icon.Checkmark : undefined}
              onAction={() => void move(task, l.id)}
            />
          ))}
        </ActionPanel.Submenu>
        <ActionPanel.Submenu title="Tags" icon={Icon.Tag} shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}>
          {tagNames.map((name) => (
            <Action
              key={name}
              title={`#${name}`}
              icon={task.tags?.includes(name) ? Icon.Checkmark : Icon.Circle}
              onAction={() => void updateFields(task, toggleTagPatch(task, name), "Change tags")}
            />
          ))}
        </ActionPanel.Submenu>
        <Action title="Edit Task" icon={Icon.Pencil} shortcut={{ modifiers: ["cmd"], key: "e" }} onAction={() => push(<EditTaskForm task={task} />)} />
        <Action
          title="Add Checklist Item"
          icon={Icon.CheckList}
          shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
          onAction={() => push(<AddChecklistItemForm taskId={task.id} />)}
        />
        <QuickAddAction controls={controls} />
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
      {controls && <ViewActions controls={controls} />}
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
