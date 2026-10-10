# tinytick

A TickTick extension for the [Tinycast](https://github.com/abue-ammar/tinycast) launcher on macOS. It talks to the TickTick web API directly, so the TickTick desktop app does not have to run in the background.

- Quick Add in one line: `call bank tomorrow 3pm !high #admin ~Personal`
- A Today list you drive from the keyboard: complete with Enter, set priority with `⌃1`–`⌃3` or `⌘P`, move the date with `⌘1`–`⌘3` or `⌘D`, undo with `⌘Z`
- Checklist items managed from the launcher
- A local cache, so lists open at once. Writes go straight to TickTick.

## Status

Pre-release, personal use. The plan is in [docs/plans/0001-plan-tinytick-features-2026-10-07.md](docs/plans/0001-plan-tinytick-features-2026-10-07.md).

## Install

You need Tinycast with extensions turned on, Node 22 or later, and pnpm.

```sh
git clone https://github.com/mimukit/tinytick
cd tinytick
pnpm install
pnpm build
```

In Tinycast, open Settings › Extensions › Install New › Add from folder, and pick `dist/`. After that, `pnpm build:install` rebuilds and copies `dist/` over the installed copy, so you do not need to add it again. It writes to `~/Library/Application Support/com.tinycast.app/extensions/tinytick`. Set `TINYCAST_BUNDLE_ID=com.tinycast.app.dev` for a debug build of Tinycast, or `TINYCAST_EXT_DIR` for any other folder.

## Sign in

In TickTick, open Settings › Account › API Token and create a token. Then run the **Account** command, pick "Sign in with an API token", and paste it.

tinytick keeps the token, and the v2 cookie if you set one, in your login Keychain under the service `tinytick`. It reads and writes them with `/usr/bin/security`, and sends a secret to it on stdin, so the secret never appears in the process list. Tinycast keeps preferences, LocalStorage and Cache as plaintext JSON, so no secret goes there.

There is no browser sign-in. Tinycast dropped extension OAuth support in `v0.11.17-beta.115`.

## Commands

| Command | What it does |
|---------|--------------|
| Today | Overdue and today's tasks. The search bar dropdown switches to Tomorrow, Next 7 Days, Inbox and All. |
| Quick Add Task | Type a task, see the parsed result, press Enter. |
| Add Task | One line from the root search, no window. |
| Sync | Refresh the local cache. |
| Lists | Your lists, grouped by folder. Open one to get the same actions as Today. |
| Search Tasks | Search the cache. `⌘⇧F` searches on the server. |
| Completed Tasks | Tasks completed today, since yesterday, in 7 days or in 30 days. |
| Account | Sign in, sign out, the sync state and the v2 cookie. |
| Today Count | A menu bar count of overdue and today tasks. It reads the cache only. |

## Keys on a task row

| Key | Action |
|-----|--------|
| `↵` | Complete. On a completed row, open the task. |
| `⌘↵` | Open the task: details, checklist, subtasks |
| `⌘Z` | Undo the last change (up to 10, while the window is open) |
| `⌘1` `⌘2` `⌘3` | Due today, tomorrow, next Monday |
| `⌘D` | Set the date: a preset, a typed date, or clear |
| `⌃1` `⌃2` `⌃3` | Priority high, medium, low |
| `⌘P` | Set the priority |
| `⌘M` | Move to a list |
| `⌘⇧T` | Toggle a tag |
| `⌘E` | Edit the task |
| `⌘N` | Quick Add with this view's defaults |
| `⌘⇧N` | Add a checklist item |
| `⌘⇧G` / `⌘⇧S` | Group by (time, list, priority, tag) / sort by |
| `⌘⇧C` | Show or hide today's completed tasks |
| `⌘I` | Show or hide the details panel |
| `⌘R` | Sync now |
| `⌘O` | Open in TickTick web |
| `⌘⌫` | Delete, after a confirmation |

On the task screen, type in the search bar and press Enter to add a checklist item, or `⌘⇧↵` to add it as a subtask. Enter on an item checks it. `⌘⌥↑` and `⌘⌥↓` reorder items.

## Quick Add syntax

| Write | Example | Result |
|-------|---------|--------|
| A date | `today`, `tmr`, `fri`, `next week`, `oct 12`, `in 3 days` | Due that day |
| A time | `3pm`, `at 15:30`, `tomorrow 9` | Due at that time. A bare hour picks the nearest future time. |
| A range | `2pm-4pm`, `mon 10-11am` | Start and due time |
| A repeat | `every day`, `every mon and thu`, `weekdays`, `every 2 weeks`, `monthly on 1`, `yearly` | Repeats |
| A reminder | `remind 30m`, `remind 1d before` | Reminder before the due time |
| A priority | `!high` `!med` `!low` `!none`, or `!3` `!2` `!1` `!0` | Priority |
| A list | `~Work`, `~"Side projects"` | That list (fuzzy match) |
| A tag | `#admin` | Tag, new ones allowed |
| A checklist | `:: milk; eggs; bread` at the end | Checklist items |
| Quotes | `"plan the march" fri` | Quoted text stays in the title |
| An escape | `\#1 fan` | A literal `#` |

`⌘⇧D` in Quick Add keeps the date words in the title for that one entry.

## Preferences

- **Refresh on open:** refresh in the background when the cache is older than 5, 10 (default), 30 or 60 minutes, or never.
- **Quick Add pre-fill:** nothing, the clipboard or the selected text.
- **Safe edits:** fetch a task before each edit. Turn it on if TickTick drops fields on a partial update.
- **Unofficial v2 API:** one-call sync, Won't Do (`⌘⇧W`) and pin (`⌘⇧P`). It needs the `t` session cookie from a logged-in browser, set in Account. The v2 API is undocumented and can break.

## Development

```sh
pnpm typecheck
pnpm test                # Vitest: parser, views, cache, clients
pnpm build               # dist/, and fails if a command bundle is over 300 KB
pnpm smoke ../tinycast   # runs the bundles in Tinycast's JS runtime against a fake TickTick
```

`pnpm smoke` needs a Tinycast checkout (`git clone --depth 1 https://github.com/abue-ammar/tinycast`). It runs Tinycast's own Raycast shim and React reconciler in Node, so it catches API and render problems without a Mac. It does not cover the Swift renderer.

## License

MIT. See [LICENSE](LICENSE).
