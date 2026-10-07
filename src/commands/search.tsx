import { Action, ActionPanel, Icon, List, Toast, showToast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { errorMessage } from "../api/errors";
import type { Task } from "../api/types";
import { taskAccessories, taskIcon, taskMarkdown } from "../components/format";
import { QuickAddAction, TaskActions } from "../components/TaskActions";
import { refreshIfStale } from "../store/actions";
import { useLive } from "../store/live";
import { openApi } from "../store/service";
import { isOpen } from "../store/snapshot";
import { sortTasks } from "../views/select";

/** Words from the title, the notes, the checklist and the tags, for the filter. */
function keywordsOf(task: Task): string[] {
  const text = [task.content, task.desc, ...(task.items ?? []).map((i) => i.title)].filter(Boolean).join(" ");
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  return [...new Set([...words, ...(task.tags ?? []).map((t) => `#${t}`)])].slice(0, 80);
}

export default function Command() {
  const { snapshot, loading } = useLive();
  const { push } = useNavigation();
  const [listFilter, setListFilter] = useState("all");
  const [text, setText] = useState("");
  useEffect(refreshIfStale, []);

  const tasks = sortTasks(
    snapshot.tasks.filter((t) => isOpen(t) && (listFilter === "all" || t.projectId === listFilter)),
    "date",
    snapshot,
  );

  const serverSearch = (
    <Action
      title="Search on Server"
      icon={Icon.Globe}
      shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
      onAction={() => text.trim() && push(<ServerResults keywords={text.trim()} />)}
    />
  );

  return (
    <List
      isLoading={loading}
      onSearchTextChange={setText}
      searchBarPlaceholder="Search open tasks"
      searchBarAccessory={
        <List.Dropdown tooltip="List" storeValue onChange={setListFilter} defaultValue="all">
          <List.Dropdown.Item value="all" title="All Lists" />
          {snapshot.inboxId && <List.Dropdown.Item value={snapshot.inboxId} title="Inbox" />}
          {snapshot.projects.map((p) => (
            <List.Dropdown.Item key={p.id} value={p.id} title={p.name} />
          ))}
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title="No match in the cache"
        description="Press ⌘⇧F to search on the TickTick server."
        actions={<ActionPanel>{serverSearch}</ActionPanel>}
      />
      {tasks.map((task) => (
        <List.Item
          key={task.id}
          title={task.title}
          icon={taskIcon(task)}
          keywords={keywordsOf(task)}
          accessories={taskAccessories(task, snapshot)}
          actions={
            <ActionPanel>
              <TaskActions task={task} />
              <ActionPanel.Section>
                {serverSearch}
                <QuickAddAction />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function ServerResults({ keywords }: { keywords: string }) {
  const { snapshot } = useLive();
  const [results, setResults] = useState<Task[]>();
  useEffect(() => {
    openApi()
      .then((api) => api.searchTasks(keywords))
      .then(setResults)
      .catch(async (error) => {
        setResults([]);
        await showToast({ style: Toast.Style.Failure, title: "Server search failed", message: errorMessage(error) });
      });
  }, [keywords]);
  return (
    <List isLoading={!results} navigationTitle={`Server: ${keywords}`} isShowingDetail>
      <List.EmptyView title="No results" />
      {(results ?? []).map((task) => {
        const cached = snapshot.tasks.find((t) => t.id === task.id) ?? task;
        return (
          <List.Item
            key={task.id}
            title={cached.title}
            icon={taskIcon(cached)}
            detail={<List.Item.Detail markdown={taskMarkdown(cached)} />}
            actions={isOpen(cached) ? <TaskActions task={cached} /> : undefined}
          />
        );
      })}
    </List>
  );
}
