// All dates are shown and entered in the retreat center's timezone, whatever the device's timezone is.
// Shifts are stored as UTC instants (timestamptz); "day keys" are YYYY-MM-DD strings in TZ.
export const TZ = 'America/New_York';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function zonedParts(d: Date) {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFmt.formatToParts(d)) if (type !== 'literal') p[type] = Number(value);
  return p;
}

/** Offset of TZ from UTC at instant `ms`, in ms (e.g. -5h during EST). */
function offsetAt(ms: number) {
  const p = zonedParts(new Date(ms));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock date + time in TZ → UTC Date. Handles DST in both directions. */
export function zonedToUtc(dayKey: string, time: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  let t = wall - offsetAt(wall);
  const second = offsetAt(t);
  if (second !== wall - t) t = wall - second;
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(d: Date | string): string {
  const p = zonedParts(new Date(d));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function timeInput(d: Date | string): string {
  const p = zonedParts(new Date(d));
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Sunday that starts the week containing `key`. */
export function weekStart(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return addDays(key, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

const keyToDate = (key: string) => new Date(`${key}T12:00:00Z`);
const fmt = (opts: Intl.DateTimeFormatOptions, tz = TZ) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
const shortDay = fmt({ weekday: 'short', month: 'short', day: 'numeric' }, 'UTC');
const longDay = fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, 'UTC');
const timeFmt = fmt({ hour: 'numeric', minute: '2-digit' });

export const formatDayShort = (key: string) => shortDay.format(keyToDate(key));
export const formatDayLong = (key: string) => longDay.format(keyToDate(key));
export const formatTime = (d: Date | string) => timeFmt.format(new Date(d));

export function formatWeekRange(start: string) {
  const end = addDays(start, 6);
  const a = keyToDate(start), b = keyToDate(end);
  const md = fmt({ month: 'short', day: 'numeric' }, 'UTC');
  const right = start.slice(0, 7) === end.slice(0, 7) ? String(b.getUTCDate()) : md.format(b);
  return `${md.format(a)} – ${right}, ${b.getUTCFullYear()}`;
}

/** "9:00 AM – 1:00 PM", or "10:00 PM – 6:00 AM (Fri, Nov 21)" for shifts ending on a later day. */
export function formatTimeRange(start: string, end: string) {
  const base = `${formatTime(start)} – ${formatTime(end)}`;
  return dayKey(start) === dayKey(end) ? base : `${base} (${formatDayShort(dayKey(end))})`;
}

/** Build a shift's instants from form inputs. An end time at or before the start means it ends the next day. */
export function shiftInstants(day: string, start: string, end: string) {
  const startsAt = zonedToUtc(day, start);
  let endsAt = zonedToUtc(day, end);
  if (endsAt <= startsAt) endsAt = zonedToUtc(addDays(day, 1), end);
  return { startsAt, endsAt };
}

export type Timing = 'past' | 'now' | 'today' | 'upcoming';
export function shiftTiming(start: string, end: string, now = new Date()): Timing {
  if (new Date(end) <= now) return 'past';
  if (new Date(start) <= now) return 'now';
  return dayKey(start) === dayKey(now) ? 'today' : 'upcoming';
}

interface ShiftLike { id: string; starts_at: string; ends_at: string; cancelled: boolean; volunteer_ids: string[] }

/** Map of "shiftId:volunteerId" → ids of the other shifts that volunteer is double-booked on. */
export function findOverlaps(shifts: ShiftLike[]) {
  const out = new Map<string, string[]>();
  const live = shifts.filter((s) => !s.cancelled);
  for (const a of live) for (const b of live) {
    if (a.id === b.id) continue;
    if (new Date(a.starts_at) >= new Date(b.ends_at) || new Date(b.starts_at) >= new Date(a.ends_at)) continue;
    for (const v of a.volunteer_ids) if (b.volunteer_ids.includes(v)) {
      const k = `${a.id}:${v}`;
      out.set(k, [...(out.get(k) ?? []), b.id]);
    }
  }
  return out;
}

export function formatDueDate(key: string, today = dayKey(new Date())) {
  if (key === today) return 'Due today';
  if (key === addDays(today, 1)) return 'Due tomorrow';
  return `${key < today ? 'Overdue · was due' : 'Due'} ${formatDayShort(key)}`;
}
