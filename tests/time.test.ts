import { describe, expect, it } from 'vitest';
import {
  addDays, dayKey, findOverlaps, formatTimeRange, formatWeekRange, shiftInstants, shiftTiming, timeInput, weekStart, zonedToUtc,
} from '../src/lib/time';

describe('America/New_York conversions', () => {
  it('converts standard and daylight time', () => {
    expect(zonedToUtc('2026-01-15', '09:00').toISOString()).toBe('2026-01-15T14:00:00.000Z'); // EST -5
    expect(zonedToUtc('2026-07-15', '09:00').toISOString()).toBe('2026-07-15T13:00:00.000Z'); // EDT -4
  });

  it('handles the DST change days', () => {
    // Spring forward: Mar 8 2026 at 2:00 → 3:00
    expect(zonedToUtc('2026-03-08', '01:00').toISOString()).toBe('2026-03-08T06:00:00.000Z');
    expect(zonedToUtc('2026-03-08', '09:00').toISOString()).toBe('2026-03-08T13:00:00.000Z');
    // Fall back: Nov 1 2026 at 2:00 → 1:00
    expect(zonedToUtc('2026-11-01', '09:00').toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(zonedToUtc('2026-10-31', '23:00').toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('round-trips through dayKey/timeInput', () => {
    const d = zonedToUtc('2026-11-20', '23:30');
    expect(dayKey(d)).toBe('2026-11-20');
    expect(timeInput(d)).toBe('23:30');
  });
});

describe('shifts', () => {
  it('treats an end before the start as the next day', () => {
    const { startsAt, endsAt } = shiftInstants('2026-11-20', '22:00', '06:00');
    expect(startsAt.toISOString()).toBe('2026-11-21T03:00:00.000Z');
    expect(endsAt.toISOString()).toBe('2026-11-21T11:00:00.000Z');
    expect(formatTimeRange(startsAt.toISOString(), endsAt.toISOString())).toBe('10:00 PM – 6:00 AM (Sat, Nov 21)');
  });

  it('gets overnight length right across fall-back (9 real hours)', () => {
    const { startsAt, endsAt } = shiftInstants('2026-10-31', '22:00', '06:00');
    expect((endsAt.getTime() - startsAt.getTime()) / 3_600_000).toBe(9);
  });

  it('classifies timing', () => {
    const now = new Date('2026-11-20T15:00:00Z'); // 10 AM NY
    expect(shiftTiming('2026-11-20T12:00:00Z', '2026-11-20T14:00:00Z', now)).toBe('past');
    expect(shiftTiming('2026-11-20T14:00:00Z', '2026-11-20T18:00:00Z', now)).toBe('now');
    expect(shiftTiming('2026-11-20T20:00:00Z', '2026-11-20T22:00:00Z', now)).toBe('today');
    // 11 PM UTC Nov 20 is still Nov 20 in NY → today; 5 AM UTC Nov 21 is midnight NY Nov 21 → upcoming
    expect(shiftTiming('2026-11-21T03:00:00Z', '2026-11-21T04:00:00Z', now)).toBe('today');
    expect(shiftTiming('2026-11-21T05:00:00Z', '2026-11-21T06:00:00Z', now)).toBe('upcoming');
  });

  it('finds double bookings only for shared volunteers on live shifts', () => {
    const s = (id: string, a: string, b: string, v: string[], cancelled = false) =>
      ({ id, starts_at: a, ends_at: b, volunteer_ids: v, cancelled });
    const overlaps = findOverlaps([
      s('a', '2026-11-20T14:00:00+00:00', '2026-11-20T18:00:00+00:00', ['ann', 'ben']),
      s('b', '2026-11-20T17:00:00Z', '2026-11-20T20:00:00Z', ['ann']),
      s('c', '2026-11-20T18:00:00Z', '2026-11-20T20:00:00Z', ['ben']), // touches, no overlap
      s('d', '2026-11-20T15:00:00Z', '2026-11-20T16:00:00Z', ['ben'], true), // cancelled
    ]);
    expect([...overlaps.keys()].sort()).toEqual(['a:ann', 'b:ann']);
  });
});

describe('calendar helpers', () => {
  it('starts weeks on Sunday and adds days across months', () => {
    expect(weekStart('2026-11-19')).toBe('2026-11-15');
    expect(weekStart('2026-11-15')).toBe('2026-11-15');
    expect(addDays('2026-11-29', 7)).toBe('2026-12-06');
    expect(formatWeekRange('2026-11-15')).toBe('Nov 15 – 21, 2026');
    expect(formatWeekRange('2026-11-29')).toBe('Nov 29 – Dec 5, 2026');
    expect(formatWeekRange('2026-12-27')).toBe('Dec 27 – Jan 2, 2027');
  });
});
