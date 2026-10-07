import { describe, expect, it } from "vitest";
import { draftToTask, parseQuickAdd, resolveList } from "../src/parse/quickadd";
import type { Project } from "../src/api/types";

// Wednesday 7 October 2026, 16:00 local time.
const NOW = new Date(2026, 9, 7, 16, 0, 0);
const parse = (s: string, ignoreDates = false) => parseQuickAdd(s, { now: NOW, ignoreDates });
const ymd = (d?: Date) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : undefined);
const hm = (d?: Date) => (d ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : undefined);

describe("dates", () => {
  it.each([
    ["pay rent today", "2026-10-7"],
    ["pay rent tmr", "2026-10-8"],
    ["pay rent fri", "2026-10-9"],
    ["pay rent next week", "2026-10-14"],
    ["pay rent oct 12", "2026-10-12"],
    ["pay rent in 3 days", "2026-10-10"],
  ])("%s", (input, day) => {
    const d = parse(input);
    expect(ymd(d.dueDate)).toBe(day);
    expect(d.isAllDay).toBe(true);
    expect(d.title).toBe("pay rent");
  });

  it.each(["pay rent on fri", "pay rent by fri", "pay rent due fri"])("drops the lead-in word: %s", (input) => {
    expect(parse(input).title).toBe("pay rent");
  });
});

describe("times", () => {
  it("reads a time with am/pm", () => {
    const d = parse("call bank tomorrow 3pm");
    expect(ymd(d.dueDate)).toBe("2026-10-8");
    expect(hm(d.dueDate)).toBe("15:00");
    expect(d.isAllDay).toBe(false);
    expect(d.title).toBe("call bank");
  });

  it("reads a 24-hour time", () => {
    const d = parse("standup at 15:30");
    expect(hm(d.dueDate)).toBe("15:30");
    expect(d.title).toBe("standup");
  });

  it("reads a bare hour after a day as that hour", () => {
    const d = parse("dentist tomorrow 9");
    expect(ymd(d.dueDate)).toBe("2026-10-8");
    expect(hm(d.dueDate)).toBe("9:00");
  });

  it("picks the nearest future time for an hour with no am/pm", () => {
    const d = parse("call mom at 9");
    expect(ymd(d.dueDate)).toBe("2026-10-7");
    expect(hm(d.dueDate)).toBe("21:00");
  });
});

describe("ranges", () => {
  it("reads a time range", () => {
    const d = parse("deep work 2pm-4pm");
    expect(hm(d.startDate)).toBe("14:00");
    expect(hm(d.dueDate)).toBe("16:00");
    expect(d.title).toBe("deep work");
  });

  it("reads a day with a time range", () => {
    const d = parse("review mon 10-11am");
    expect(ymd(d.startDate)).toBe("2026-10-12");
    expect(hm(d.startDate)).toBe("10:00");
    expect(hm(d.dueDate)).toBe("11:00");
  });
});

describe("repeats", () => {
  it.each([
    ["water plants every day", "RRULE:FREQ=DAILY;INTERVAL=1", "2026-10-7"],
    ["water plants daily", "RRULE:FREQ=DAILY;INTERVAL=1", "2026-10-7"],
    ["gym every mon", "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO", "2026-10-12"],
    ["gym every mon and thu", "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH", "2026-10-8"],
    ["standup weekdays", "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR", "2026-10-7"],
    ["sprint every 2 weeks", "RRULE:FREQ=WEEKLY;INTERVAL=2", "2026-10-7"],
    ["pay rent monthly on 1", "RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1", "2026-11-1"],
    ["renew domain yearly", "RRULE:FREQ=YEARLY;INTERVAL=1", "2026-10-7"],
  ])("%s", (input, rule, first) => {
    const d = parse(input);
    expect(d.repeatFlag).toBe(rule);
    expect(ymd(d.dueDate)).toBe(first);
    expect(d.title).not.toMatch(/every|daily|weekdays|monthly|yearly/);
  });

  it("keeps a time on a repeat", () => {
    const d = parse("standup every day 9am");
    expect(d.repeatFlag).toBe("RRULE:FREQ=DAILY;INTERVAL=1");
    expect(hm(d.dueDate)).toBe("9:00");
    expect(d.isAllDay).toBe(false);
  });
});

describe("reminders", () => {
  it.each([
    ["call bank tomorrow 3pm remind 30m", "TRIGGER:-PT30M"],
    ["call bank tomorrow 3pm remind 1d before", "TRIGGER:-P1D"],
    ["call bank tomorrow 3pm remind 2h", "TRIGGER:-PT2H"],
  ])("%s", (input, trigger) => {
    const d = parse(input);
    expect(d.reminders).toEqual([trigger]);
    expect(d.title).toBe("call bank");
  });
});

describe("priority", () => {
  it.each([
    ["!high", 5], ["!med", 3], ["!low", 1], ["!none", 0],
    ["!3", 5], ["!2", 3], ["!1", 1], ["!0", 0],
  ])("%s", (token, value) => {
    const d = parse(`fix bug ${token}`);
    expect(d.priority).toBe(value);
    expect(d.title).toBe("fix bug");
  });

  it("ignores ! inside a word", () => {
    expect(parse("wow!high five").priority).toBeUndefined();
  });
});

describe("list", () => {
  it("reads ~list", () => {
    const d = parse("buy milk ~Personal");
    expect(d.listQuery).toBe("Personal");
    expect(d.title).toBe("buy milk");
  });

  it("reads a quoted ~list", () => {
    const d = parse('write post ~"Side projects" !low');
    expect(d.listQuery).toBe("Side projects");
    expect(d.priority).toBe(1);
    expect(d.title).toBe("write post");
  });
});

describe("tags", () => {
  it("reads several tags and allows new ones", () => {
    const d = parse("file taxes #admin #money");
    expect(d.tags).toEqual(["admin", "money"]);
    expect(d.title).toBe("file taxes");
  });
});

describe("checklist", () => {
  it("reads items after ::", () => {
    const d = parse("groceries tomorrow :: buy milk; eggs; bread");
    expect(d.items).toEqual(["buy milk", "eggs", "bread"]);
    expect(d.title).toBe("groceries");
    expect(ymd(d.dueDate)).toBe("2026-10-8");
  });
});

describe("quotes and escapes", () => {
  it("keeps quoted text out of the date parser", () => {
    const d = parse('"plan the march" fri');
    expect(d.title).toBe("plan the march");
    expect(ymd(d.dueDate)).toBe("2026-10-9");
  });

  it("parses a date word with no quotes", () => {
    expect(parse("plan the march").dueDate).toBeDefined();
  });

  it("keeps date words when dates are ignored", () => {
    const d = parse("plan the march", true);
    expect(d.title).toBe("plan the march");
    expect(d.dueDate).toBeUndefined();
  });

  it("keeps an escaped #", () => {
    const d = parse("\\#1 fan");
    expect(d.title).toBe("#1 fan");
    expect(d.tags).toEqual([]);
  });
});

describe("the plan's acceptance line", () => {
  it("parses call bank tomorrow 3pm !high #admin ~Personal", () => {
    const d = parse("call bank tomorrow 3pm !high #admin ~Personal");
    expect(d.title).toBe("call bank");
    expect(ymd(d.dueDate)).toBe("2026-10-8");
    expect(hm(d.dueDate)).toBe("15:00");
    expect(d.priority).toBe(5);
    expect(d.tags).toEqual(["admin"]);
    expect(d.listQuery).toBe("Personal");
  });
});

describe("resolveList", () => {
  const projects: Project[] = [
    { id: "p1", name: "Personal" },
    { id: "p2", name: "Side projects" },
    { id: "p3", name: "Work" },
  ];
  it.each([
    ["Personal", "p1"],
    ["pers", "p1"],
    ["side-projects", "p2"],
    ["proj", "p2"],
    ["wrk", "p3"],
  ])("%s", (q, id) => {
    expect(resolveList(q, projects)?.id).toBe(id);
  });

  it("maps inbox to the inbox id", () => {
    expect(resolveList("inbox", projects, "inbox123")).toEqual({ id: "inbox123", name: "Inbox" });
  });

  it("returns undefined for no match", () => {
    expect(resolveList("zzz", projects)).toBeUndefined();
  });
});

describe("draftToTask", () => {
  it("builds a timed task body", () => {
    const body = draftToTask(parse("call bank tomorrow 3pm !high #admin"), { projectId: "p1" });
    expect(body).toMatchObject({ title: "call bank", projectId: "p1", isAllDay: false, priority: 5, tags: ["admin"] });
    expect(body.dueDate).toMatch(/^2026-10-08T15:00:00\.000[+-]\d{4}$/);
    expect(body.startDate).toBe(body.dueDate);
  });

  it("uses the default due date as all-day", () => {
    const body = draftToTask(parse("tidy desk"), { defaultDue: NOW });
    expect(body.isAllDay).toBe(true);
    expect(body.dueDate).toMatch(/^2026-10-07T00:00:00/);
  });

  it("makes a checklist task from items", () => {
    const body = draftToTask(parse("groceries :: milk; eggs"));
    expect(body.kind).toBe("CHECKLIST");
    expect(body.items?.map((i) => i.title)).toEqual(["milk", "eggs"]);
    expect(body.items?.[0].id).toMatch(/^[0-9a-f]{24}$/);
  });
});
