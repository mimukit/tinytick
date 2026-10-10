import { Action, ActionPanel, Icon, List, LocalStorage, Toast, showToast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { addDays, formatTickTickTime, startOfDay } from "../api/dates";
import { errorMessage } from "../api/errors";
import type { Task } from "../api/types";
import { getAuth } from "../auth/secrets";
import { refreshIfStale } from "../store/actions";
import { useLive } from "../store/live";
import { openApi } from "../store/service";
import { projectName } from "../store/snapshot";
import { VIEW_TITLES, childTasks, groupTasks, selectView, sortTasks, type GroupBy, type SortBy, type ViewId } from "../views/select";
import { AccountView, TokenForm } from "./AccountView";
import { taskAccessories, taskIcon, taskMarkdown } from "./format";
import { CompletedTaskActions, TaskActions, UndoAction, ViewActions, type ListControls } from "./TaskActions";

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

  useEffect(() => {
    getAuth().then((a) => {
      const ok = !!a.token;
      setSignedIn(ok);
      if (ok) refreshIfStale();
    });
  }, []);

  const projectId = view.startsWith("project:") ? view.slice("project:".length) : undefined;

  useEffect(() => {
    if (!showCompleted) return;
    let cancelled = false;
    setCompleted(undefined);
    const today = startOfDay(new Date());
    openApi()
      .then((api) =>
        api.completedTasks({
          startDate: formatTickTickTime(today),
          endDate: formatTickTickTime(addDays(today, 1)),
          ...(projectId ? { projectIds: [projectId] } : {}),
        }),
      )
      .then((tasks) => !cancelled && setCompleted(tasks))
      .catch(async (error) => {
        if (cancelled) return;
        setCompleted([]);
        await showToast({ style: Toast.Style.Failure, title: "Could not load completed tasks", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [showCompleted, projectId]);

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
  };

  const viewTitle = title ?? VIEW_TITLES[view] ?? (projectId ? projectName(snapshot, projectId) : "Tasks");
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
  const isEmpty = total === 0 && !(showCompleted && completed?.length);
  const emptyActions = (
    <ActionPanel>
      <ViewActions controls={controls} />
      <UndoAction />
    </ActionPanel>
  );

  return (
    <List
      isLoading={loading || signedIn === undefined || (showCompleted && !completed)}
      isShowingDetail={showDetail}
      navigationTitle={`${viewTitle} · synced ${syncedAt}`}
      searchBarPlaceholder={`Filter ${viewTitle}`}
      actions={isEmpty ? emptyActions : undefined}
      searchBarAccessory={
        fixedView ? undefined : (
          <List.Dropdown tooltip="View" storeValue onChange={(v) => setView(v as ViewId)} defaultValue="today">
            {Object.entries(VIEW_TITLES).map(([id, name]) => (
              <List.Dropdown.Item key={id} value={id} title={name} />
            ))}
          </List.Dropdown>
        )
      }
    >
      {isEmpty && (
        <List.EmptyView
          icon={Icon.CheckCircle}
          title={snapshot.syncedAt ? `Nothing in ${viewTitle}` : "No data yet"}
          description={snapshot.syncedAt ? "Press ⌘N to add a task." : "Press ⌘R to sync."}
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
              keywords={[...(task.tags ?? []).map((t) => `#${t}`), projectName(snapshot, task.projectId)]}
              accessories={showDetail ? undefined : taskAccessories(task, snapshot, { showList: !projectId && groupBy !== "list", childCount: childTasks(snapshot, task.id).length })}
              detail={<List.Item.Detail markdown={taskMarkdown(task)} />}
              actions={<TaskActions task={task} controls={controls} />}
            />
          ))}
        </List.Section>
      ))}
      {showCompleted && !!completed?.length && (
        <List.Section title="Completed Today" subtitle={String(completed.length)}>
          {completed.map((task) => (
            <List.Item
              key={`done-${task.id}`}
              id={`done-${task.id}`}
              title={task.title}
              icon={taskIcon({ ...task, status: 2 })}
              accessories={showDetail ? undefined : [{ text: projectName(snapshot, task.projectId) }]}
              detail={<List.Item.Detail markdown={taskMarkdown(task)} />}
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

