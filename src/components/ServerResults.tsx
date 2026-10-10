import { List, Toast, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import { errorMessage } from "../api/errors";
import type { Task } from "../api/types";
import { useLive } from "../store/live";
import { openApi } from "../store/service";
import { isOpen } from "../store/snapshot";
import { taskIcon } from "./format";
import { TaskActions } from "./TaskActions";
import { TaskDetail } from "./TaskDetail";

/** Server-side search, for tasks the local cache does not hold. */
export function ServerResults({ keywords }: { keywords: string }) {
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
            detail={<TaskDetail task={cached} snapshot={snapshot} />}
            actions={isOpen(cached) ? <TaskActions task={cached} /> : undefined}
          />
        );
      })}
    </List>
  );
}
