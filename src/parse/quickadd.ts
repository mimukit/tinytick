// The Quick Add parser. It turns one line such as
// `call bank tomorrow 3pm !high #admin ~Personal` into a task draft.
// Pure TypeScript with no Raycast import, so Vitest can run it.
import * as chrono from "chrono-node/en";
import { addDays, formatDueLabel, formatTickTickTime, startOfDay } from "../api/dates";
import type { Priority, Project, TaskPatch } from "../api/types";

export type MatchKind = "date" | "range" | "repeat" | "reminder" | "priority" | "list" | "tag" | "checklist";

export interface ParsedMatch {
  kind: MatchKind;
  /** The input text the match used. */
  text: string;
  /** A short human label for the preview. */
  label: string;
}

export interface QuickAddDraft {
  title: string;
  dueDate?: Date;
  startDate?: Date;
  isAllDay: boolean;
  repeatFlag?: string;
  reminders?: string[];
  priority?: Priority;
  /** The raw `~list` text. Resolve it with `resolveList`. */
  listQuery?: string;
  tags: string[];
  items: string[];
  matches: ParsedMatch[];
}

export interface ParseOptions {
  now?: Date;
  /** Skip date and time parsing, so date words stay in the title. */
  ignoreDates?: boolean;
}

const OPEN = "\u0000";
const CLOSE = "\u0001";

const PRIORITY_WORDS: Record<string, Priority> = {
  high: 5, hi: 5, h: 5, "3": 5,
  medium: 3, med: 3, m: 3, "2": 3,
  low: 1, lo: 1, l: 1, "1": 1,
  none: 0, no: 0, n: 0, "0": 0,
};

export const PRIORITY_LABEL: Record<Priority, string> = { 0: "No priority", 1: "Low", 3: "Medium", 5: "High" };

const DAY_CODES: Record<string, string> = {
  sun: "SU", sunday: "SU",
  mon: "MO", monday: "MO",
  tue: "TU", tues: "TU", tuesday: "TU",
  wed: "WE", wednesday: "WE",
  thu: "TH", thur: "TH", thurs: "TH", thursday: "TH",
  fri: "FR", friday: "FR",
  sat: "SA", saturday: "SA",
};
const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DAY_WORD = "(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)";

interface RepeatRule {
  rule: string;
  label: string;
  /** The first occurrence when the line gives no date. */
  first: (today: Date) => Date;
}

const REPEAT_PATTERNS: { re: RegExp; build: (m: RegExpExecArray) => RepeatRule }[] = [
  {
    re: /\bevery\s+(\d+)\s+days?\b/i,
    build: (m) => ({ rule: `FREQ=DAILY;INTERVAL=${m[1]}`, label: `Every ${m[1]} days`, first: (d) => d }),
  },
  {
    re: /\b(?:every\s*day|daily)\b/i,
    build: () => ({ rule: "FREQ=DAILY;INTERVAL=1", label: "Daily", first: (d) => d }),
  },
  {
    re: /\b(?:every\s+weekday|weekdays)\b/i,
    build: () => ({
      rule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR",
      label: "Weekdays",
      first: (d) => nextDayIn(d, ["MO", "TU", "WE", "TH", "FR"]),
    }),
  },
  {
    re: /\bevery\s+weekend\b/i,
    build: () => ({ rule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU", label: "Weekends", first: (d) => nextDayIn(d, ["SA", "SU"]) }),
  },
  {
    re: new RegExp(`\\bevery\\s+(${DAY_WORD}(?:\\s*(?:,|and|&)\\s*${DAY_WORD})*)\\b`, "i"),
    build: (m) => {
      const codes = [...new Set(m[1].toLowerCase().split(/\s*(?:,|and|&)\s*/).map((w) => DAY_CODES[w.trim()]).filter(Boolean))];
      return {
        rule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${codes.join(",")}`,
        label: `Every ${codes.map((c) => c[0] + c[1].toLowerCase()).join(", ")}`,
        first: (d) => nextDayIn(d, codes),
      };
    },
  },
  {
    re: /\bevery\s+(\d+)\s+weeks?\b/i,
    build: (m) => ({ rule: `FREQ=WEEKLY;INTERVAL=${m[1]}`, label: `Every ${m[1]} weeks`, first: (d) => d }),
  },
  {
    re: /\b(?:every\s+week|weekly)\b/i,
    build: () => ({ rule: "FREQ=WEEKLY;INTERVAL=1", label: "Weekly", first: (d) => d }),
  },
  {
    re: /\bevery\s+(\d+)\s+months?\b/i,
    build: (m) => ({ rule: `FREQ=MONTHLY;INTERVAL=${m[1]}`, label: `Every ${m[1]} months`, first: (d) => d }),
  },
  {
    re: /\b(?:every\s+month|monthly)(?:\s+on\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?)?\b/i,
    build: (m) => {
      if (!m[1]) return { rule: "FREQ=MONTHLY;INTERVAL=1", label: "Monthly", first: (d) => d };
      const day = Math.min(31, Math.max(1, Number(m[1])));
      return {
        rule: `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${day}`,
        label: `Monthly on day ${day}`,
        first: (d) => nextMonthDay(d, day),
      };
    },
  },
  {
    re: /\b(?:every\s+year|yearly|annually)\b/i,
    build: () => ({ rule: "FREQ=YEARLY;INTERVAL=1", label: "Yearly", first: (d) => d }),
  },
];

function nextDayIn(today: Date, codes: string[]): Date {
  const wanted = new Set(codes.map((c) => DAY_INDEX[c]));
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    if (wanted.has(d.getDay())) return d;
  }
  return today;
}

function nextMonthDay(today: Date, day: number): Date {
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
  return thisMonth >= today ? thisMonth : new Date(today.getFullYear(), today.getMonth() + 1, day);
}

const REMINDER_RE = /\bremind(?:er)?\s+(?:me\s+)?(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)(?:\s+before)?\b/i;

function reminderTrigger(amount: number, unit: string): { trigger: string; label: string } {
  const u = unit[0].toLowerCase();
  if (amount === 0) return { trigger: "TRIGGER:PT0S", label: "Remind on time" };
  if (u === "d") return { trigger: `TRIGGER:-P${amount}D`, label: `Remind ${amount}d before` };
  if (u === "h") return { trigger: `TRIGGER:-PT${amount}H`, label: `Remind ${amount}h before` };
  return { trigger: `TRIGGER:-PT${amount}M`, label: `Remind ${amount}m before` };
}

/** Removes `[start, end)` from `text`, keeping a space so words do not join. */
function cut(text: string, start: number, end: number): string {
  return `${text.slice(0, start)} ${text.slice(end)}`;
}

function cutMatch(text: string, re: RegExp): { text: string; match?: RegExpExecArray } {
  const match = re.exec(text);
  if (!match) return { text };
  return { text: cut(text, match.index, match.index + match[0].length), match };
}

/**
 * Picks the nearest future time for an hour with no am/pm, the way TickTick does:
 * "9" typed at 16:00 means 21:00 today.
 */
function nearestFutureHour(now: Date, hour: number, minute: number): Date {
  const today = startOfDay(now);
  const candidates = [hour, hour + 12].filter((h) => h < 24).map((h) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, minute));
  candidates.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, hour, minute));
  return candidates.find((c) => c > now) ?? candidates[candidates.length - 1];
}

/** "tomorrow 9" means 9:00. Chrono reads only "tomorrow", so add the colon. */
function normalizeBareHours(text: string): string {
  return text.replace(
    new RegExp(`\\b(today|tonight|tomorrow|tmrw?|${DAY_WORD})\\s+(\\d{1,2})(?![\\d:.\\-]|\\s*(?:am|pm|a\\.m|p\\.m|h\\b|hrs?|hours?|days?|weeks?|months?|mins?|minutes?|st|nd|rd|th))`, "gi"),
    (_all, day: string, hour: string) => (Number(hour) <= 23 ? `${day} at ${hour}:00` : `${day} ${hour}`),
  );
}

export function parseQuickAdd(input: string, options: ParseOptions = {}): QuickAddDraft {
  const now = options.now ?? new Date();
  const today = startOfDay(now);
  const matches: ParsedMatch[] = [];
  const slots: string[] = [];
  const protect = (value: string) => `${OPEN}${String.fromCharCode(97 + slots.push(value) - 1)}${CLOSE}`;
  const restore = (value: string) =>
    value.replace(new RegExp(`${OPEN}([a-z\\u00e0-\\uffff])${CLOSE}`, "g"), (_m, c: string) => slots[c.charCodeAt(0) - 97] ?? "");

  let text = input;

  // Checklist items after `::`, separated by `;`.
  let items: string[] = [];
  const checklist = /\s*::\s*(.*)$/s.exec(text);
  if (checklist) {
    items = checklist[1].split(";").map((s) => s.trim()).filter(Boolean);
    text = text.slice(0, checklist.index);
    if (items.length) matches.push({ kind: "checklist", text: checklist[0].trim(), label: `${items.length} checklist item${items.length > 1 ? "s" : ""}` });
  }

  // A quoted list name: ~"Side projects".
  let listQuery: string | undefined;
  const quotedList = cutMatch(text, /(?<![\\\S])~"([^"]+)"/);
  if (quotedList.match) {
    text = quotedList.text;
    listQuery = quotedList.match[1].trim();
    matches.push({ kind: "list", text: quotedList.match[0], label: listQuery });
  }

  // Escapes, then quoted text. Both go to the title untouched.
  text = text.replace(/\\([#~!"\\:])/g, (_m, c: string) => protect(c));
  text = text.replace(/"([^"]*)"/g, (_m, s: string) => protect(s));

  if (!listQuery) {
    const list = cutMatch(text, /(?<!\S)~([^\s\u0000\u0001]+)/);
    if (list.match) {
      text = list.text;
      listQuery = list.match[1];
      matches.push({ kind: "list", text: list.match[0], label: listQuery });
    }
  }

  let priority: Priority | undefined;
  const prio = cutMatch(text, /(?<!\S)!(high|hi|h|medium|med|m|low|lo|l|none|no|n|[0-3])(?!\S)/i);
  if (prio.match) {
    text = prio.text;
    priority = PRIORITY_WORDS[prio.match[1].toLowerCase()];
    matches.push({ kind: "priority", text: prio.match[0], label: PRIORITY_LABEL[priority] });
  }

  const tags: string[] = [];
  text = text.replace(/(?<!\S)#([^\s#\u0000\u0001]+)/gu, (m, tag: string) => {
    if (!tags.includes(tag)) tags.push(tag);
    matches.push({ kind: "tag", text: m, label: `#${tag}` });
    return " ";
  });

  let reminders: string[] | undefined;
  const remind = cutMatch(text, REMINDER_RE);
  if (remind.match) {
    text = remind.text;
    const { trigger, label } = reminderTrigger(Number(remind.match[1]), remind.match[2]);
    reminders = [trigger];
    matches.push({ kind: "reminder", text: remind.match[0], label });
  }

  let dueDate: Date | undefined;
  let startDate: Date | undefined;
  let isAllDay = true;
  let repeat: RepeatRule | undefined;

  if (!options.ignoreDates) {
    for (const { re, build } of REPEAT_PATTERNS) {
      const found = cutMatch(text, re);
      if (found.match) {
        text = found.text;
        repeat = build(found.match);
        matches.push({ kind: "repeat", text: found.match[0], label: repeat.label });
        break;
      }
    }

    text = normalizeBareHours(text);
    const result = chrono.parse(text, now, { forwardDate: true })[0];
    if (result) {
      const start = result.start;
      const hasTime = start.isCertain("hour");
      const hasDay = start.isCertain("day") || start.isCertain("weekday") || start.isCertain("month");
      let when = start.date();
      if (hasTime && !hasDay && !start.isCertain("meridiem")) {
        const hour = start.get("hour") ?? when.getHours();
        if (hour >= 1 && hour <= 11) when = nearestFutureHour(now, hour, start.get("minute") ?? 0);
      }
      if (repeat && !hasDay) {
        const day = repeat.first(today);
        when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), when.getHours(), when.getMinutes());
      }
      isAllDay = !hasTime;
      if (result.end) {
        startDate = isAllDay ? startOfDay(when) : when;
        let end = result.end.date();
        if (repeat && !hasDay) end = new Date(when.getFullYear(), when.getMonth(), when.getDate(), end.getHours(), end.getMinutes());
        dueDate = isAllDay ? startOfDay(end) : end;
      } else {
        dueDate = isAllDay ? startOfDay(when) : when;
      }

      // Drop a preposition that only led into the date: "pay rent on fri".
      let from = result.index;
      const lead = /\b(?:on|by|due|at)\s+$/i.exec(text.slice(0, from));
      if (lead) from = lead.index;
      text = cut(text, from, result.index + result.text.length);
      const label = startDate
        ? `${formatDueLabel(startDate, isAllDay, now)} – ${formatDueLabel(dueDate!, isAllDay, now)}`
        : formatDueLabel(dueDate!, isAllDay, now);
      matches.push({ kind: startDate ? "range" : "date", text: result.text, label });
    } else if (repeat) {
      dueDate = startOfDay(repeat.first(today));
    }
  }

  const title = restore(text).replace(/\s+/g, " ").trim();

  return {
    title,
    dueDate,
    startDate,
    isAllDay,
    repeatFlag: repeat ? `RRULE:${repeat.rule}` : undefined,
    reminders,
    priority,
    listQuery,
    tags,
    items,
    matches,
  };
}

function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const c of hay) if (c === needle[i]) i++;
  return i === needle.length;
}

/**
 * Finds the list a `~query` names: exact name, then prefix, then substring,
 * then letters in order. `inbox` always means the Inbox.
 */
export function resolveList(query: string | undefined, projects: Project[], inboxId?: string): { id: string; name: string } | undefined {
  if (!query) return undefined;
  const q = query.toLowerCase().replace(/[-_]/g, " ").trim();
  if (q === "inbox") return inboxId ? { id: inboxId, name: "Inbox" } : { id: "inbox", name: "Inbox" };
  const norm = (p: Project) => p.name.toLowerCase().replace(/[-_]/g, " ").trim();
  const open = projects.filter((p) => !p.closed);
  const hit =
    open.find((p) => norm(p) === q) ??
    open.find((p) => norm(p).startsWith(q)) ??
    open.find((p) => norm(p).includes(q)) ??
    open.find((p) => subsequence(q.replace(/\s/g, ""), norm(p).replace(/\s/g, "")));
  return hit ? { id: hit.id, name: hit.name } : undefined;
}

/** A random 24-character hex id, the shape TickTick uses for ids. */
export function newObjectId(): string {
  let id = Math.floor(Date.now() / 1000).toString(16).padStart(8, "0");
  while (id.length < 24) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

/** Builds the create body for `POST /open/v1/task`. */
export function draftToTask(
  draft: QuickAddDraft,
  target: { projectId?: string; defaultDue?: Date } = {},
): TaskPatch & { title: string } {
  const body: TaskPatch & { title: string } = { title: draft.title || "Untitled" };
  if (target.projectId) body.projectId = target.projectId;
  const due = draft.dueDate ?? target.defaultDue;
  if (due) {
    const allDay = draft.dueDate ? draft.isAllDay : true;
    body.isAllDay = allDay;
    body.dueDate = formatTickTickTime(allDay ? startOfDay(due) : due);
    body.startDate = draft.startDate ? formatTickTickTime(draft.startDate) : body.dueDate;
    body.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  if (draft.repeatFlag) body.repeatFlag = draft.repeatFlag;
  if (draft.reminders?.length) body.reminders = draft.reminders;
  if (draft.priority !== undefined) body.priority = draft.priority;
  if (draft.tags.length) body.tags = draft.tags;
  if (draft.items.length) {
    body.kind = "CHECKLIST";
    body.items = draft.items.map((title, i) => ({ id: newObjectId(), title, status: 0, sortOrder: i }));
  }
  return body;
}
