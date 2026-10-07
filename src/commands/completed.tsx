import { List, Toast, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import { addDays, formatTickTickTime, formatDueLabel, parseTickTickTime, startOfDay } from "../api/dates";
import { errorMessage } from "../api/errors";
import type { Task } from "../api/types";
import { taskIcon, taskMarkdown } from "../components/format";
import { CompletedTaskActions } from "../components/TaskActions";
import { useLive } from "../store/live";
import { openApi } from "../store/service";
import { projectName } from "../store/snapshot";

const RANGES: Record<string, { title: string; days: number }> = {
  today: { title: "Today", days: 0 },
  yesterday: { title: "Since Yesterday", days: 1 },
  week: { title: "Last 7 Days", days: 6 },
  month: { title: "Last 30 Days", days: 29 },
};

export default function Command() {
  const { snapshot } = useLive();
  const [range, setRange] = useState("today");
  const [tasks, setTasks] = useState<Task[]>();

  useEffect(() => {
    let cancelled = false;
    setTasks(undefined);
    const today = startOfDay(new Date());
    openApi()
      .then((api) =>
        api.completedTasks({
          startDate: formatTickTickTime(addDays(today, -(RANGES[range]?.days ?? 0))),
          endDate: formatTickTickTime(addDays(today, 1)),
        }),
      )
      .then((list) => {
        if (cancelled) return;
        const time = (t: Task) => parseTickTickTime(t.completedTime)?.getTime() ?? 0;
        setTasks([...list].sort((a, b) => time(b) - time(a)));
      })
      .catch(async (error) => {
        if (cancelled) return;
        setTasks([]);
        await showToast({ style: Toast.Style.Failure, title: "Could not load completed tasks", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <List
      isLoading={!tasks}
      searchBarPlaceholder="Filter completed tasks"
      searchBarAccessory={
        <List.Dropdown tooltip="Range" storeValue onChange={setRange} defaultValue="today">
          {Object.entries(RANGES).map(([id, r]) => (
            <List.Dropdown.Item key={id} value={id} title={r.title} />
          ))}
        </List.Dropdown>
      }
    >
      <List.EmptyView title="Nothing completed in this range" />
      {(tasks ?? []).map((task) => {
        const done = parseTickTickTime(task.completedTime);
        return (
          <List.Item
            key={task.id}
            title={task.title}
            icon={taskIcon({ ...task, status: 2 })}
            accessories={[
              { text: projectName(snapshot, task.projectId) },
              ...(done ? [{ text: formatDueLabel(done, false), tooltip: "Completed" }] : []),
            ]}
            detail={<List.Item.Detail markdown={taskMarkdown(task)} />}
            actions={<CompletedTaskActions task={task} onReopened={() => setTasks((l) => l?.filter((t) => t.id !== task.id))} />}
          />
        );
      })}
    </List>
  );
}
