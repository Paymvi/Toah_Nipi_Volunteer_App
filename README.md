# Toah Nipi Volunteers

A mobile-first volunteer scheduling and task app for Toah Nipi Christian Retreat Center.
Admins schedule shifts, assign tasks and share notes. Volunteers see when they're serving, what to do, and what's been shared with them.

**Stack:** Vite, React and TypeScript, with [Supabase](https://supabase.com) for sign-in, Postgres and row-level security, plus one edge function for invitations.

## Features

- **Home:** your next shift with full details, upcoming shifts, open tasks, and notes and announcements.
- **Schedule:** My Schedule or Team Schedule, by week (Prev / Today / Next). Phones get a day-by-day list; wide screens get a 7-column grid. Tap a shift for its details. Labels mark Today, Happening now, Past, Cancelled and overnight shifts. Admins get double-booking warnings.
- **Tasks:** each assigned volunteer tracks their own To Do, In Progress or Done status. Admins can filter by volunteer and status, and can archive or delete tasks.
- **Notes:** share with everyone, with chosen volunteers, or with one person. A note can be attached to a shift or a task.
- **Admin-only notes** on shifts and tasks are stored in a separate table that volunteers' accounts cannot read.
- **Accounts:** invitation only (public sign-up is off). Admins can promote, demote, deactivate or reactivate people. Deactivated volunteers lose access, but their past shifts and tasks are kept.

All times are shown and entered in **America/New_York**, whatever timezone the device uses, and daylight saving changes are handled. If a shift's end time is earlier than its start time, it ends the next day.

## Local development

You'll need Node 20+ and Docker Desktop (running).

```bash
npm install
npx supabase start          # starts local Postgres, Auth, edge functions and Mailpit; applies the migration
cp .env.example .env.local  # the defaults already match the local stack
npm run seed:demo           # optional: fictional demo people and shifts (local only)
npm run dev                 # http://localhost:5180
```

Demo sign-ins (after `seed:demo`, all with password `demo-password`): `coordinator@example.org` (admin), plus `ruth@`, `sam@` and `lena@example.org` (volunteers).

- **Invitation and password emails** go to the local mail catcher, Mailpit, at http://127.0.0.1:54524. Nothing is actually sent.
- **Supabase Studio** (database browser): http://127.0.0.1:54523
- **Start fresh:** `npm run db:reset` wipes the local database and re-applies the migration.

This project uses ports **5452x** for Supabase and **5180** for the app, so it can run next to other local Supabase projects.

### Tests

```bash
npm test         # unit tests: timezone/DST, overnight shifts, overlap detection, task filters
npm run test:db  # permission and workflow tests against the LOCAL stack (needs `supabase start`)
```

`test:db` signs in as an admin and as separate volunteers. It follows a real invite email through Mailpit, then checks every access rule: no self-promotion, no editing other people's tasks, no reading admin-only notes or other people's contact details, and that deactivation removes access. It refuses to run against anything except localhost.

## Environment variables

| Variable | Where | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` / hosting | Project URL (Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` / hosting | The **anon / publishable** key. It's safe in the browser because row-level security enforces every rule. |

**Never** put the `service_role` (secret) key in a `VITE_` variable. Only the `invite-volunteer` edge function uses it, and Supabase provides it to the function on the server automatically.

## Production setup (Supabase cloud)

These steps need your Supabase account. Nothing here has been run against a real project yet.

1. **Create a project** at supabase.com. This should be its own project, separate from the staff/booking database.
2. **Apply the schema:**
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Deploy the invite function:** `npx supabase functions deploy invite-volunteer`
4. **Auth settings** (Dashboard → Authentication):
   - Sign In / Providers: turn **off** "Allow new users to sign up". Leave Email enabled.
   - URL Configuration: set **Site URL** to your app's URL, and add `https://<your-domain>/set-password` under Redirect URLs.
   - **SMTP:** set up custom SMTP (for example Resend, Postmark or SendGrid). Supabase's built-in email service only allows a few emails per hour and isn't meant for real invitations.
   - Optional: edit the "Invite user" and "Reset password" email templates to mention Toah Nipi.
5. **Host the app** on any static host (Netlify, Vercel, Cloudflare Pages). Run `npm run build` and publish `dist/`. Set the two `VITE_` variables above. Add a single-page-app rewrite so every path serves `/index.html` (otherwise invite links to `/set-password` will 404).

### Creating the first admin

The app only lets admins invite people, so the first admin is set up by hand once:

1. Dashboard → Authentication → Users → **Invite user**, and enter your own email.
2. Open the email, follow the link, and choose a password on the "Set your password" page.
3. Dashboard → SQL Editor, run:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
4. Sign in. From then on, invite volunteers under **profile menu → Manage volunteers**, and promote other admins there.

## How permissions are enforced

Everything is enforced in the database (`supabase/migrations/…_init.sql`), not just by hiding buttons:

- **Profiles:** you can read your own profile, and admins can read all. Changing a role, active status or email requires an admin, and an admin can't demote or deactivate themselves. The team schedule gets names only, through `team_directory()`, never emails or phone numbers.
- **Shifts and assignments:** any active member can read them; only admins can write.
- **Tasks:** volunteers can only read tasks assigned to them (and not archived ones). The only column a volunteer can update is `status`, and only on their own row (a column-level grant plus row-level security).
- **Notes:** visible to everyone, or only to the chosen recipients. `admin_notes` is readable only by admins.
- **Inactive accounts** can read nothing.
- **Admin saves** (`save_shift`, `save_task`, `save_note`) are transactions, so a failed save never leaves assignments half-updated.

## Project layout

```
src/lib/time.ts      Timezone, DST, overnight and overlap helpers
src/lib/api.ts       Supabase client and data access
src/auth.tsx         Session, profile and team names
src/shifts.tsx       Shift card, detail and form
src/tasks.tsx        Task card, detail, form and filters
src/notes.tsx        Note card and form
src/pages/           Home, Schedule, Tasks, Notes, Volunteers, Account and sign-in
supabase/            Config, migration, invite-volunteer edge function
scripts/seed-demo.mjs  Fictional local demo data
```

## Not included (by design)

Time tracking, clock-in/out, payroll, shift swapping, open-shift claiming, recurring shifts, chat and push notifications.
