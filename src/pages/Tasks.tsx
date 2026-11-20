import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { fetchTasks, STATUS_LABEL, type Task } from '../lib/api';
import { matchesTaskFilter, STATUSES, TaskCard, TaskDetail, TaskForm, type StatusFilter } from '../tasks';
import { Empty, ErrorBox, Field, Loading, useAsync } from '../ui';

export default function Tasks() {
  const { profile, isAdmin, team } = useAuth();
  const tasks = useAsync(fetchTasks, []);
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const param = (k: string, d: string) => params.get(k) ?? d;
  const update = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }); };

  // Volunteers see only their own tasks; admins can filter everyone's.
  const volunteer = isAdmin ? param('who', '') : profile!.id;
  const status = param('status', 'outstanding') as StatusFilter;
  const showArchived = isAdmin && param('archived', '') === '1';
  const list = (tasks.data ?? []).filter((t) => (showArchived || !t.archived) && matchesTaskFilter(t, volunteer, status));

  return (
    <div className="page">
      <div className="page-head">
        <h1>{isAdmin ? 'Tasks' : 'Your tasks'}</h1>
        {isAdmin && <button type="button" className="btn primary" onClick={() => setCreating(true)}>＋ New task</button>}
      </div>

      {isAdmin ? (
        <div className="filters">
          <Field label="Volunteer">
            <select value={volunteer} onChange={(e) => update('who', e.target.value)}>
              <option value="">Everyone</option>
              {team.map((p) => <option key={p.id} value={p.id}>{p.full_name}{!p.active && ' (inactive)'}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => update('status', e.target.value)}>
              <option value="outstanding">Outstanding</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              <option value="any">Any status</option>
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={showArchived} onChange={(e) => update('archived', e.target.checked ? '1' : '')} />
            <span>Show archived</span>
          </label>
        </div>
      ) : (
        <div className="segmented" role="radiogroup" aria-label="Show tasks">
          {([['outstanding', 'To do'], ['done', 'Done'], ['any', 'All']] as const).map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={status === v} className={status === v ? 'on' : ''} onClick={() => update('status', v)}>{label}</button>
          ))}
        </div>
      )}

      {tasks.error && <ErrorBox message={tasks.error} onRetry={tasks.reload} />}
      {tasks.loading && !tasks.data ? <Loading label="Loading tasks…" /> : list.length ? (
        <div className="stack">{list.map((t) => <TaskCard key={t.id} task={t} adminView={isAdmin} onOpen={() => setOpen(t)} />)}</div>
      ) : (
        <Empty>{status === 'outstanding' ? (isAdmin ? 'No outstanding tasks. Everything is done!' : 'You’re all caught up. No tasks waiting for you.') : 'No tasks match.'}</Empty>
      )}

      {open && <TaskDetail task={open} onClose={() => setOpen(null)} onChanged={tasks.reload} />}
      {creating && <TaskForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); tasks.reload(); }} />}
    </div>
  );
}
