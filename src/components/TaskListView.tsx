import { Action, ActionPanel, Icon, List, LocalStorage, Toast, showToast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { addDays, formatDueLabel, formatTickTickTime, parseTickTickTime, startOfDay } from "../api/dates";
import { errorMessage } from "../api/errors";
import type { Task } from "../api/types";
import { getAuth } from "../auth/secrets";
import { refreshIfStale } from "../store/actions";
import { useLive } from "../store/live";
import { openApi } from "../store/service";
import { projectName } from "../store/snapshot";
import { COMPLETED_RANGES, VIEW_TITLES, childTasks, groupTasks, selectView, sortTasks, type GroupBy, type SortBy, type ViewId } from "../views/select";
import { AccountView, TokenForm } from "./AccountView";
import { taskAccessories, taskIcon } from "./format";
import { TaskDetail } from "./TaskDetail";
import { CompletedTaskActions, TaskActions, UndoAction, ViewActions, type ListControls } from "./TaskActions";

/** Words from the title, the notes, the checklist, the tags and the list, for the filter. */
function keywordsOf(task: Task, listName: string): string[] {
  const text = [task.content, task.desc, ...(task.items ?? []).map((i) => i.title)].filter(Boolean).join(" ");
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  return [...new Set([...words, ...(task.tags ?? []).map((t) => `#${t}`), listName])].slice(0, 80);
}

export interface TaskListViewProps {
  /** A fixed view, such as one list. Without it, the search bar dropdown picks the view. */
  fixedView?: ViewId;
  title?: string;
}

function useStoredState<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    LocalStorage.getItem<string>(key).then((v) => v && setValue(v as T));
  }, [key]);
  return [
    value,
    (v: T) => {
      setValue(v);
      void LocalStorage.setItem(key, v);
    },
  ];
}

export function TaskListView({ fixedView, title }: TaskListViewProps) {
  const { snapshot, loading } = useLive();
  const [view, setView] = useState<ViewId>(fixedView ?? "today");
  const [groupBy, setGroupBy] = useStoredState<GroupBy>("groupBy", "priority");
  const [sortBy, setSortBy] = useStoredState<SortBy>("sortBy", "date");
  const [showDetail, setShowDetail] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [completed, setCompleted] = useState<Task[] | undefined>();
  const [signedIn, setSignedIn] = useState<boolean | undefined>();
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    getAuth().then((a) => {
      const ok = !!a.token;
      setSignedIn(ok);
      if (ok) refreshIfStale();
    });
  }, []);

  const projectId = view.startsWith("project:") ? view.slice("project:".length) : undefined;
  const completedRange = view.startsWith("completed:") ? COMPLETED_RANGES[view.slice("completed:".length)] : undefined;
  const loadCompleted = showCompleted || !!completedRange;

  useEffect(() => {
    if (!loadCompleted) return;
    let cancelled = false;
    setCompleted(undefined);
    const today = startOfDay(new Date());
    openApi()
      .then((api) =>
        api.completedTasks({
          startDate: formatTickTickTime(addDays(today, -(completedRange?.days ?? 0))),
          endDate: formatTickTickTime(addDays(today, 1)),
          ...(projectId ? { projectIds: [projectId] } : {}),
        }),
      )
      .then((tasks) => {
        if (cancelled) return;
        const time = (t: Task) => parseTickTickTime(t.completedTime)?.getTime() ?? 0;
        setCompleted([...tasks].sort((a, b) => time(b) - time(a)));
      })
      .catch(async (error) => {
        if (cancelled) return;
        setCompleted([]);
        await showToast({ style: Toast.Style.Failure, title: "Could not load completed tasks", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [loadCompleted, projectId, completedRange]);

  const sections = useMemo(() => {
    const tasks = sortTasks(selectView(snapshot, view), sortBy, snapshot);
    return groupTasks(tasks, groupBy, snapshot);
  }, [snapshot, view, groupBy, sortBy]);

  const controls: ListControls = {
    groupBy,
    sortBy,
    setGroupBy,
    setSortBy,
    showCompleted,
    toggleCompleted: () => setShowCompleted((v) => !v),
    showDetail,
    toggleDetail: () => setShowDetail((v) => !v),
    quickAddDefaults: {
      projectId: projectId ?? (view === "inbox" ? snapshot.inboxId : undefined),
      dueToday: view === "today",
    },
    searchText,
    onAuthChange: (a) => setSignedIn(!!a.token),
  };

  const viewTitle = title ?? VIEW_TITLES[view] ?? completedRange?.title ?? (projectId ? projectName(snapshot, projectId) : "Tasks");
  const syncedAt = snapshot.syncedAt ? new Date(snapshot.syncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "never";

  // Rows, not an EmptyView: Tinycast shows the ↵ and ⌘K pill only when a row is selected.
  if (signedIn === false) {
    const onSignIn = () => setSignedIn(true);
    const tokenAction = <Action.Push title="Enter API Token" icon={Icon.Key} target={<TokenForm onDone={onSignIn} />} />;
    const accountAction = (
      <Action.Push title="Open Account" icon={Icon.Person} target={<AccountView onChange={(a) => setSignedIn(!!a.token)} />} />
    );
    return (
      <List navigationTitle="Sign in to TickTick" searchBarPlaceholder="Sign in to TickTick to see your tasks">
        <List.Section title="Sign in to TickTick">
          <List.Item
            title="Sign in with an API token"
            subtitle="TickTick Settings › Account › API Token"
            icon={Icon.Key}
            actions={
              <ActionPanel>
                {tokenAction}
                {accountAction}
              </ActionPanel>
            }
          />
          <List.Item
            title="Open Account"
            subtitle="Sign-in state, v2 cookie and sign-out"
            icon={Icon.Person}
            actions={
              <ActionPanel>
                {accountAction}
                {tokenAction}
              </ActionPanel>
            }
          />
        </List.Section>
      </List>
    );
  }

  // Tinycast ignores EmptyView actions and shows the List's own, so each empty state sets both.

  const total = sections.reduce((n, s) => n + s.tasks.length, 0);
  const isEmpty = total === 0 && !(loadCompleted && completed?.length);
  const emptyActions = (
    <ActionPanel>
      <ViewActions controls={controls} />
      <UndoAction />
    </ActionPanel>
  );

  return (
    <List
      isLoading={loading || signedIn === undefined || (loadCompleted && !completed)}
      isShowingDetail={showDetail}
      navigationTitle={`${viewTitle} · synced ${syncedAt}`}
      searchBarPlaceholder={`Filter ${viewTitle}`}
      actions={isEmpty ? emptyActions : undefined}
      filtering
      onSearchTextChange={setSearchText}
      searchBarAccessory={fixedView ? undefined : <ViewDropdown onChange={setView} />}
    >
      {isEmpty && (
        <List.EmptyView
          icon={Icon.CheckCircle}
          title={completedRange ? "Nothing completed in this range" : snapshot.syncedAt ? `Nothing in ${viewTitle}` : "No data yet"}
          description={
            searchText.trim() ? "Press ⌘⇧F to search on the TickTick server." : snapshot.syncedAt ? "Press ⌘N to add a task." : "Press ⌘R to sync."
          }
          actions={emptyActions}
        />
      )}
      {sections.map((section) => (
        <List.Section key={section.key} title={section.title || undefined} subtitle={String(section.tasks.length)}>
          {section.tasks.map((task) => (
            <List.Item
              key={task.id}
              id={task.id}
              title={task.title}
              icon={taskIcon(task)}
              keywords={keywordsOf(task, projectName(snapshot, task.projectId))}
              accessories={showDetail ? undefined : taskAccessories(task, snapshot, { showList: !projectId && groupBy !== "list", childCount: childTasks(snapshot, task.id).length })}
              detail={<TaskDetail task={task} snapshot={snapshot} />}
              actions={<TaskActions task={task} controls={controls} />}
            />
          ))}
        </List.Section>
      ))}
      {loadCompleted && !!completed?.length && (
        <List.Section title={completedRange?.title ?? "Completed Today"} subtitle={String(completed.length)}>
          {completed.map((task) => (
            <List.Item
              key={`done-${task.id}`}
              id={`done-${task.id}`}
              title={task.title}
              icon={taskIcon({ ...task, status: 2 })}
              keywords={keywordsOf(task, projectName(snapshot, task.projectId))}
              accessories={showDetail ? undefined : completedAccessories(task, projectName(snapshot, task.projectId))}
              detail={<TaskDetail task={{ ...task, status: 2 }} snapshot={snapshot} />}
              actions={
                <CompletedTaskActions
                  task={task}
                  controls={controls}
                  onReopened={() => setCompleted((list) => list?.filter((t) => t.id !== task.id))}
                />
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}

function completedAccessories(task: Task, listName: string): List.Item.Accessory[] {
  const done = parseTickTickTime(task.completedTime);
  return [{ text: listName }, ...(done ? [{ text: formatDueLabel(done, false), tooltip: "Completed" }] : [])];
}

/** The view picker: date views, then each list by folder, then the completed ranges. */
function ViewDropdown({ onChange }: { onChange: (view: ViewId) => void }) {
  const { snapshot } = useLive();
  const groups = [...snapshot.groups].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const projects = [...snapshot.projects].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const ungrouped = projects.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId));
  const item = (id: string, name: string) => <List.Dropdown.Item key={id} value={`project:${id}`} title={name} />;
  return (
    <List.Dropdown tooltip="View" storeValue onChange={(v) => onChange(v as ViewId)} defaultValue="today">
      <List.Dropdown.Section title="Views">
        {Object.entries(VIEW_TITLES).map(([id, name]) => (
          <List.Dropdown.Item key={id} value={id} title={name} />
        ))}
      </List.Dropdown.Section>
      <List.Dropdown.Section title="Lists">{ungrouped.map((p) => item(p.id, p.name))}</List.Dropdown.Section>
      {groups.map((g) => (
        <List.Dropdown.Section key={g.id} title={g.name}>
          {projects.filter((p) => p.groupId === g.id).map((p) => item(p.id, p.name))}
        </List.Dropdown.Section>
      ))}
      <List.Dropdown.Section title="Completed">
        {Object.entries(COMPLETED_RANGES).map(([id, r]) => (
          <List.Dropdown.Item key={id} value={`completed:${id}`} title={r.title} />
        ))}
      </List.Dropdown.Section>
    </List.Dropdown>
  );
}
