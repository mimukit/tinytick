import { Icon, LaunchType, MenuBarExtra, launchCommand } from "@raycast/api";
import { loadSnapshot } from "../store/service";
import { selectView, sortTasks, todayCounts, isOverdue } from "../views/select";

/** Reads the cache only. It makes no network call. */
export default function Command() {
  const snapshot = loadSnapshot();
  const { overdue, today } = todayCounts(snapshot);
  const tasks = sortTasks(selectView(snapshot, "today"), "date", snapshot).slice(0, 10);
  const open = (name: string) => () => void launchCommand({ name, type: LaunchType.UserInitiated });
  const title = overdue ? `${today + overdue} (${overdue}!)` : String(today);

  return (
    <MenuBarExtra icon={Icon.CheckCircle} title={title} tooltip="TickTick today">
      <MenuBarExtra.Section title={`${overdue} overdue · ${today} today`}>
        {tasks.map((t) => (
          <MenuBarExtra.Item key={t.id} title={t.title} icon={isOverdue(t) ? Icon.ExclamationMark : Icon.Circle} onAction={open("today")} />
        ))}
      </MenuBarExtra.Section>
      <MenuBarExtra.Section>
        <MenuBarExtra.Item title="Open Today" icon={Icon.List} shortcut={{ modifiers: ["cmd"], key: "t" }} onAction={open("today")} />
        <MenuBarExtra.Item title="Quick Add" icon={Icon.Plus} shortcut={{ modifiers: ["cmd"], key: "n" }} onAction={open("quick-add")} />
        <MenuBarExtra.Item title="Sync" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={open("sync")} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
