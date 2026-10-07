import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useEffect } from "react";
import { TaskListView } from "../components/TaskListView";
import { QuickAddAction } from "../components/TaskActions";
import { refresh, refreshIfStale } from "../store/actions";
import { useLive } from "../store/live";
import { isOpen } from "../store/snapshot";

export default function Command() {
  const { snapshot, loading } = useLive();
  useEffect(refreshIfStale, []);

  const counts = new Map<string, number>();
  for (const t of snapshot.tasks) if (isOpen(t)) counts.set(t.projectId, (counts.get(t.projectId) ?? 0) + 1);

  const groups = [...snapshot.groups].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const projects = [...snapshot.projects].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const ungrouped = projects.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId));

  const item = (id: string, name: string, icon = Icon.List) => (
    <List.Item
      key={id}
      title={name}
      icon={icon}
      accessories={[{ text: String(counts.get(id) ?? 0) }]}
      actions={
        <ActionPanel>
          <Action.Push title="Open List" icon={Icon.List} target={<TaskListView fixedView={`project:${id}`} title={name} />} />
          <QuickAddAction controls={undefined} />
          <Action title="Sync Now" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={() => void refresh({ full: true })} />
        </ActionPanel>
      }
    />
  );

  return (
    <List isLoading={loading} searchBarPlaceholder="Filter lists">
      <List.Section title="Lists">
        {snapshot.inboxId && item(snapshot.inboxId, "Inbox", Icon.Tray)}
        {ungrouped.map((p) => item(p.id, p.name))}
      </List.Section>
      {groups.map((g) => (
        <List.Section key={g.id} title={g.name}>
          {projects.filter((p) => p.groupId === g.id).map((p) => item(p.id, p.name))}
        </List.Section>
      ))}
    </List>
  );
}
