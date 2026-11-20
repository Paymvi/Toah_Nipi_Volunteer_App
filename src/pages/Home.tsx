import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { fetchNotes, fetchTasks, type Note, type Shift, type Task } from '../lib/api';
import { dayKey, formatDayLong, formatTimeRange, shiftTiming } from '../lib/time';
import { NoteCard, NoteForm } from '../notes';
import { fetchUpcomingShifts, ShiftCard, ShiftDetail, ShiftForm } from '../shifts';
import { TaskCard, TaskDetail, TaskForm } from '../tasks';
import { Empty, ErrorBox, joinNames, Loading, TimingBadge, useAsync } from '../ui';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const { profile, isAdmin, nameOf } = useAuth();
  const me = profile!.id;
  const shifts = useAsync(fetchUpcomingShifts, []);
  const tasks = useAsync(fetchTasks, []);
  const notes = useAsync(fetchNotes, []);
  const [open, setOpen] = useState<{ shift?: Shift; task?: Task; note?: Note; newNote?: boolean; newShift?: boolean; newTask?: boolean }>({});
  const close = () => setOpen({});

  const now = new Date();
  const myShifts = (shifts.data ?? []).filter((s) => s.volunteer_ids.includes(me) && new Date(s.ends_at) > now);
  const next = myShifts.find((s) => !s.cancelled);
  const later = myShifts.filter((s) => s !== next).slice(0, 5);
  const myTasks = (tasks.data ?? []).filter((t) => !t.archived && t.assignments.some((a) => a.volunteer_id === me && a.status !== 'done'));
  const firstName = profile!.full_name.split(' ')[0];

  return (
    <div className="page">
      <h1 className="greeting">{greeting()}{firstName && `, ${firstName}`}</h1>
      <p className="muted">{formatDayLong(dayKey(now))}</p>

      {isAdmin && (
        <div className="quick-actions">
          <button type="button" className="btn" onClick={() => setOpen({ newShift: true })}>＋ New shift</button>
          <button type="button" className="btn" onClick={() => setOpen({ newTask: true })}>＋ New task</button>
          <button type="button" className="btn" onClick={() => setOpen({ newNote: true })}>＋ Share a note</button>
        </div>
      )}

      <section aria-labelledby="next-h">
        <h2 id="next-h">Your next shift</h2>
        {shifts.error ? <ErrorBox message={shifts.error} onRetry={shifts.reload} />
          : shifts.loading && !shifts.data ? <Loading />
          : next ? (
            <button type="button" className="card next-shift" onClick={() => setOpen({ shift: next })}>
              <span className="next-date">{formatDayLong(dayKey(next.starts_at))} <TimingBadge timing={shiftTiming(next.starts_at, next.ends_at)} /></span>
              <span className="next-time">{formatTimeRange(next.starts_at, next.ends_at)}</span>
              <span className="next-role">{next.role}{next.location && ` · ${next.location}`}</span>
              {next.volunteer_ids.length > 1 && <span className="shift-meta">With {joinNames(next.volunteer_ids.filter((v) => v !== me).map(nameOf))}</span>}
              {next.instructions && <span className="next-instructions">{next.instructions}</span>}
              <span className="link-like">View details →</span>
            </button>
          ) : <Empty>You don’t have any upcoming shifts.</Empty>}
      </section>

      {later.length > 0 && (
        <section aria-labelledby="later-h">
          <h2 id="later-h">Coming up</h2>
          <div className="stack">
            {later.map((s) => <ShiftCard key={s.id} shift={s} showDate showNames={false} onOpen={() => setOpen({ shift: s })} />)}
          </div>
          <Link to="/schedule" className="see-all">See your full schedule →</Link>
        </section>
      )}

      <section aria-labelledby="tasks-h">
        <h2 id="tasks-h">Your tasks</h2>
        {tasks.error ? <ErrorBox message={tasks.error} onRetry={tasks.reload} />
          : tasks.loading && !tasks.data ? <Loading />
          : myTasks.length ? (
            <div className="stack">{myTasks.slice(0, 5).map((t) => <TaskCard key={t.id} task={t} onOpen={() => setOpen({ task: t })} />)}</div>
          ) : <Empty>You’re all caught up. No tasks waiting for you.</Empty>}
        <Link to="/tasks" className="see-all">{isAdmin ? 'Manage all tasks →' : 'See all your tasks →'}</Link>
      </section>

      <section aria-labelledby="notes-h">
        <h2 id="notes-h">Notes & announcements</h2>
        {notes.error ? <ErrorBox message={notes.error} onRetry={notes.reload} />
          : notes.loading && !notes.data ? <Loading />
          : notes.data?.length ? (
            <div className="stack">
              {notes.data.slice(0, 3).map((n) => <NoteCard key={n.id} note={n} onEdit={() => setOpen({ note: n })} onDeleted={notes.reload} />)}
            </div>
          ) : <Empty>No notes or announcements right now.</Empty>}
        {(notes.data?.length ?? 0) > 3 && <Link to="/notes" className="see-all">See all notes →</Link>}
      </section>

      {open.shift && <ShiftDetail shift={open.shift} onClose={close} onChanged={shifts.reload} />}
      {open.task && <TaskDetail task={open.task} onClose={close} onChanged={tasks.reload} />}
      {(open.note || open.newNote) && <NoteForm note={open.note} onClose={close} onSaved={() => { close(); notes.reload(); }} />}
      {open.newShift && <ShiftForm onClose={close} onSaved={() => { close(); shifts.reload(); }} />}
      {open.newTask && <TaskForm onClose={close} onSaved={() => { close(); tasks.reload(); }} />}
    </div>
  );
}
