// End-to-end permission + workflow checks against the LOCAL Supabase stack (`npx supabase start`).
// Uses separate admin and volunteer sessions; follows the real invite email via Mailpit.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54521';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54524';
// Well-known local-dev demo keys printed by `supabase start`; refuse to run anywhere but localhost.
const ANON = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL)) throw new Error('Permission tests only run against a local Supabase stack.');

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(URL, ANON, opts);
const service = createClient(URL, SERVICE, opts);
const run = Date.now();
const PW = 'test-password-123';

async function makeUser(email: string, full_name: string, role: 'admin' | 'volunteer' = 'volunteer') {
  const { data, error } = await service.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name } });
  if (error) throw error;
  if (role === 'admin') await service.from('profiles').update({ role }).eq('id', data.user.id).throwOnError();
  return signIn(email);
}
async function signIn(email: string) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return { c, id: data.user.id };
}
const bad = (r: { error: unknown; data: unknown }) => r.error !== null || (Array.isArray(r.data) && r.data.length === 0);

let admin: { c: SupabaseClient; id: string };
let ann: { c: SupabaseClient; id: string }; // invited through the real email flow
let ben: { c: SupabaseClient; id: string };
let shiftId: string;
let taskId: string;
const annEmail = `ann.${run}@example.test`;

beforeAll(async () => {
  admin = await makeUser(`admin.${run}@example.test`, 'Test Admin', 'admin');
  ben = await makeUser(`ben.${run}@example.test`, 'Ben Fictional');
});

describe('1. invitations', () => {
  it('volunteers and strangers cannot invite; public sign-up is disabled', async () => {
    const r = await ben.c.functions.invoke('invite-volunteer', { body: { email: `x.${run}@example.test`, full_name: 'X' } });
    expect(r.error).not.toBeNull();
    const signup = await client().auth.signUp({ email: `walkin.${run}@example.test`, password: PW });
    expect(signup.error).not.toBeNull();
  });

  it('admin invites a volunteer, who accepts via the emailed link and sets a password', async () => {
    const r = await admin.c.functions.invoke('invite-volunteer', {
      body: { email: annEmail, full_name: 'Ann Fictional', redirect_to: 'http://localhost:5180/set-password' },
    });
    expect(r.error).toBeNull();

    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${annEmail}`)}`)).json();
    expect(list.messages.length).toBe(1);
    const msg = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
    const link = (msg.HTML as string).match(/href="([^"]+verify[^"]+)"/)![1].replace(/&amp;/g, '&');
    const res = await fetch(link, { redirect: 'manual' });
    const hash = new URLSearchParams(res.headers.get('location')!.split('#')[1]);
    expect(hash.get('type')).toBe('invite');

    const c = client();
    await c.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
    expect((await c.auth.updateUser({ password: PW })).error).toBeNull();
    ann = await signIn(annEmail);
    const { data } = await ann.c.from('profiles').select('full_name, role, active').eq('id', ann.id).single();
    expect(data).toEqual({ full_name: 'Ann Fictional', role: 'volunteer', active: true });
  });
});

describe('2–4. shifts', () => {
  it('admin creates an overnight shift assigned to Ann, with an admin-only note', async () => {
    const { data, error } = await admin.c.rpc('save_shift', {
      p_id: null, p_role: 'Night host', p_location: 'Lodge', p_starts_at: '2026-12-05T03:00:00Z',
      p_ends_at: '2026-12-05T11:00:00Z', p_instructions: 'Keys are at the front desk.',
      p_volunteer_ids: [ann.id], p_admin_note: 'PRIVATE: Ann asked to leave early.',
    });
    expect(error).toBeNull();
    shiftId = data;
  });

  it('Ann sees it as her shift; Ben sees it on the team schedule', async () => {
    for (const who of [ann, ben]) {
      const { data } = await who.c.from('shifts').select('role, instructions, shift_assignments(volunteer_id)').eq('id', shiftId).single();
      expect(data!.role).toBe('Night host');
      expect(data!.shift_assignments).toEqual([{ volunteer_id: ann.id }]);
    }
  });

  it('volunteers cannot read admin-only notes or other people’s contact details', async () => {
    expect((await ann.c.from('admin_notes').select('body')).data).toEqual([]);
    const profiles = await ben.c.from('profiles').select('id, email');
    expect(profiles.data!.map((p) => p.id)).toEqual([ben.id]);
    const team = await ben.c.rpc('team_directory');
    expect(Object.keys(team.data[0]).sort()).toEqual(['active', 'full_name', 'id']);
    expect((await client().from('shifts').select('id')).data ?? []).toEqual([]); // signed out
  });

  it('volunteers cannot create, edit or reassign shifts', async () => {
    expect(bad(await ben.c.rpc('save_shift', { p_id: shiftId, p_role: 'x', p_location: '', p_starts_at: '2026-12-05T03:00:00Z',
      p_ends_at: '2026-12-05T04:00:00Z', p_instructions: '', p_volunteer_ids: [ben.id], p_admin_note: '' }))).toBe(true);
    expect(bad(await ben.c.from('shifts').update({ role: 'hacked' }).eq('id', shiftId).select())).toBe(true);
    expect(bad(await ben.c.from('shift_assignments').insert({ shift_id: shiftId, volunteer_id: ben.id }).select())).toBe(true);
    expect(bad(await ann.c.from('shift_assignments').delete().eq('shift_id', shiftId).select())).toBe(true);
  });

  it('volunteers cannot promote themselves; admins cannot demote themselves', async () => {
    expect((await ben.c.from('profiles').update({ role: 'admin' }).eq('id', ben.id)).error).not.toBeNull();
    expect((await ben.c.from('profiles').update({ full_name: 'Ben F.' }).eq('id', ben.id)).error).toBeNull();
    expect((await ben.c.from('profiles').update({ full_name: 'x' }).eq('id', ann.id).select()).data).toEqual([]);
    expect((await admin.c.from('profiles').update({ role: 'volunteer' }).eq('id', admin.id)).error).not.toBeNull();
  });
});

describe('5–7. tasks and notes', () => {
  it('admin assigns a task to Ann and Ben; each tracks their own status', async () => {
    const { data, error } = await admin.c.rpc('save_task', {
      p_id: null, p_title: 'Set up chairs', p_description: 'Rows of 10', p_due_date: '2026-12-04', p_location: 'Chapel',
      p_shift_id: shiftId, p_volunteer_ids: [ann.id, ben.id], p_admin_note: 'PRIVATE task note',
    });
    expect(error).toBeNull();
    taskId = data;

    expect((await ann.c.from('task_assignments').update({ status: 'done' }).eq('task_id', taskId).eq('volunteer_id', ann.id).select()).data).toHaveLength(1);
    // Ann cannot change Ben's status, the task itself, or move her assignment
    expect((await ann.c.from('task_assignments').update({ status: 'done' }).eq('task_id', taskId).eq('volunteer_id', ben.id).select()).data).toEqual([]);
    expect(bad(await ann.c.from('tasks').update({ title: 'x' }).eq('id', taskId).select())).toBe(true);
    expect((await ann.c.from('task_assignments').update({ volunteer_id: ben.id }).eq('task_id', taskId)).error).not.toBeNull();

    const { data: seen } = await admin.c.from('task_assignments').select('volunteer_id, status').eq('task_id', taskId);
    expect(Object.fromEntries(seen!.map((a) => [a.volunteer_id, a.status]))).toEqual({ [ann.id]: 'done', [ben.id]: 'todo' });
  });

  it('volunteers only see their own tasks, and not archived ones', async () => {
    const other = await admin.c.rpc('save_task', { p_id: null, p_title: 'Ann only', p_description: '', p_due_date: null,
      p_location: '', p_shift_id: null, p_volunteer_ids: [ann.id], p_admin_note: '' });
    expect((await ben.c.from('tasks').select('id').eq('id', other.data)).data).toEqual([]);
    await admin.c.from('tasks').update({ archived: true }).eq('id', other.data).throwOnError();
    expect((await ann.c.from('tasks').select('id').eq('id', other.data)).data).toEqual([]);
  });

  it('notes reach exactly the chosen audience', async () => {
    const toAnn = await admin.c.rpc('save_note', { p_id: null, p_title: 'For Ann', p_body: 'Hi', p_audience: 'selected',
      p_shift_id: shiftId, p_task_id: null, p_volunteer_ids: [ann.id] });
    const toAll = await admin.c.rpc('save_note', { p_id: null, p_title: 'Everyone', p_body: 'Welcome', p_audience: 'all',
      p_shift_id: null, p_task_id: null, p_volunteer_ids: [] });
    const ids = async (who: typeof ann) => (await who.c.from('notes').select('id')).data!.map((n) => n.id);
    expect(await ids(ann)).toEqual(expect.arrayContaining([toAnn.data, toAll.data]));
    expect(await ids(ben)).toContain(toAll.data);
    expect(await ids(ben)).not.toContain(toAnn.data);
    expect(bad(await ben.c.rpc('save_note', { p_id: null, p_title: 'x', p_body: '', p_audience: 'all',
      p_shift_id: null, p_task_id: null, p_volunteer_ids: [] }))).toBe(true);
  });
});

describe('8. reassign, cancel, deactivate', () => {
  it('reassigning moves the shift from Ann to Ben, and cancelling is visible to all', async () => {
    await admin.c.rpc('save_shift', { p_id: shiftId, p_role: 'Night host', p_location: 'Lodge', p_starts_at: '2026-12-05T03:00:00Z',
      p_ends_at: '2026-12-05T12:00:00Z', p_instructions: 'Updated', p_volunteer_ids: [ben.id], p_admin_note: '' }).throwOnError();
    const { data } = await ann.c.from('shifts').select('ends_at, instructions, shift_assignments(volunteer_id)').eq('id', shiftId).single();
    expect(data!.shift_assignments).toEqual([{ volunteer_id: ben.id }]);
    expect(data!.instructions).toBe('Updated');
    await admin.c.from('shifts').update({ cancelled: true }).eq('id', shiftId).throwOnError();
    expect((await ben.c.from('shifts').select('cancelled').eq('id', shiftId).single()).data!.cancelled).toBe(true);
  });

  it('deactivated volunteers lose access, but their history is kept', async () => {
    await admin.c.from('profiles').update({ active: false }).eq('id', ann.id).throwOnError();
    expect((await ann.c.from('shifts').select('id')).data).toEqual([]);
    expect((await ann.c.from('tasks').select('id')).data).toEqual([]);
    expect((await ann.c.from('task_assignments').update({ status: 'todo' }).eq('task_id', taskId).eq('volunteer_id', ann.id).select()).data).toEqual([]);
    const { data } = await admin.c.from('task_assignments').select('status').eq('task_id', taskId).eq('volunteer_id', ann.id).single();
    expect(data!.status).toBe('done');
    // Inactive people cannot be newly assigned
    const t = await admin.c.rpc('save_task', { p_id: null, p_title: 'New', p_description: '', p_due_date: null, p_location: '',
      p_shift_id: null, p_volunteer_ids: [ann.id], p_admin_note: '' });
    expect((await admin.c.from('task_assignments').select('volunteer_id').eq('task_id', t.data)).data).toEqual([]);
  });
});
