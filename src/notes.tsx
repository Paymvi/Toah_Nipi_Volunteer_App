import { useState, type FormEvent } from 'react';
import { useAuth } from './auth';
import { deleteNote, fetchTasks, saveNote, type Audience, type Note } from './lib/api';
import { dayKey, formatDayShort, formatTime } from './lib/time';
import { ShiftSelect } from './tasks';
import { Dialog, ErrorBox, Field, joinNames, useAction, useAsync, useToast, VolunteerPicker } from './ui';

export function NoteCard({ note, onEdit, onDeleted }: { note: Note; onEdit?: () => void; onDeleted?: () => void }) {
  const { isAdmin, nameOf } = useAuth();
  const toast = useToast();
  const action = useAction();
  const audience = note.audience === 'all'
    ? 'Shared with everyone'
    : isAdmin ? `Shared with ${joinNames(note.recipient_ids.map(nameOf))}` : 'Shared with you';
  const remove = async () => {
    if (!window.confirm(`Delete the note “${note.title}”? Volunteers will no longer see it.`)) return;
    if (await action.run(() => deleteNote(note.id))) { toast('Note deleted'); onDeleted?.(); }
  };
  return (
    <article className="card note-card">
      <h3>{note.title}</h3>
      {note.body && <p className="prewrap">{note.body}</p>}
      <p className="note-meta">
        {formatDayShort(dayKey(note.created_at))}, {formatTime(note.created_at)} · {audience}
        {note.shift_id && ' · About a shift'}{note.task_id && ' · About a task'}
      </p>
      {action.error && <ErrorBox message={action.error} />}
      {isAdmin && onEdit && (
        <div className="actions">
          <button type="button" className="btn small" onClick={onEdit}>Edit</button>
          <button type="button" className="btn small danger" onClick={remove} disabled={action.busy}>Delete</button>
        </div>
      )}
    </article>
  );
}

export function NoteForm({ note, onClose, onSaved }: { note?: Note; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const tasks = useAsync(fetchTasks, []);
  const [f, setF] = useState(() => ({
    title: note?.title ?? '', body: note?.body ?? '', audience: (note?.audience ?? 'all') as Audience,
    volunteer_ids: note?.recipient_ids ?? [], shift_id: note?.shift_id ?? '', task_id: note?.task_id ?? '',
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return action.setError('Please add a short title.');
    if (f.audience === 'selected' && f.volunteer_ids.length === 0) return action.setError('Choose at least one volunteer, or share with everyone.');
    if (await action.run(() => saveNote({ ...f, id: note?.id }))) { toast(note ? 'Note updated' : 'Note shared'); onSaved(); }
  };

  return (
    <Dialog title={note ? 'Edit note' : 'Share a note'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Title"><input required maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Message"><textarea rows={5} value={f.body} onChange={(e) => set('body', e.target.value)} /></Field>
        <fieldset className="picker">
          <legend>Who should see this?</legend>
          <label className="check">
            <input type="radio" name="aud" checked={f.audience === 'all'} onChange={() => set('audience', 'all')} />
            <span>All active volunteers</span>
          </label>
          <label className="check">
            <input type="radio" name="aud" checked={f.audience === 'selected'} onChange={() => set('audience', 'selected')} />
            <span>Only the volunteers I choose</span>
          </label>
        </fieldset>
        {f.audience === 'selected' && <VolunteerPicker value={f.volunteer_ids} onChange={(v) => set('volunteer_ids', v)} legend="Share with" />}
        <ShiftSelect label="Attach to a shift (optional)" value={f.shift_id} onChange={(v) => set('shift_id', v)} />
        <Field label="Attach to a task (optional)">
          <select value={f.task_id} onChange={(e) => set('task_id', e.target.value)}>
            <option value="">None</option>
            {tasks.data?.filter((t) => !t.archived || t.id === f.task_id).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
        <p className="field-hint">Everything here is visible to the people you share it with. For private remarks, use the admin-only note on a shift or task.</p>
        {action.error && <ErrorBox message={action.error} />}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={action.busy}>{action.busy ? 'Sharing…' : note ? 'Save note' : 'Share note'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
