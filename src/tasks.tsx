import { useState, type FormEvent } from 'react';
import { useAuth } from './auth';
import {
  deleteTask, fetchAdminNote, fetchNotes, fetchShift, saveTask, setTaskArchived, setTaskStatus, STATUS_LABEL,
  type Shift, type Task, type TaskStatus,
} from './lib/api';
import { dayKey, formatDayShort, formatDueDate, formatTimeRange } from './lib/time';
import { fetchUpcomingShifts } from './shifts';
import { Dialog, ErrorBox, Field, joinNames, Loading, StatusBadge, useAction, useAsync, useToast, VolunteerPicker } from './ui';

export const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];

export type StatusFilter = 'any' | 'outstanding' | TaskStatus;
/** A task matches when any considered assignment (optionally just one volunteer's) has the status. */
export function matchesTaskFilter(t: Task, volunteer: string, status: StatusFilter) {
  const rows = volunteer ? t.assignments.filter((a) => a.volunteer_id === volunteer) : t.assignments;
  if (volunteer && rows.length === 0) return false;
  if (status === 'any') return true;
  if (status === 'outstanding') return rows.length === 0 || rows.some((a) => a.status !== 'done');
  return rows.some((a) => a.status === status);
}

export function TaskCard({ task, onOpen, adminView }: { task: Task; onOpen: () => void; adminView?: boolean }) {
  const { profile, nameOf } = useAuth();
  const mine = task.assignments.find((a) => a.volunteer_id === profile?.id);
  const done = task.assignments.filter((a) => a.status === 'done').length;
  const overdue = task.due_date && task.due_date < dayKey(new Date()) && (adminView ? done < task.assignments.length : mine?.status !== 'done');
  return (
    <button type="button" className={`card task-card${task.archived ? ' is-archived' : ''}`} onClick={onOpen}>
      <span className="shift-top">
        <span className="task-title">{task.title}</span>
        {!adminView && mine && <StatusBadge status={mine.status} />}
        {task.archived && <span className="badge">Archived</span>}
      </span>
      {(task.due_date || task.location) && (
        <span className="shift-meta">
          {task.due_date && <span className={overdue ? 'overdue' : ''}>📅 {formatDueDate(task.due_date)}</span>}
          {task.due_date && task.location && ' · '}
          {task.location && <>📍 {task.location}</>}
        </span>
      )}
      {adminView && (
        <span className="assignee-chips">
          {task.assignments.length === 0 && <span className="muted">No one assigned</span>}
          {task.assignments.map((a) => (
            <span key={a.volunteer_id} className={`chip status-${a.status}`}>{nameOf(a.volunteer_id)}: {STATUS_LABEL[a.status]}</span>
          ))}
          {task.assignments.length > 1 && <span className="muted">{done} of {task.assignments.length} done</span>}
        </span>
      )}
    </button>
  );
}

export function StatusPicker({ value, onChange, disabled, label }:
  { value: TaskStatus; onChange: (s: TaskStatus) => void; disabled?: boolean; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {STATUSES.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} disabled={disabled}
          className={value === s ? `on status-${s}` : ''} onClick={() => value !== s && onChange(s)}>
          {STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

export function TaskDetail({ task: initial, onClose, onChanged }: { task: Task; onClose: () => void; onChanged: () => void }) {
  const { isAdmin, profile, nameOf } = useAuth();
  const toast = useToast();
  const [task, setTask] = useState(initial);
  const [editing, setEditing] = useState(false);
  const action = useAction();
  const shift = useAsync(() => (task.shift_id ? fetchShift(task.shift_id) : Promise.resolve(null)), [task.shift_id]);
  const notes = useAsync(async () => (await fetchNotes()).filter((n) => n.task_id === task.id), [task.id]);
  const adminNote = useAsync(() => (isAdmin ? fetchAdminNote({ task_id: task.id }) : Promise.resolve('')), [task.id, isAdmin]);
  const mine = task.assignments.find((a) => a.volunteer_id === profile?.id);

  if (editing) {
    return <TaskForm task={task} adminNote={adminNote.data ?? ''} onClose={() => setEditing(false)}
      onSaved={() => { onChanged(); onClose(); }} />;
  }

  const changeStatus = async (volunteerId: string, status: TaskStatus) => {
    if (await action.run(() => setTaskStatus(task.id, volunteerId, status))) {
      setTask({ ...task, assignments: task.assignments.map((a) => (a.volunteer_id === volunteerId ? { ...a, status } : a)) });
      toast(`Marked ${STATUS_LABEL[status]}`);
      onChanged();
    }
  };
  const archive = async () => {
    if (await action.run(() => setTaskArchived(task.id, !task.archived))) {
      toast(task.archived ? 'Task restored' : 'Task archived');
      onChanged(); onClose();
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${task.title}” permanently? This also removes everyone’s progress on it. Archiving keeps a record instead.`)) return;
    if (await action.run(() => deleteTask(task.id))) { toast('Task deleted'); onChanged(); onClose(); }
  };

  return (
    <Dialog title={task.title} onClose={onClose}>
      <div className="detail">
        {mine && (
          <div>
            <span className="label">Your progress</span>
            <StatusPicker label="Your progress" value={mine.status} disabled={action.busy} onChange={(s) => changeStatus(mine.volunteer_id, s)} />
          </div>
        )}
        {task.due_date && <p><span className="label">Due</span> {formatDueDate(task.due_date)}</p>}
        {task.location && <p><span className="label">Location</span> {task.location}</p>}
        {task.shift_id && (
          <p><span className="label">During shift</span>
            {shift.loading ? '…' : shift.data ? <ShiftLine shift={shift.data} /> : <span className="muted">Shift unavailable</span>}
          </p>
        )}
        <div>
          <span className="label">Instructions</span>
          <p className="prewrap">{task.description || <span className="muted">No extra instructions.</span>}</p>
        </div>
        <div>
          <span className="label">Assigned to</span>
          <p className="field-hint">Each person marks their own progress.</p>
          <ul className="plain assignee-list">
            {task.assignments.map((a) => (
              <li key={a.volunteer_id}>
                <span>{a.volunteer_id === profile?.id ? 'You' : nameOf(a.volunteer_id)}</span>
                {isAdmin && a.volunteer_id !== profile?.id ? (
                  <select aria-label={`Status for ${nameOf(a.volunteer_id)}`} value={a.status} disabled={action.busy}
                    onChange={(e) => changeStatus(a.volunteer_id, e.target.value as TaskStatus)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                ) : <StatusBadge status={a.status} />}
              </li>
            ))}
          </ul>
        </div>
        {notes.data && notes.data.length > 0 && (
          <div>
            <span className="label">Notes for this task</span>
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
            <button type="button" className="btn" onClick={archive} disabled={action.busy}>{task.archived ? 'Restore' : 'Archive'}</button>
            <button type="button" className="btn danger" onClick={remove} disabled={action.busy}>Delete</button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export const ShiftLine = ({ shift }: { shift: Shift }) =>
  <>{shift.role} · {formatDayShort(dayKey(shift.starts_at))} {formatTimeRange(shift.starts_at, shift.ends_at)}{shift.cancelled && ' (cancelled)'}</>;

export function ShiftSelect({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  const shifts = useAsync(fetchUpcomingShifts, []);
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        {shifts.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {formatDayShort(dayKey(s.starts_at))} · {formatTimeRange(s.starts_at, s.ends_at)} · {s.role}{s.cancelled ? ' (cancelled)' : ''}
          </option>
        ))}
        {value && shifts.data && !shifts.data.some((s) => s.id === value) && <option value={value}>Earlier shift</option>}
      </select>
    </Field>
  );
}

export function TaskForm({ task, adminNote = '', onClose, onSaved }:
  { task?: Task; adminNote?: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { nameOf } = useAuth();
  const [f, setF] = useState(() => ({
    title: task?.title ?? '', description: task?.description ?? '', due_date: task?.due_date ?? '',
    location: task?.location ?? '', shift_id: task?.shift_id ?? '',
    volunteer_ids: task?.assignments.map((a) => a.volunteer_id) ?? [], admin_note: adminNote,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const action = useAction();
  const removedWithProgress = (task?.assignments ?? [])
    .filter((a) => !f.volunteer_ids.includes(a.volunteer_id) && a.status !== 'todo').map((a) => nameOf(a.volunteer_id));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return action.setError('Please give the task a title.');
    if (await action.run(() => saveTask({ ...f, id: task?.id }))) { toast(task ? 'Task updated' : 'Task created'); onSaved(); }
  };

  return (
    <Dialog title={task ? 'Edit task' : 'New task'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Title"><input required maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Instructions (optional)">
          <textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <VolunteerPicker value={f.volunteer_ids} onChange={(v) => set('volunteer_ids', v)} legend="Assign to" />
        {f.volunteer_ids.length > 1 && <p className="field-hint">Each person will mark their own progress separately.</p>}
        {removedWithProgress.length > 0 && (
          <p className="warn-box">⚠ Removing {joinNames(removedWithProgress)} will clear their progress on this task.</p>
        )}
        <div className="row">
          <Field label="Due date (optional)"><input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>
          <Field label="Location (optional)"><input maxLength={80} value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
        </div>
        <ShiftSelect label="Link to a shift (optional)" value={f.shift_id} onChange={(v) => set('shift_id', v)} />
        <Field label="🔒 Admin-only note (never shown to volunteers)">
          <textarea rows={2} value={f.admin_note} onChange={(e) => set('admin_note', e.target.value)} />
        </Field>
        {action.error && <ErrorBox message={action.error} />}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save task'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
