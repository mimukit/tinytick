import { Action, ActionPanel, Clipboard, Color, Icon, List, Toast, closeMainWindow, getSelectedText, popToRoot, showHUD, showToast, useNavigation } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { draftToTask, parseQuickAdd, resolveList, type ParsedMatch } from "../parse/quickadd";
import { create, refreshIfStale } from "../store/actions";
import { useLive } from "../store/live";
import { prefs } from "../store/service";
import { projectName } from "../store/snapshot";

const MATCH_COLOR: Record<ParsedMatch["kind"], Color> = {
  date: Color.Green,
  range: Color.Green,
  repeat: Color.Green,
  reminder: Color.Orange,
  priority: Color.Red,
  list: Color.Blue,
  tag: Color.Purple,
  checklist: Color.SecondaryText,
};

/** The token being typed at the end of the line, when it is a `~list` or `#tag`. */
function trailingToken(text: string): { kind: "list" | "tag"; query: string; start: number } | undefined {
  const m = /(?:^|\s)([~#])([^\s~#"]*)$/.exec(text);
  if (!m) return undefined;
  return { kind: m[1] === "~" ? "list" : "tag", query: m[2].toLowerCase(), start: text.length - m[2].length - 1 };
}

export interface QuickAddProps {
  defaultProjectId?: string;
  defaultDue?: Date;
  /** Text from the command argument. It replaces the pre-fill preference. */
  initialText?: string;
  /** Pop back to the calling screen after a create, in place of closing the window. */
  popOnCreate?: boolean;
}

export function QuickAddView({ defaultProjectId, defaultDue, initialText, popOnCreate }: QuickAddProps) {
  const { snapshot } = useLive();
  const { pop } = useNavigation();
  const [text, setText] = useState(initialText ?? "");
  const [ignoreDates, setIgnoreDates] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshIfStale();
    const mode = prefs().prefill;
    if (mode === "none" || popOnCreate || initialText) return;
    const read = mode === "clipboard" ? Clipboard.readText() : getSelectedText();
    read.then((value) => value && setText((t) => t || value.trim().split("\n")[0])).catch(() => undefined);
  }, []);

  const draft = useMemo(() => parseQuickAdd(text, { ignoreDates }), [text, ignoreDates]);
  const list = resolveList(draft.listQuery, snapshot.projects, snapshot.inboxId);
  const unknownList = !!draft.listQuery && !list;
  const targetId = list?.id ?? defaultProjectId;
  const targetName = targetId ? projectName(snapshot, targetId) : "Inbox";
  const token = trailingToken(text);

  async function submit(keepOpen: boolean) {
    if (!draft.title || busy) return;
    if (unknownList) {
      await showToast({ style: Toast.Style.Failure, title: `No list matches “${draft.listQuery}”` });
      return;
    }
    setBusy(true);
    const task = await create(draftToTask(draft, { projectId: targetId, defaultDue }));
    setBusy(false);
    if (!task) return;
    setIgnoreDates(false);
    setText("");
    if (keepOpen) {
      await showToast({ style: Toast.Style.Success, title: "Added", message: task.title });
    } else if (popOnCreate) {
      pop();
      await showToast({ style: Toast.Style.Success, title: "Added", message: task.title });
    } else {
      // Tinycast's showHUD does not close the window as Raycast's does, so close it and reset the launcher here.
      await showHUD(`Added: ${task.title}`);
      await closeMainWindow({ clearRootSearch: true });
      await popToRoot();
    }
  }

  function complete(value: string) {
    if (!token) return;
    setText(`${text.slice(0, token.start)}${value} `);
  }

  const accessories: List.Item.Accessory[] = draft.matches.map((m) => ({
    tag: { value: m.label, color: MATCH_COLOR[m.kind] },
    tooltip: m.text,
  }));
  if (!list && !draft.listQuery) accessories.push({ text: targetName });
  if (!draft.dueDate && defaultDue) accessories.push({ tag: { value: "Today", color: Color.Green }, tooltip: "Default date of this view" });

  const createActions = (
    <>
      <Action title="Add Task" icon={Icon.Plus} onAction={() => void submit(false)} />
      <Action title="Add and Keep Open" icon={Icon.PlusCircle} shortcut={{ modifiers: ["cmd"], key: "return" }} onAction={() => void submit(true)} />
      <Action
        title={ignoreDates ? "Parse Dates Again" : "Keep Date Words in Title"}
        icon={Icon.Calendar}
        shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
        onAction={() => setIgnoreDates((v) => !v)}
      />
    </>
  );

  const suggestions =
    token?.kind === "list"
      ? [
          ...(snapshot.inboxId ? [{ id: snapshot.inboxId, name: "Inbox" }] : []),
          ...snapshot.projects.map((p) => ({ id: p.id, name: p.name })),
        ]
          .filter((p) => p.name.toLowerCase().includes(token.query))
          .slice(0, 8)
          .map((p) => ({ key: `list-${p.id}`, title: `~${p.name}`, insert: /\s/.test(p.name) ? `~"${p.name}"` : `~${p.name}`, icon: Icon.Folder }))
      : token?.kind === "tag"
        ? snapshot.tags
            .filter((t) => t.name.toLowerCase().includes(token.query))
            .slice(0, 8)
            .map((t) => ({ key: `tag-${t.name}`, title: `#${t.name}`, insert: `#${t.name}`, icon: Icon.Tag }))
        : [];

  return (
    <List
      searchText={text}
      onSearchTextChange={setText}
      filtering={false}
      isLoading={busy}
      navigationTitle="Add Task"
      searchBarPlaceholder="call bank tomorrow 3pm !high #admin ~Personal"
    >
      {!text.trim() ? (
        <List.EmptyView
          icon={Icon.Plus}
          title="Type a task"
          description={'Dates: tomorrow 3pm, fri, every mon · !high · #tag · ~list · :: item; item · "quoted text" stays in the title'}
        />
      ) : (
        <>
          {suggestions.length > 0 && (
            <List.Section title={token?.kind === "list" ? "Lists" : "Tags"}>
              {suggestions.map((s) => (
                <List.Item
                  key={s.key}
                  title={s.title}
                  icon={s.icon}
                  actions={
                    <ActionPanel>
                      <Action title="Insert" icon={Icon.Text} onAction={() => complete(s.insert)} />
                      {createActions}
                    </ActionPanel>
                  }
                />
              ))}
            </List.Section>
          )}
          <List.Section title="Preview">
            <List.Item
              id="preview"
              title={draft.title || "Untitled"}
              subtitle={unknownList ? `No list “${draft.listQuery}”` : list ? list.name : undefined}
              icon={unknownList ? { source: Icon.ExclamationMark, tintColor: Color.Red } : Icon.Circle}
              accessories={accessories}
              actions={<ActionPanel>{createActions}</ActionPanel>}
            />
          </List.Section>
        </>
      )}
    </List>
  );
}
