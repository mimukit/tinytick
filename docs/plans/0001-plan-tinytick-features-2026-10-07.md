# Plan: tinytick, a TickTick extension for Tinycast

Grilled: 2026-10-07

## Context

I want to manage my TickTick tasks from the Tinycast launcher. The two Raycast TickTick extensions do not fit my workflow. `ticktick` drives the macOS TickTick app through AppleScript, so the Electron app must run all the time. `ticktick-plus` uses the web API, but it syncs every project on every view, sends every date as all-day, and has no natural-language quick add. Neither changes priority or date from a list shortcut.

tinytick talks to the TickTick web API directly. It needs no TickTick desktop app. Success is three things I do every day without the TickTick app open:

- Add a task in one line, such as `call bank tomorrow 3pm !high #admin ~Personal`.
- Open Today, complete tasks, and change date and priority from the keyboard.
- Open a task and manage its checklist items.

The research for this plan is in [2026-10-07-research-api-host-prior-art.md](https://github.com/mimukit/ideas) (kept in the ideas repo).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Repo | `mimukit/tinytick`, public, MIT license. The code lives there, not in the ideas repo. |
| Tooling | pnpm, TypeScript, esbuild, vitest. No Raycast CLI and no Raycast scaffold. `@raycast/api` is a dev dependency for types only. |
| Build output | `scripts/build.mjs` writes `dist/package.json` (a hand-written Raycast manifest) and one CommonJS bundle per command, with `react` and `@raycast/api` left external. Tinycast runs this format unchanged. |
| Install | "Add from folder" in Tinycast once. After that, `pnpm build:install` copies `dist/` into Tinycast's extensions folder, so a rebuild needs no reinstall. |
| API policy | Hybrid. The official Open API (`/open/v1`) does every core job. The unofficial v2 API (`/api/v2`) is an opt-in setting, used only for features the Open API lacks. Every v2 feature is hidden when v2 is off. |
| Login order | The personal API token login ships first. The browser OAuth spike follows in the same phase. If OAuth works, it becomes the default login and the token moves to "Advanced". |
| OAuth shape | My own TickTick developer app. `OAuth.PKCEClient.authorize()` returns the code, and the extension does the exchange itself with HTTP Basic. Tinycast cannot use the Raycast OAuth proxy that `ticktick-plus` uses. |
| Secrets | The API token, the OAuth token and the v2 cookie each go in the Keychain through `PKCEClient.setTokens`. The client ID is a normal preference. You type the client secret in the login form, and the extension uses it for one exchange and stores it nowhere. No secret goes in a password preference, because Tinycast stores those as plaintext JSON. |
| v2 auth | A pasted `t` session cookie from a logged-in browser. Password login is out, because two-step verification blocks it. |
| Audience and server | Personal use first, no store listing in v1. `ticktick.com` only, with the base URLs in one constant. |
| Sync model | Cache first. Views render from the local cache at once. If the cache is older than the refresh age (default 10 minutes, or "never"), the view refreshes in the background with `isLoading` and updates the rows in place. A manual Sync command and a `⌘R` action refresh on demand. |
| Write shape | A write sends only the changed fields plus `id` and `projectId`. The last write wins per field. The server reply replaces the cache entry. |
| Failed write | The cache change reverts, and a failure toast shows the error. No offline queue. |
| Enter on a task | On an open row, Enter completes the task. On a completed row, Enter opens the task screen, and "Reopen" is in the actions panel with no key. |
| Undo | A stack of the last 10 row writes per open window. `⌘Z` is a row action that shows only when the stack has an entry. Each press reverts one write with one API call. Delete has a confirmation and no undo. The stack dies when the window closes. |
| Repeating tasks | A complete on a repeating task refetches that list (`GET /project/{pid}/data`) to get the next occurrence. It does not go on the undo stack. |
| Today scope | Match TickTick: tasks due today, overdue tasks, and tasks whose start-to-due range covers today. A range task shows once, in Today. |
| Show completed | A toggle that fetches today's completed tasks with `POST /task/completed` when you turn it on. The result stays for the open window only. |
| Date-word escape | Text in double quotes never parses. The "Keep date words in title" action (`⌘⇧D`) drops the date match for the current entry. |
| Subtask focus | Checklist items (`items[]`) first. Real subtasks (`parentId`) show as read-only children in v1. |
| Resource budget | No background `interval` command and no menu bar in v1. No `@raycast/utils`. `chrono-node` English locale only. Each command bundle stays under 300 KB. |

## Approach

The chosen shape is a small client core and a few thin commands.

- `src/api/` holds a typed client for the Open API, a separate v2 client, one error class (from the `ticktick-plus` `TickTickApiError` pattern), and date helpers (`+HHMM` offsets, all-day anchored at local midnight).
- `src/auth/` holds the Keychain wrappers over `PKCEClient` and the OAuth exchange.
- `src/store/` holds the cache: projects, tags, open tasks, the Inbox ID, and a sync timestamp, in Tinycast `Cache`. View settings (group, sort) go to `LocalStorage`. Neither holds a secret.
- `src/parse/` holds the quick-add parser. It is pure TypeScript with unit tests and has no Raycast import.
- `src/undo/` holds the per-window undo stack. Each entry stores a task ID and the previous values of the changed fields.
- Each command reads the store, renders, and calls the client for writes.

Rejected alternatives:

- Live fetch on every view open, like `ticktick-plus`. It costs one call per project each time and makes the launcher wait on the network.
- v2 only, with one full-sync call. It has the most features, but one TickTick change can break every command, and it needs a session cookie.
- A native Swift plugin inside Tinycast. Tinycast has no native plugin API, and a fork is out of scope.
- `ray build` as the build step. It needs the Raycast CLI and has known problems with a pnpm `node_modules`.

### Feature list

The table maps each feature to a phase. "v2" marks a feature that needs the opt-in v2 setting.

| Area | Feature | Phase | Source |
|------|---------|-------|--------|
| Auth | Personal API token login | 1 | Open API |
| Auth | Browser OAuth login with my own client ID | 1 | Open API |
| Auth | Sign out: clear the Keychain entries and the cache | 1 | local |
| Sync | Sync command: projects, Inbox, tags, open tasks | 1 | Open API |
| Sync | Background refresh on open when the cache is stale | 1 | local |
| Sync | One-call full sync and delta sync | 6 | v2 |
| Quick Add | Natural-language input with a live preview row | 2 | local parser |
| Quick Add | Dates, times, ranges, repeats, reminders, `#tag`, `~list`, `!priority`, `::` checklist | 2 | local parser |
| Quick Add | Quotes and `⌘⇧D` to keep date words in the title | 2 | local parser |
| Quick Add | Autocomplete rows for `~list` and `#tag` from the cache | 2 | cache |
| Quick Add | One-shot no-view command with a `text` argument | 2 | local parser |
| Quick Add | Pre-fill from the clipboard or selection (setting) | 2 | `ticktick` idea |
| Today | Overdue, due today, and ranges that cover today | 3 | cache |
| Today | Group by none, list, time, priority, tag | 3 | cache |
| Today | Sort by date, priority, title, list, created | 3 | cache |
| Today | Show completed today (toggle, fetched on demand) | 3 | `POST /task/completed` |
| Today | Show details panel (toggle) | 3 | `List.Item.Detail` |
| Today | View switch in the search bar: Today, Tomorrow, Next 7 Days, Inbox, All | 3 | cache |
| Row actions | Complete with Enter, reopen from the actions panel | 3 | Open API |
| Row actions | Priority, date, list, tags by shortcut | 3 | Open API |
| Row actions | Undo stack of 10 writes with `⌘Z` | 3 | local |
| Row actions | Edit form (title, notes, dates, time, repeat, reminder, list, tags) | 3 | Open API |
| Row actions | Delete with confirmation | 3 | Open API |
| Row actions | Open in the TickTick web app | 3 | URL |
| Task screen | Checklist items: add, rename, check, uncheck, delete, reorder | 4 | Open API `items[]` |
| Task screen | Progress accessory (3/5) on the parent row | 4 | cache |
| Task screen | Convert a checklist item to a task | 4 | Open API |
| Task screen | Real subtasks shown as children, read-only | 4 | `parentId` |
| Lists | Browse lists and project groups, open one as a task list | 5 | cache |
| Search | Search across open tasks, with a list filter | 5 | cache, then `POST /task/search` |
| Completed | Completed tasks by date range | 5 | `POST /task/completed` |
| Extras | Won't Do, pin | 6 | v2 |
| Extras | Real subtask create and reparent | 6 | `parentId` or v2 `batch/taskParent` |
| Extras | Menu bar count of overdue and today tasks, reading the cache only | 6 | cache |

### Quick Add grammar

The parser turns one line into a task draft. The preview row shows each match as a tag accessory, and the title keeps only the text the parser did not use.

| Token | Example | Result |
|-------|---------|--------|
| Date | `today`, `tmr`, `fri`, `next week`, `oct 12`, `in 3 days` | `dueDate`, all-day |
| Time | `3pm`, `at 15:30`, `tomorrow 9` | `dueDate` with time, nearest future match like TickTick |
| Range | `2pm-4pm`, `mon 10-11am` | `startDate` and `dueDate` |
| Repeat | `every day`, `every mon`, `weekdays`, `every 2 weeks`, `monthly on 1` | `repeatFlag` RRULE |
| Reminder | `remind 30m`, `remind 1d` before | `reminders` TRIGGER |
| Priority | `!high` `!med` `!low` `!none`, or `!3` `!2` `!1` `!0` | `priority` 5, 3, 1, 0 |
| List | `~Work`, `~"Side projects"` | `projectId`, fuzzy match on cached lists |
| Tag | `#admin` | `tags[]`, new tags allowed |
| Checklist | `:: buy milk; eggs; bread` at the end | `items[]`, kind CHECKLIST |
| Quote | `"plan the march" fri` | Quoted text goes to the title unparsed |
| Escape | `\#1 fan` | A literal `#` in the title |

`chrono-node` (English only) finds the date and time. The parser handles the symbols, repeats, and reminders itself. With no `~list`, the task goes to the Inbox, or to Today's date when Quick Add opens from the Today screen.

### Keyboard map on a task row

Tinycast reserves `⌘W`, `⌘,`, `⌘.`, `⌘Q` and `⌃N/P/F/B`. An extension shortcut takes priority over the other palette keys. `⌘↩` fires only an action that declares `cmd+return` itself, so the task-screen action declares it.

| Key | Action |
|-----|--------|
| `↵` | Open row: complete. Completed row: open the task screen. |
| `⌘↩` | Open the task screen (declared shortcut) |
| `⌘Z` | Undo the last row write (shows only when the stack has an entry) |
| `⌃0` `⌃1` `⌃2` `⌃3` | Priority none, low, medium, high |
| `⌘1` `⌘2` `⌘3` | Due today, tomorrow, next week |
| `⌘D` | Date submenu: presets, "type a date" form, clear |
| `⌘M` | Move to list submenu |
| `⌘⇧T` | Tag submenu (toggle cached tags) |
| `⌘E` | Edit form |
| `⌘N` | Quick Add, with the current view's defaults |
| `⌘⇧N` | Add a checklist item to this task |
| `⌘⇧G` | Group by submenu |
| `⌘⇧S` | Sort by submenu |
| `⌘⇧C` | Toggle show completed |
| `⌘I` | Toggle the details panel |
| `⌘R` | Sync now |
| `⌘O` | Open in the TickTick web app |
| `⌘⌫` | Delete, with confirmation |

On the task screen, `⌘⌥↑` and `⌘⌥↓` reorder a checklist item. If Tinycast takes those keys, the fallback is `⌘⇧↑` and `⌘⇧↓`.

### Commands

| Command | Mode | Purpose |
|---------|------|---------|
| Today | view | The main screen. The search-bar dropdown switches to Tomorrow, Next 7 Days, Inbox, All. |
| Quick Add | view | Search text is the input. Live preview row, autocomplete rows for lists and tags. |
| Add Task | no-view | `text` argument from the root search. Parse, create, show a HUD. |
| Sync | no-view | Refresh the cache. Show a HUD with the counts. |
| Lists | view | Phase 5. |
| Search | view | Phase 5. |
| Account | view | Sign in, sign out, v2 cookie, cache age. |

### Phase 0: repo and build

- Create `mimukit/tinytick` (public, MIT) with pnpm, TypeScript, esbuild, vitest, and `@raycast/api` as a dev dependency.
- Write `scripts/build.mjs`: bundle each command to CommonJS with `react` and `@raycast/api` external, and write `dist/package.json`.
- Add `pnpm build:install`, which copies `dist/` into Tinycast's extensions folder.
- Add a hello-world Today command.

Done when: `pnpm build` writes `dist/package.json` and `dist/today.js`, the folder installs in Tinycast with "Add from folder", and after a change, `pnpm build:install` shows the change in Tinycast without a reinstall.

### Phase 1: client, auth, sync

- Build the Open API client, the error class, and the date helpers.
- Build the Keychain wrappers over `PKCEClient.setTokens` and `getTokens`. Check that two `providerId` values give two separate Keychain entries. If they do not, store all secrets in one token object.
- Build the token login in the Account command.
- Run the OAuth spike: register a TickTick developer app, try the redirect URIs `https://raycast.com/redirect?packageName=Extension`, `tinycast://oauth`, and `raycast://oauth?package_name=Extension`. Exchange the code with HTTP Basic, using the secret from the login form only. Record which redirect URI TickTick accepts. If one works, make OAuth the default login.
- Confirm that `POST /task/{id}` accepts a partial body. If it does not, fetch the task before an edit and send the merged object.
- Build the Sync command: `GET /project`, the Inbox (try `GET /project/inbox/data`, else `POST /task/undone` with `"inbox"`), one `GET /project/{pid}/data` per project in parallel with a limit of 4, and `GET /tag`.
- Store the snapshot in `Cache` with a timestamp. Add the background stale refresh with the age setting.

Done when: Sync returns a HUD such as "Synced 14 lists, 87 tasks". The Account screen shows the sync time and the login type. After a Tinycast restart, the login remains, and `extension-data/tinytick.json` contains no token, cookie or secret.

### Phase 2: Quick Add

- Write the parser in `src/parse/` with a unit test per grammar row above. Pin the reference date in tests.
- Build the Quick Add view: the preview row, list and tag autocomplete rows, Enter to create, `⌘↩` to create and keep the window open, `⌘⇧D` to keep date words.
- Build the Add Task no-view command.
- Add the pre-fill setting (none, clipboard, selection).

Done when: `pnpm test` passes for every grammar row. `call bank tomorrow 3pm !high #admin ~Personal` creates a task in TickTick web with that list, tag, priority and a 15:00 due time. `"plan the march" fri` creates the title `plan the march`, due Friday.

### Phase 3: Today and row actions

- Build the Today list from the cache: Overdue and Today sections, range tasks that cover today, and the group and sort settings kept in `LocalStorage`.
- Add the view dropdown, the details panel toggle, and show completed (fetched on toggle).
- Add every row action in the keyboard map. Each action changes the cache, sends the changed fields, pushes an undo entry, and reverts with a failure toast on error.
- Add the undo stack and the `⌘Z` action.
- Refetch the list after a complete on a repeating task.
- Build the Edit form with `Form.DatePicker` (date and time), a repeat dropdown, a reminder dropdown, a list dropdown, and a tag picker.

Done when: from Today I complete a task with `↵`, set priority with `⌃3`, and move a date with `⌘2`, then press `⌘Z` three times, and TickTick web shows all three changes reverted after a reload. A completed repeating task shows its next occurrence without a manual sync.

### Phase 4: task screen and checklist

- Build the task screen as a pushed `List`: a header item with the details, then one row per checklist item, then real subtasks as read-only rows.
- Add checklist actions: `↵` check or uncheck, the search bar as an "add item" input, rename, delete, reorder (`⌘⌥↑/↓`, fallback `⌘⇧↑/↓`), and convert to a task.
- Show the progress accessory (`3/5`) on parent rows in Today.

Done when: I add three checklist items, check two, and reorder one from the task screen, and TickTick web shows the same items, state and order.

### Phase 5: lists, search, completed

- Build the Lists command with project groups as sections. Opening a list reuses the Today list component.
- Build Search over the cache, with a list filter in the dropdown and a "search on server" action that calls `POST /task/search`.
- Add a Completed view by date range.

Done when: a search for a word in a task note finds the task, and opening any list shows the same row actions as Today.

### Phase 6: v2 extras (opt-in)

- Add the v2 client with the pasted cookie from the Keychain, the `X-Device` header, and a clear "v2 session expired" toast.
- Use `GET /batch/check/0` for a one-call sync. Try `GET /batch/check/{checkPoint}` as a delta sync.
- Add Won't Do and pin actions.
- Add real subtask create and reparent: try `parentId` through the Open API first, then `POST /batch/taskParent`.
- Add the menu bar command, which reads only the cache.

Done when: with v2 off, no v2 action shows and no request goes to `/api/v2`. With v2 on, Sync makes one request, and Won't Do on a task moves it to Won't Do in TickTick web.

## Open questions

These are facts that only a live test settles. Each one sits in the phase that tests it, with its fallback written in.

- Which redirect URI does TickTick accept, if any (Phase 1)?
- Does `POST /task/{id}` accept a partial body (Phase 1)?
- Does `GET /project/inbox/data` work with an Open API token (Phase 1)?
- Does the personal API token reach `/task/completed` and `/task/search` (Phase 1)?
- Do two `PKCEClient` provider IDs give two Keychain entries (Phase 1)?
- Does Tinycast pass `⌘⌥↑/↓` to an extension (Phase 4)?
- Does an update with `parentId` create a real subtask through the Open API (Phase 6)?

## Non-goals

- Any dependency on the TickTick desktop app or AppleScript.
- The Raycast CLI, the Raycast scaffold, and a Raycast store listing in v1.
- Habits, focus and pomodoro, countdowns, comments, the Eisenhower matrix, kanban columns, and collaboration (assign, members).
- AI tools. Tinycast does not run the `AI` API.
- Calendar views and a timeline.
- Other users' accounts and `dida365.com` in v1.
- Offline writes. A write with no network fails with a toast and changes nothing.
- An undo that survives a closed window.
- A background `interval` command in v1.
