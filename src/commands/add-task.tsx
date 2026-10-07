import { showHUD, type LaunchProps } from "@raycast/api";
import { errorMessage } from "../api/errors";
import { draftToTask, parseQuickAdd, resolveList } from "../parse/quickadd";
import { loadSnapshot, openApi, saveSnapshot } from "../store/service";
import { upsertTask } from "../store/snapshot";

export default async function Command(props: LaunchProps<{ arguments: { text: string } }>) {
  const draft = parseQuickAdd(props.arguments.text ?? "");
  if (!draft.title) {
    await showHUD("Type a task title");
    return;
  }
  const snapshot = loadSnapshot();
  const list = resolveList(draft.listQuery, snapshot.projects, snapshot.inboxId);
  if (draft.listQuery && !list) {
    await showHUD(`No list matches “${draft.listQuery}”. Run Sync if the list is new.`);
    return;
  }
  try {
    const task = await (await openApi()).createTask(draftToTask(draft, { projectId: list?.id }));
    if (task?.id) saveSnapshot(upsertTask(loadSnapshot(), task));
    const labels = draft.matches.filter((m) => m.kind !== "tag" && m.kind !== "checklist").map((m) => m.label);
    await showHUD(`Added: ${draft.title}${labels.length ? ` · ${labels.join(" · ")}` : ""}`);
  } catch (error) {
    await showHUD(`Could not add: ${errorMessage(error)}`);
  }
}
