// Fills a LOCAL Supabase stack with fictional demo data. Refuses to run against any other server.
// Usage: npm run seed:demo   (after `npx supabase start`; run `npm run db:reset` first for a clean slate)
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54521';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL)) throw new Error('seed-demo only runs against a local Supabase stack.');

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PASSWORD = 'demo-password';
const people = [
  ['coordinator@example.org', 'Grace Coordinator', 'admin'],
  ['ruth@example.org', 'Ruth Alder', 'volunteer'],
  ['sam@example.org', 'Sam Birchwood', 'volunteer'],
  ['lena@example.org', 'Lena Cedar', 'volunteer'],
];

const ids = {};
for (const [email, full_name, role] of people) {
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name } });
  if (error) throw new Error(`${email}: ${error.message} (run \`npm run db:reset\` first)`);
  ids[email.split('@')[0]] = data.user.id;
  if (role === 'admin') await db.from('profiles').update({ role }).eq('id', data.user.id).throwOnError();
}

// Times relative to "today" in America/New_York, as fixed UTC offsets are wrong across DST.
const ny = (daysFromToday, hhmm) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d + daysFromToday, h, mi);
  const off = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t)).map((x) => [x.type, +x.value]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t;
  };
  return new Date(wall - off(wall - off(wall))).toISOString();
};

const shifts = [
  ['Kitchen crew', 'Dining Hall', ny(0, '07:00'), ny(0, '11:00'), 'Aprons are on the hooks by the walk-in. Breakfast for 60 guests.', ['ruth', 'sam']],
  ['Front desk', 'Main Lodge', ny(1, '13:00'), ny(1, '17:00'), 'Greet arriving retreat groups and hand out cabin keys.', ['ruth']],
  ['Night host', 'Main Lodge', ny(2, '22:00'), ny(3, '06:00'), 'Overnight on-call. The phone list is in the red binder.', ['sam']],
  ['Grounds', 'Lakeside trail', ny(3, '09:00'), ny(3, '12:00'), 'Clear fallen branches. Gloves in the barn.', ['lena', 'sam']],
  ['Chapel setup', 'Chapel', ny(3, '10:00'), ny(3, '11:30'), null, ['lena']], // overlaps Lena's Grounds shift
  ['Housekeeping', 'Cabins 1–6', ny(-2, '10:00'), ny(-2, '14:00'), null, ['ruth', 'lena']],
];
const shiftIds = [];
for (const [role, location, starts_at, ends_at, instructions, who] of shifts) {
  const { data } = await db.from('shifts').insert({ role, location, starts_at, ends_at, instructions, created_by: ids.coordinator }).select('id').single().throwOnError();
  shiftIds.push(data.id);
  await db.from('shift_assignments').insert(who.map((w) => ({ shift_id: data.id, volunteer_id: ids[w] }))).throwOnError();
}
await db.from('admin_notes').insert({ shift_id: shiftIds[2], body: 'Sam is new to night hosting. Check in with him at 10 PM.' }).throwOnError();

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const plus = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const tasks = [
  ['Restock tea station', 'Black, green and herbal tea, plus honey packets. Supplies are in the pantry, top shelf.', plus(1), 'Dining Hall', shiftIds[0], { ruth: 'todo', sam: 'in_progress' }],
  ['Check cabin smoke detectors', 'Press test on each detector and write down any that fail.', plus(3), 'Cabins 1–6', null, { lena: 'todo' }],
  ['Fold welcome packets', null, plus(-1), 'Main Lodge', null, { ruth: 'done' }],
];
for (const [title, description, due_date, location, shift_id, who] of tasks) {
  const { data } = await db.from('tasks').insert({ title, description, due_date, location, shift_id, created_by: ids.coordinator }).select('id').single().throwOnError();
  await db.from('task_assignments').insert(Object.entries(who).map(([w, status]) => ({ task_id: data.id, volunteer_id: ids[w], status }))).throwOnError();
}

await db.from('notes').insert({ title: 'Welcome to the fall season!', body: 'Thank you for serving at Toah Nipi. Please park in the upper lot this month while the lower lot is resurfaced.', audience: 'all', created_by: ids.coordinator }).throwOnError();
const { data: n } = await db.from('notes').insert({ title: 'Kitchen crew: allergy reminder', body: 'The Saturday group has two guests with nut allergies. Use the purple cutting boards.', audience: 'selected', shift_id: shiftIds[0], created_by: ids.coordinator }).select('id').single().throwOnError();
await db.from('note_recipients').insert([{ note_id: n.id, volunteer_id: ids.ruth }, { note_id: n.id, volunteer_id: ids.sam }]).throwOnError();

console.log(`Demo data ready. Sign in at http://localhost:5180 with password "${PASSWORD}":`);
for (const [email, name, role] of people) console.log(`  ${email.padEnd(26)} ${name} (${role})`);
