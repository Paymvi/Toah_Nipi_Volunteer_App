import { createClient, type PostgrestError } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(url && key);
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing');

export type Role = 'admin' | 'volunteer';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type Audience = 'all' | 'selected';

export interface Profile { id: string; full_name: string; email: string; phone: string | null; role: Role; active: boolean }
export interface Person { id: string; full_name: string; active: boolean }
export interface Shift {
  id: string; role: string; location: string | null; starts_at: string; ends_at: string;
  instructions: string | null; cancelled: boolean; volunteer_ids: string[];
}
export interface TaskAssignment { volunteer_id: string; status: TaskStatus; updated_at: string }
export interface Task {
  id: string; title: string; description: string | null; due_date: string | null; location: string | null;
  shift_id: string | null; archived: boolean; created_at: string; assignments: TaskAssignment[];
}
export interface Note {
  id: string; title: string; body: string; audience: Audience; shift_id: string | null; task_id: string | null;
  created_at: string; recipient_ids: string[];
}

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

function friendly(e: PostgrestError | { message: string }) {
  const m = e.message;
  if (/row-level security|permission denied|42501|Only admins/i.test(m)) return 'You don’t have permission to do that.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Can’t reach the server. Check your connection and try again.';
  if (/shift_time_order/.test(m)) return 'The shift must end after it starts.';
  if (/shift_max_length/.test(m)) return 'A shift can be at most 24 hours long.';
  return m;
}

async function run<T>(p: PromiseLike<{ data: T; error: PostgrestError | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendly(error));
  return data;
}

// ── People ──
export const fetchMyProfile = (id: string) =>
  run(supabase.from('profiles').select('id, full_name, email, phone, role, active').eq('id', id).maybeSingle()) as Promise<Profile | null>;
export const fetchTeam = () => run(supabase.rpc('team_directory')) as Promise<Person[]>;
export const fetchProfiles = () =>
  run(supabase.from('profiles').select('id, full_name, email, phone, role, active').order('full_name')) as Promise<Profile[]>;
export const updateProfile = (id: string, patch: Partial<Pick<Profile, 'full_name' | 'phone' | 'role' | 'active'>>) =>
  run(supabase.from('profiles').update(patch).eq('id', id).select('id').single());

export async function inviteVolunteer(full_name: string, email: string) {
  const { data, error } = await supabase.functions.invoke('invite-volunteer', {
    body: { full_name, email, redirect_to: `${window.location.origin}/set-password` },
  });
  if (error) {
    // FunctionsHttpError carries our JSON body in error.context
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? 'The invitation could not be sent. Please try again.');
  }
  return data as { id: string };
}

// ── Shifts ──
type ShiftRow = Omit<Shift, 'volunteer_ids'> & { shift_assignments: { volunteer_id: string }[] };
const SHIFT_COLS = 'id, role, location, starts_at, ends_at, instructions, cancelled, shift_assignments(volunteer_id)';
const toShift = ({ shift_assignments, ...s }: ShiftRow): Shift => ({ ...s, volunteer_ids: shift_assignments.map((a) => a.volunteer_id) });

/** Shifts overlapping [from, to). */
export async function fetchShifts(from: Date, to: Date) {
  const rows = await run(supabase.from('shifts').select(SHIFT_COLS)
    .lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()).order('starts_at'));
  return (rows as unknown as ShiftRow[]).map(toShift);
}
export async function fetchShift(id: string) {
  const row = await run(supabase.from('shifts').select(SHIFT_COLS).eq('id', id).maybeSingle());
  return row ? toShift(row as unknown as ShiftRow) : null;
}
export interface ShiftInput {
  id?: string; role: string; location: string; starts_at: string; ends_at: string;
  instructions: string; volunteer_ids: string[]; admin_note: string;
}
export const saveShift = (s: ShiftInput) => run(supabase.rpc('save_shift', {
  p_id: s.id ?? null, p_role: s.role.trim(), p_location: s.location, p_starts_at: s.starts_at, p_ends_at: s.ends_at,
  p_instructions: s.instructions, p_volunteer_ids: s.volunteer_ids, p_admin_note: s.admin_note,
})) as Promise<string>;
export const setShiftCancelled = (id: string, cancelled: boolean) =>
  run(supabase.from('shifts').update({ cancelled }).eq('id', id).select('id').single());

/** Admin-only note. RLS returns nothing for volunteers. */
export async function fetchAdminNote(target: { shift_id: string } | { task_id: string }) {
  const [col, val] = Object.entries(target)[0];
  const row = await run(supabase.from('admin_notes').select('body').eq(col, val).maybeSingle());
  return (row as { body: string } | null)?.body ?? '';
}

// ── Tasks ──
const TASK_COLS = 'id, title, description, due_date, location, shift_id, archived, created_at, task_assignments(volunteer_id, status, updated_at)';
type TaskRow = Omit<Task, 'assignments'> & { task_assignments: TaskAssignment[] };
const toTask = ({ task_assignments, ...t }: TaskRow): Task => ({ ...t, assignments: task_assignments });

/** RLS limits volunteers to their own (non-archived) tasks. */
export async function fetchTasks() {
  const rows = await run(supabase.from('tasks').select(TASK_COLS).order('due_date', { nullsFirst: false }).order('created_at'));
  return (rows as unknown as TaskRow[]).map(toTask);
}
export interface TaskInput {
  id?: string; title: string; description: string; due_date: string; location: string;
  shift_id: string; volunteer_ids: string[]; admin_note: string;
}
export const saveTask = (t: TaskInput) => run(supabase.rpc('save_task', {
  p_id: t.id ?? null, p_title: t.title.trim(), p_description: t.description, p_due_date: t.due_date || null,
  p_location: t.location, p_shift_id: t.shift_id || null, p_volunteer_ids: t.volunteer_ids, p_admin_note: t.admin_note,
})) as Promise<string>;
export const setTaskStatus = (task_id: string, volunteer_id: string, status: TaskStatus) =>
  run(supabase.from('task_assignments').update({ status }).eq('task_id', task_id).eq('volunteer_id', volunteer_id).select('status').single());
export const setTaskArchived = (id: string, archived: boolean) =>
  run(supabase.from('tasks').update({ archived }).eq('id', id).select('id').single());
export const deleteTask = (id: string) => run(supabase.from('tasks').delete().eq('id', id).select('id').single());

// ── Notes ──
type NoteRow = Omit<Note, 'recipient_ids'> & { note_recipients: { volunteer_id: string }[] };
export async function fetchNotes() {
  const rows = await run(supabase.from('notes')
    .select('id, title, body, audience, shift_id, task_id, created_at, note_recipients(volunteer_id)')
    .order('created_at', { ascending: false }));
  return (rows as unknown as NoteRow[]).map(({ note_recipients, ...n }) => ({ ...n, recipient_ids: note_recipients.map((r) => r.volunteer_id) }));
}
export interface NoteInput {
  id?: string; title: string; body: string; audience: Audience; shift_id: string; task_id: string; volunteer_ids: string[];
}
export const saveNote = (n: NoteInput) => run(supabase.rpc('save_note', {
  p_id: n.id ?? null, p_title: n.title.trim(), p_body: n.body, p_audience: n.audience,
  p_shift_id: n.shift_id || null, p_task_id: n.task_id || null, p_volunteer_ids: n.volunteer_ids,
})) as Promise<string>;
export const deleteNote = (id: string) => run(supabase.from('notes').delete().eq('id', id).select('id').single());
