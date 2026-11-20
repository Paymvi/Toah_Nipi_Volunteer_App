import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { fetchShifts, type Shift } from '../lib/api';
import { addDays, dayKey, findOverlaps, formatDayShort, formatWeekRange, weekStart, zonedToUtc } from '../lib/time';
import { ShiftCard, ShiftDetail, ShiftForm } from '../shifts';
import { ErrorBox, Loading, useAsync } from '../ui';

export default function Schedule() {
  const { profile, isAdmin, nameOf } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = dayKey(new Date());
  const view = params.get('view') === 'team' ? 'team' : 'mine';
  const week = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(params.get('week') ?? '') ? params.get('week')! : today);
  const go = (patch: Record<string, string>) => setParams({ view, week, ...patch }, { replace: true });

  const shifts = useAsync(() => fetchShifts(zonedToUtc(week, '00:00'), zonedToUtc(addDays(week, 7), '00:00')), [week]);
  const [open, setOpen] = useState<Shift | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  // shortcut: only checks double-bookings among shifts loaded for this week; the shift form checks across weeks.
  const overlaps = findOverlaps(shifts.data ?? []);
  const visible = (shifts.data ?? []).filter((s) => view === 'team' || s.volunteer_ids.includes(profile!.id));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  // A shift that started before this week (overnight) is listed on the first day.
  const byDay = (d: string) => visible.filter((s) => (dayKey(s.starts_at) < week ? week : dayKey(s.starts_at)) === d);
  const overlapNames = (s: Shift) => (isAdmin
    ? s.volunteer_ids.filter((v) => overlaps.has(`${s.id}:${v}`)).map(nameOf) : []);

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Schedule</h1>
        {isAdmin && <button type="button" className="btn primary" onClick={() => setCreating(today >= week && today < addDays(week, 7) ? today : week)}>＋ New shift</button>}
      </div>

      <div className="segmented view-toggle" role="radiogroup" aria-label="Whose schedule">
        <button type="button" role="radio" aria-checked={view === 'mine'} className={view === 'mine' ? 'on' : ''} onClick={() => go({ view: 'mine' })}>My Schedule</button>
        <button type="button" role="radio" aria-checked={view === 'team'} className={view === 'team' ? 'on' : ''} onClick={() => go({ view: 'team' })}>Team Schedule</button>
      </div>

      <nav className="week-nav" aria-label="Week">
        <button type="button" className="btn" onClick={() => go({ week: addDays(week, -7) })} aria-label="Previous week">‹ Prev</button>
        <div className="week-label">
          <strong>{formatWeekRange(week)}</strong>
          {week !== weekStart(today) && <button type="button" className="link-btn" onClick={() => go({ week: today })}>Today</button>}
        </div>
        <button type="button" className="btn" onClick={() => go({ week: addDays(week, 7) })} aria-label="Next week">Next ›</button>
      </nav>

      {shifts.error && <ErrorBox message={shifts.error} onRetry={shifts.reload} />}
      {shifts.loading && !shifts.data ? <Loading label="Loading schedule…" /> : (
        <ol className={`week${shifts.loading ? ' is-reloading' : ''}`}>
          {days.map((d) => {
            const list = byDay(d);
            const when = d === today ? 'today' : d < today ? 'past' : 'future';
            return (
              <li key={d} className={`day day-${when}`} aria-current={d === today ? 'date' : undefined}>
                <h2 className="day-head">
                  {formatDayShort(d)}
                  {when === 'today' && <span className="badge timing-today">Today</span>}
                  {when === 'past' && <span className="sr-only"> (past)</span>}
                </h2>
                {list.length ? (
                  <div className="stack">
                    {list.map((s) => (
                      <ShiftCard key={s.id} shift={s} showNames={view === 'team'} overlapNames={overlapNames(s)} onOpen={() => setOpen(s)} />
                    ))}
                  </div>
                ) : <p className="day-empty">{view === 'mine' ? 'Not scheduled' : 'No shifts'}</p>}
                {isAdmin && view === 'team' && (
                  <button type="button" className="link-btn add-on-day" onClick={() => setCreating(d)} aria-label={`Add shift on ${formatDayShort(d)}`}>＋ Add</button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!shifts.loading && view === 'mine' && visible.length === 0 && (
        <p className="empty">You don’t have any shifts this week. Check <button type="button" className="link-btn" onClick={() => go({ view: 'team' })}>Team Schedule</button> to see who’s serving.</p>
      )}

      {open && <ShiftDetail shift={open} onClose={() => setOpen(null)} onChanged={shifts.reload} />}
      {creating && <ShiftForm defaultDay={creating} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); shifts.reload(); }} />}
    </div>
  );
}
