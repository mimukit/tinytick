// Smoke test: drives tinytick's built bundles through Tinycast's own JavaScript
// runtime (the Raycast shim and React reconciler Tinycast ships), with a fake
// TickTick server. It checks the requests each flow sends.
//
//   git clone --depth 1 https://github.com/abue-ammar/tinycast ../tinycast
//   pnpm build && pnpm smoke ../tinycast
//
// The Swift renderer is not covered. Run the QA plan in Tinycast for that.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tinycastDir = resolve(process.argv[2] ?? process.env.TINYCAST_DIR ?? "../tinycast");
const harnessPath = join(tinycastDir, "Scripts/raycast-runtime/test.mjs");
if (!existsSync(harnessPath)) {
  console.error(`No Tinycast checkout at ${tinycastDir}. Pass its path: pnpm smoke <path>`);
  process.exit(1);
}
const dist = resolve(import.meta.dirname, "../dist");
const { createHarness, bootConfig, describeTree, preferenceDefault } = await import(pathToFileURL(harnessPath).href);
const manifest = JSON.parse(readFileSync(join(dist, "package.json"), "utf8"));

const fmt = (d) => { const p=(n)=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00.000+0000`; };
const today = new Date(); today.setHours(0,0,0,0);
const yesterday = new Date(today.getTime() - 86400000);
const tasks = [
  { id: "a1", projectId: "p1", title: "Pay rent", status: 0, priority: 5, dueDate: fmt(today), isAllDay: true, tags: ["money"] },
  { id: "a2", projectId: "p2", title: "Write report", status: 0, priority: 1, dueDate: fmt(yesterday), isAllDay: true,
    items: [{ id: "i1", title: "Outline", status: 1, sortOrder: 0 }, { id: "i2", title: "Draft", status: 0, sortOrder: 1 }] },
  { id: "a3", projectId: "inbox9", title: "Inbox thing", status: 0 },
];
const snapshot = { version: 1, syncedAt: Date.now(), source: "open", inboxId: "inbox9",
  projects: [{ id: "p1", name: "Personal" }, { id: "p2", name: "Work" }], groups: [], tags: [{ name: "money" }], tasks };

function fakeServer(calls) {
  return async ([spec]) => {
    const path = spec.url.replace("https://api.ticktick.com", "");
    const body = spec.bodyBase64 ? JSON.parse(Buffer.from(spec.bodyBase64, "base64").toString()) : undefined;
    calls.push(`${spec.method} ${path}${body ? " " + JSON.stringify(body) : ""}`);
    let reply = "";
    if (path.startsWith("/api/v2/batch/check/")) reply = JSON.stringify({ checkPoint: 77, inboxId: "inbox9", projectProfiles: snapshot.projects, tags: snapshot.tags, syncTaskBean: { update: tasks } });
    else if (path.startsWith("/api/v2/")) reply = "{}";
    else if (path === "/open/v1/project") reply = JSON.stringify(snapshot.projects);
    else if (path.endsWith("/data")) reply = JSON.stringify({ tasks: tasks.filter((t) => path.includes(t.projectId) || (path.includes("inbox") && t.projectId === "inbox9")) });
    else if (path === "/open/v1/tag") reply = JSON.stringify([{ name: "money" }]);
    else if (path === "/open/v1/task") reply = JSON.stringify({ id: "new1", projectId: body.projectId ?? "inbox9", ...body });
    else if (path === "/open/v1/task/completed") reply = JSON.stringify([{ id: "d1", projectId: "p1", title: "Done earlier", status: 2, completedTime: fmt(today) }]);
    else if (path.startsWith("/open/v1/task/") && spec.method === "POST") reply = JSON.stringify({ ...tasks.find((t) => path.endsWith(t.id)), ...body });
    else if (path === "/open/v1/task/completed") reply = JSON.stringify([{ id: "d1", projectId: "p1", title: "Done earlier", status: 2, completedTime: fmt(today) }]);
    return { status: 200, statusText: "OK", headers: { "content-type": "application/json" }, url: spec.url, bodyBase64: Buffer.from(reply).toString("base64") };
  };
}

function findAll(node, pred, out = []) {
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  for (const c of node.children ?? []) findAll(c, pred, out);
  for (const v of Object.values(node.props ?? {})) if (v && typeof v === "object" && v.type) findAll(v, pred, out);
  return out;
}

// Answers /usr/bin/security from memory, so the smoke run never touches the real Keychain.
// child_process is a sync host call, which the harness's async stubs do not cover.
function fakeKeychain(harness, items) {
  const host = harness.context.__tinycastHost;
  const invokeSync = host.invokeSync.bind(host);
  const b64 = (s) => Buffer.from(s).toString("base64");
  host.invokeSync = (api, method, argsJson) => {
    const spec = JSON.parse(argsJson)[0];
    if (api !== "proc" || method !== "run" || spec?.command !== "/usr/bin/security") return invokeSync(api, method, argsJson);
    const [verb, ...rest] = spec.args;
    const account = rest[rest.indexOf("-a") + 1];
    let status = 0, stdout = "";
    if (verb === "find-generic-password") {
      if (items[account] === undefined) status = 44;
      else stdout = `${items[account]}\n`;
    } else if (verb === "delete-generic-password") {
      if (items[account] === undefined) status = 44;
      delete items[account];
    } else {
      status = 1;
    }
    return JSON.stringify({ ok: true, value: { stdout: b64(stdout), stderr: "", status } });
  };
}

async function run(commandName, { args = {}, signedIn = true, interact, v2 = false } = {}) {
  const cmd = manifest.commands.find((c) => c.name === commandName);
  const calls = [], toasts = [];
  const harness = createHarness({
    verbose: !!process.env.VERBOSE,
    stubs: {
      "fetch.request": fakeServer(calls),
      "feedback.showToast": (a) => { toasts.push(JSON.stringify(a[0]?.title ?? a)); return "toast-1"; },
      "feedback.showHUD": (a) => { toasts.push(`HUD ${JSON.stringify(a)}`); return null; },
    },
  });
  fakeKeychain(harness, { "api-token": signedIn ? "tok" : undefined, "v2-cookie": v2 ? "t=cookie123" : undefined });
  harness.boot(bootConfig({
    environment: { ...bootConfig().environment, extensionName: manifest.name, commandName, commandMode: cmd.mode, assetsPath: join(dist, "assets") },
    preferences: { ...Object.fromEntries(manifest.preferences.map((p) => [p.name, preferenceDefault(p)])), ...(v2 ? { enableV2: true } : {}) },
    caches: { default: { snapshot: JSON.stringify(snapshot) } },
    launchProps: { arguments: args },
  }));
  const file = join(dist, `${commandName}.js`);
  harness.start("s1", readFileSync(file, "utf8"), file, dist, cmd.mode === "view" ? "view" : cmd.mode === "menu-bar" ? "menu-bar" : "no-view", { launchProps: { arguments: args } });
  await new Promise((r) => setTimeout(r, 700));
  console.log(`\n=== ${commandName} ===`);
  if (harness.state.failures.length) console.log("FAILURES:", harness.state.failures);
  const tree = harness.state.trees.at(-1);
  let failed = harness.state.failures.length;
  if (interact && tree) {
    try {
      await interact({ harness, tree, calls, toasts });
    } catch (error) {
      console.log(`✗ ${error.message}`);
      failed += 1;
    }
  }
  const last = harness.state.trees.at(-1);
  if (last && process.env.TREE) console.log(describeTree(last));
  if (process.env.VERBOSE) console.log("calls:", calls, "toasts:", toasts);
  harness.stop("s1");
  return failed;
}

const actionNamed = (tree, title) => findAll(tree, (n) => n.props?.title === title && n.props?.onAction?.$fn)[0];
async function press(ctx, title) {
  const a = actionNamed(ctx.harness.state.trees.at(-1), title);
  assert.ok(a, `action "${title}" exists`);
  ctx.harness.dispatch("s1", a.props.onAction.$fn, []);
  await new Promise((r) => setTimeout(r, 300));
}

// The action on the row with this title, so a test does not depend on row order.
async function pressOn(ctx, row, title) {
  const item = findAll(ctx.harness.state.trees.at(-1), (n) => n.type === "List.Item" && n.props?.title === row).at(-1);
  assert.ok(item, `row "${row}" exists`);
  const a = actionNamed(item.props.actions, title);
  assert.ok(a, `action "${title}" exists on "${row}"`);
  ctx.harness.dispatch("s1", a.props.onAction.$fn, []);
  await new Promise((r) => setTimeout(r, 300));
}

// Chooses a value in the open picker's dropdown, as Tinycast does when you press ↵ on an item.
async function choose(ctx, value) {
  const field = findAll(ctx.harness.state.trees.at(-1), (n) => n.type === "Form.Dropdown").at(-1);
  assert.ok(field, "a picker dropdown is open");
  const values = findAll(field, (n) => n.type === "Form.Dropdown.Item").map((n) => n.props.value);
  assert.ok(values.includes(value), `picker offers "${value}": ${values}`);
  ctx.harness.dispatch("s1", field.props.onTinycastChange.$fn, [value]);
  await new Promise((r) => setTimeout(r, 300));
  const screens = ctx.harness.state.trees.at(-1).children ?? [];
  assert.equal(screens.length, 1, `the picker closes after a choice: ${screens.length} screens`);
}

let failures = 0;
const sent = (calls, re) => calls.some((c) => re.test(c));

failures += await run("today", { interact: async (ctx) => {
  await pressOn(ctx, "Write report", "Set Priority…");
  await choose(ctx, "5");
  await pressOn(ctx, "Write report", "Set Date…");
  await choose(ctx, "Tomorrow");
  await press(ctx, "Complete");
  const undo = findAll(ctx.harness.state.trees.at(-1), (n) => /^Undo/.test(n.props?.title ?? ""))[0];
  assert.ok(undo, "an Undo action shows after a write");
  assert.deepEqual(undo.props.shortcut, { modifiers: ["cmd"], key: "z" });
  await press(ctx, undo.props.title);
  await press(ctx, "Show Completed");
  assert.ok(sent(ctx.calls, /^POST \/open\/v1\/task\/a2 \{"priority":5,"id":"a2","projectId":"p2"\}$/), "priority sends one field");
  assert.ok(sent(ctx.calls, /^POST \/open\/v1\/task\/a2 \{"dueDate":/), "date change sends dates");
  assert.ok(sent(ctx.calls, /^POST \/open\/v1\/project\/p1\/task\/a1\/complete$/), "complete");
  assert.ok(sent(ctx.calls, /^POST \/open\/v1\/task\/a1 \{"status":0/), "undo reopens");
  assert.ok(sent(ctx.calls, /^POST \/open\/v1\/task\/completed/), "show completed fetches");
}});
failures += await run("today", { interact: async (ctx) => {
  await pressOn(ctx, "Write report", "Open Task");
  await press(ctx, "Check");
  const list = findAll(ctx.harness.state.trees.at(-1), (n) => n.type === "List" && n.props?.onSearchTextChange?.$fn).at(-1);
  ctx.harness.dispatch("s1", list.props.onSearchTextChange.$fn, ["Proofread"]);
  await new Promise((r) => setTimeout(r, 300));
  await press(ctx, "Add Item");
  assert.ok(sent(ctx.calls, /"title":"Draft","status":1/), "check item");
  assert.ok(sent(ctx.calls, /"title":"Proofread","status":0,"sortOrder":2/), "add item");
}});
failures += await run("today", { interact: async (ctx) => {
  const sectionTitles = () => findAll(ctx.harness.state.trees.at(-1), (n) => n.type === "List.Section").map((n) => n.props.title);
  assert.ok(sectionTitles().every((t) => ["High", "Medium", "Low", "No Priority"].includes(t)), `grouped by priority by default: ${sectionTitles()}`);
  await pressOn(ctx, "Pay rent", "Group By…");
  await choose(ctx, "time");
  assert.equal(sectionTitles().at(-1), "Overdue", `Overdue is the last time section: ${sectionTitles()}`);
  const menu = findAll(ctx.tree, (n) => n.type === "List.Item" && n.props.title === "Pay rent")[0];
  const actions = findAll(menu.props.actions, (n) => n.type === "Action");
  const titles = actions.map((n) => n.props.title);
  const keys = actions.map((n) => n.props.shortcut && `${n.props.shortcut.modifiers.join("+")}+${n.props.shortcut.key}`);
  for (const k of ["cmd+1", "cmd+2", "cmd+3", "ctrl+1", "ctrl+2", "ctrl+3"]) assert.ok(keys.includes(k), `row has the ${k} shortcut`);
  assert.ok(titles.length <= 24, `action panel stays short: ${titles.length}`);
  const labels = findAll(menu.props.detail, (n) => n.type === "Detail.Metadata.Label").map((n) => n.props.title);
  for (const t of ["List", "Date", "Priority"]) assert.ok(labels.includes(t), `the detail pane shows ${t}: ${labels}`);
  await pressOn(ctx, "Pay rent", "Priority Low");
  assert.ok(sent(ctx.calls, /"priority":1,/), "ctrl+3 sets low priority");
}});
failures += await run("today", { signedIn: false, interact: async (ctx) => {
  // Rows, not an EmptyView: Tinycast shows the ↵ and ⌘K pill only when a row is selected.
  const rows = findAll(ctx.tree, (n) => n.type === "List.Item");
  assert.deepEqual(rows.map((r) => r.props.title), ["Sign in with an API token", "Open Account"], "sign-in rows");
  const first = (row) => findAll(row.props.actions, (n) => n.type === "Action")[0]?.props.title;
  assert.deepEqual(rows.map(first), ["Enter API Token", "Open Account"], "each row's primary action");
  await press(ctx, "Enter API Token");
  assert.ok(findAll(ctx.harness.state.trees.at(-1), (n) => n.type === "Form.PasswordField" && n.props.id === "token").length, "token form opens");
}});
failures += await run("quick-add", { interact: async (ctx) => {
  const list = findAll(ctx.tree, (n) => n.type === "List" && n.props?.onSearchTextChange?.$fn)[0];
  ctx.harness.dispatch("s1", list.props.onSearchTextChange.$fn, ["groceries tomorrow !med ~Wo :: milk; eggs"]);
  await new Promise((r) => setTimeout(r, 300));
  await press(ctx, "Add Task");
  assert.ok(sent(ctx.calls, /^POST \/open\/v1\/task \{"title":"groceries","projectId":"p2".*"priority":3,"kind":"CHECKLIST"/), "quick add body");
}});
failures += await run("add-task", { args: { text: "call bank tomorrow 3pm !high #admin ~Personal" }, interact: async (ctx) => {
  assert.ok(sent(ctx.calls, /^POST \/open\/v1\/task \{"title":"call bank","projectId":"p1","isAllDay":false,"dueDate":"\d{4}-\d\d-\d\dT15:00:00.*"priority":5,"tags":\["admin"\]/), "one-line add body");
}});
failures += await run("sync", { interact: async (ctx) => {
  assert.equal(ctx.calls.filter((c) => c.startsWith("GET /open/v1/project/") && c.endsWith("/data")).length, 3, "inbox plus two lists");
}});
failures += await run("lists");
failures += await run("search");
failures += await run("completed");
failures += await run("account");
failures += await run("menu-bar", { interact: async (ctx) => {
  assert.ok(findAll(ctx.tree, (n) => n.type === "MenuBarExtra" && n.props.title === "2 (1!)").length, "menu bar count");
  assert.equal(ctx.calls.length, 0, "menu bar makes no request");
}});
failures += await run("sync", { v2: true, interact: async (ctx) => {
  assert.deepEqual(ctx.calls, ["GET /api/v2/batch/check/0"], "v2 sync is one request");
}});
failures += await run("today", { v2: true, interact: async (ctx) => {
  await press(ctx, "Pin");
  await press(ctx, "Won't Do");
  assert.ok(sent(ctx.calls, /^POST \/api\/v2\/batch\/task .*"pinnedTime"/), "pin");
  assert.ok(sent(ctx.calls, /^POST \/api\/v2\/batch\/task .*"status":-1/), "won't do");
}});
failures += await run("today", { interact: async (ctx) => {
  assert.equal(findAll(ctx.tree, (n) => n.props?.title === "Pin" || n.props?.title === "Won't Do").length, 0, "no v2 action with v2 off");
}});
console.log(failures ? `\n✗ ${failures} failure(s)` : "\n✓ smoke passed");
process.exit(failures ? 1 : 0);
