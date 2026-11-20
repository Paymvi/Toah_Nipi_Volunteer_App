import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from './auth';
import {
  fetchAdminNote, fetchNotes, fetchShifts, saveShift, setShiftCancelled, type Shift,
} from './lib/api';
import {
  addDays, dayKey, formatDayLong, formatDayShort, formatTime, formatTimeRange, shiftInstants, shiftTiming, timeInput,
} from './lib/time';
import { Dialog, ErrorBox, Field, joinNames, Loading, TimingBadge, useAction, useAsync, useToast, VolunteerPicker } from './ui';

export function ShiftCard({ shift, onOpen, showNames, overlapNames, showDate }: {
  shift: Shift; onOpen: () => void; showNames: boolean; overlapNames?: string[]; showDate?: boolean;
}) {
  const { nameOf, profile } = useAuth();
  const timing = shiftTiming(shift.starts_at, shift.ends_at);
  const others = shift.volunteer_ids.filter((id) => id !== profile?.id).map(nameOf);
  const mine = shift.volunteer_ids.includes(profile?.id ?? '');
  return (
    <button type="button" onClick={onOpen}
      className={`card shift-card ${timing}${shift.cancelled ? ' is-cancelled' : ''}${mine ? ' is-mine' : ''}`}>
      <span className="shift-top">
        <span className="shift-time">
          {showDate && <>{formatDayShort(dayKey(shift.starts_at))} · </>}
          {formatTimeRange(shift.starts_at, shift.ends_at)}
        </span>
        <TimingBadge timing={timing} cancelled={shift.cancelled} />
      </span>
      <span className="shift-role">{shift.role}</span>
      {shift.location && <span className="shift-meta">📍 {shift.location}</span>}
      {showNames ? (
        <span className="shift-meta">
          👥 {shift.volunteer_ids.length ? joinNames(shift.volunteer_ids.map((id) => (id === profile?.id ? 'You' : nameOf(id)))) : 'No one assigned yet'}
        </span>
      ) : others.length > 0 && <span className="shift-meta">With {joinNames(others)}</span>}
      {overlapNames && overlapNames.length > 0 && (
        <span className="warn-line">⚠ Double-booked: {joinNames(overlapNames)}</span>
      )}
    </button>
  );
}

export function ShiftDetail({ shift: initial, onClose, onChanged }: { shift: Shift; onClose: () => void; onChanged: () => void }) {
  const { isAdmin, nameOf, profile } = useAuth();
  const [shift, setShift] = useState(initial);
  const [editing, setEditing] = useState(false);
  const notes = useAsync(async () => (await fetchNotes()).filter((n) => n.shift_id === shift.id), [shift.id]);
  const adminNote = useAsync(() => (isAdmin ? fetchAdminNote({ shift_id: shift.id }) : Promise.resolve('')), [shift.id, isAdmin]);
  const action = useAction();
  const toast = useToast();

  if (editing) {
    return <ShiftForm shift={shift} adminNote={adminNote.data ?? ''} onClose={() => setEditing(false)}
      onSaved={() => { setEditing(false); onChanged(); onClose(); }} />;
  }

  const toggleCancel = async () => {
    const cancelling = !shift.cancelled;
    if (cancelling && !window.confirm(`Cancel the ${shift.role} shift on ${formatDayShort(dayKey(shift.starts_at))}? Assigned volunteers will see it as cancelled.`)) return;
    if (await action.run(() => setShiftCancelled(shift.id, cancelling))) {
      setShift({ ...shift, cancelled: cancelling });
      toast(cancelling ? 'Shift cancelled' : 'Shift restored');
      onChanged();
    }
  };

  const timing = shiftTiming(shift.starts_at, shift.ends_at);
  return (
    <Dialog title={shift.role} onClose={onClose}>
      <div className="detail">
        <p className="detail-when">
          <strong>{formatDayLong(dayKey(shift.starts_at))}</strong><br />
          {formatTimeRange(shift.starts_at, shift.ends_at)} <TimingBadge timing={timing} cancelled={shift.cancelled} />
        </p>
        {shift.cancelled && <p className="notice">This shift has been cancelled. You don’t need to come in for it.</p>}
        {shift.location && <p><span className="label">Location</span> {shift.location}</p>}
        <div>
          <span className="label">Serving</span>
          {shift.volunteer_ids.length ? (
            <ul className="plain">{shift.volunteer_ids.map((id) => <li key={id}>{id === profile?.id ? 'You' : nameOf(id)}</li>)}</ul>
          ) : <p className="muted">No one assigned yet.</p>}
        </div>
        <div>
          <span className="label">Instructions</span>
          <p className="prewrap">{shift.instructions || <span className="muted">No special instructions.</span>}</p>
        </div>
        {notes.data && notes.data.length > 0 && (
          <div>
            <span className="label">Notes for this shift</span>
            {notes.data.map((n) => <div key={n.id} className="mini-note"><strong>{n.title}</strong><p className="prewrap">{n.body}</p></div>)}
          </div>
        )}
        {isAdmin && (
          <div className="admin-only">
            <span className="label">🔒 Admin-only note</span>
            {adminNote.loading ? <Loading /> : <p className="prewrap">{adminNote.data || <span className="muted">None.</span>}</p>}
          </div>
        )}
        {action.error && <ErrorBox message={action.error} />}
        {isAdmin && (
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => setEditing(true)} disabled={adminNote.loading}>Edit or reassign</button>
            <button type="button" className={`btn ${shift.cancelled ? '' : 'danger'}`} onClick={toggleCancel} disabled={action.busy}>
              {action.busy ? 'Saving…' : shift.cancelled ? 'Restore shift' : 'Cancel shift'}
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function ShiftForm({ shift, adminNote = '', defaultDay, onClose, onSaved }: {
  shift?: Shift; adminNote?: string; defaultDay?: string; onClose: () => void; onSaved: () => void;
}) {
  const { nameOf } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(() => ({
    role: shift?.role ?? '',
    location: shift?.location ?? '',
    day: shift ? dayKey(shift.starts_at) : defaultDay ?? dayKey(new Date()),
    start: shift ? timeInput(shift.starts_at) : '09:00',
    end: shift ? timeInput(shift.ends_at) : '12:00',
    instructions: shift?.instructions ?? '',
    volunteer_ids: shift?.volunteer_ids ?? [],
    admin_note: adminNote,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const action = useAction();
  const valid = f.day && f.start && f.end;
  const times = valid ? shiftInstants(f.day, f.start, f.end) : null;
  const overnight = times && dayKey(times.endsAt) !== f.day;

  // Live double-booking check against every other shift that overlaps these times.
  const [conflicts, setConflicts] = useState<string[]>([]);
  const startIso = times?.startsAt.toISOString(), endIso = times?.endsAt.toISOString();
  const ids = f.volunteer_ids.join(',');
  useEffect(() => {
    if (!startIso || !endIso || !ids) { setConflicts([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        const others = (await fetchShifts(new Date(startIso), new Date(endIso))).filter((s) => s.id !== shift?.id && !s.cancelled);
        const lines = others.flatMap((s) => s.volunteer_ids.filter((v) => ids.split(',').includes(v)).map((v) =>
          `${nameOf(v)} is already on ${s.role}, ${formatDayShort(dayKey(s.starts_at))} ${formatTimeRange(s.starts_at, s.ends_at)}`));
        if (live) setConflicts(lines);
      } catch { /* the check is advisory; saving still validates */ }
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [startIso, endIso, ids, shift?.id, nameOf]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!times) return;
    if (!f.role.trim()) return action.setError('Please enter a role for this shift.');
    const ok = await action.run(() => saveShift({
      id: shift?.id, role: f.role, location: f.location, instructions: f.instructions,
      starts_at: times.startsAt.toISOString(), ends_at: times.endsAt.toISOString(),
      volunteer_ids: f.volunteer_ids, admin_note: f.admin_note,
    }));
    if (ok) { toast(shift ? 'Shift updated' : 'Shift created'); onSaved(); }
  };

  return (
    <Dialog title={shift ? 'Edit shift' : 'New shift'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <Field label="Role" hint="What they’ll be doing, e.g. Kitchen crew, Front desk, Grounds">
          <input required value={f.role} onChange={(e) => set('role', e.target.value)} maxLength={80} />
        </Field>
        <Field label="Location or building (optional)">
          <input value={f.location} onChange={(e) => set('location', e.target.value)} maxLength={80} />
        </Field>
        <Field label="Date">
          <input type="date" required value={f.day} onChange={(e) => set('day', e.target.value)} />
        </Field>
        <div className="row">
          <Field label="Starts"><input type="time" required value={f.start} onChange={(e) => set('start', e.target.value)} /></Field>
          <Field label="Ends"><input type="time" required value={f.end} onChange={(e) => set('end', e.target.value)} /></Field>
        </div>
        {overnight && times && (
          <p className="hint-box">🌙 Overnight shift: ends {formatDayShort(dayKey(times.endsAt))} at {formatTime(times.endsAt)}.</p>
        )}
        <p className="field-hint">Times are Eastern Time (Toah Nipi).</p>
        <VolunteerPicker value={f.volunteer_ids} onChange={(v) => set('volunteer_ids', v)} legend="Assign volunteers" />
        {conflicts.length > 0 && (
          <div className="warn-box" role="alert">
            <strong>⚠ Overlapping assignment</strong>
            <ul>{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
            <span>You can still save if this is intended.</span>
          </div>
        )}
        <Field label="Instructions (shared with volunteers)">
          <textarea rows={4} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} />
        </Field>
        <Field label="🔒 Admin-only note (never shown to volunteers)">
          <textarea rows={2} value={f.admin_note} onChange={(e) => set('admin_note', e.target.value)} />
        </Field>
        {action.error && <ErrorBox message={action.error} />}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={action.busy || !valid}>{action.busy ? 'Saving…' : 'Save shift'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Next ~2 months of shifts, used by Home and the task/note forms. */
export const fetchUpcomingShifts = () => {
  const now = new Date();
  return fetchShifts(new Date(now.getTime() - 7 * 864e5), new Date(`${addDays(dayKey(now), 60)}T12:00:00Z`));
};
