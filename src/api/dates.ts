// Date helpers for the TickTick wire format: `yyyy-MM-dd'T'HH:mm:ss.SSSZ` with a
// `+HHMM` offset and no colon.

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, "0");
}

/** Formats a Date in the local offset, the way TickTick expects. */
export function formatTickTickTime(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.000` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`
  );
}

/** Parses a TickTick date string. Accepts `+HHMM`, `+HH:MM` and `Z`. */
export function parseTickTickTime(value: string | undefined | null): Date | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Local midnight of the given day. TickTick anchors all-day dates there. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** A `YYYY-MM-DD` key for a calendar day, read in the given time zone or the local one. */
export function dayKey(date: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}`;
    } catch {
      // Unknown zone: fall through to the local day.
    }
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The calendar day a task date falls on. An all-day date is read in the task's
 * own time zone, so a task made in another zone keeps its day.
 */
export function taskDayKey(value: string | undefined, isAllDay: boolean | undefined, timeZone?: string): string | undefined {
  const date = parseTickTickTime(value);
  if (!date) return undefined;
  return dayKey(date, isAllDay ? timeZone : undefined);
}

/** Next Monday after the given day (TickTick's "next week" preset). */
export function nextMonday(from: Date): Date {
  const d = startOfDay(from);
  const days = ((8 - d.getDay()) % 7) || 7;
  return addDays(d, days);
}

/** Keeps the time of day of `time` on the day of `day`. */
export function withTimeOf(day: Date, time: Date): Date {
  const d = new Date(day);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** A short label for a due date: "Today", "Tomorrow 15:00", "Fri", "Oct 12". */
export function formatDueLabel(date: Date, isAllDay: boolean, now = new Date()): string {
  const today = startOfDay(now);
  const day = startOfDay(date);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  let label: string;
  if (diff === 0) label = "Today";
  else if (diff === 1) label = "Tomorrow";
  else if (diff === -1) label = "Yesterday";
  else if (diff > 1 && diff < 7) label = WEEKDAY.format(date).slice(0, 3);
  else label = SHORT_DATE.format(date);
  return isAllDay ? label : `${label} ${TIME.format(date)}`;
}
