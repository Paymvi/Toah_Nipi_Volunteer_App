-- Toah Nipi volunteer scheduling: schema, permissions and row-level security.
-- Every permission rule lives here; the client only hides buttons for convenience.

-- ───────────────────────── Profiles ─────────────────────────
create type public.app_role as enum ('admin', 'volunteer');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  role public.app_role not null default 'volunteer',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Helpers are SECURITY DEFINER so policies can call them without recursive RLS checks.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active);
$$;

create function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- New auth users (created by invite) get a volunteer profile. Role is never taken from metadata.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change role/active/email; an admin cannot demote or deactivate themselves
-- (prevents locking everyone out).
create function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id <> old.id then raise exception 'Cannot change profile id'; end if;
  if (new.role, new.active, new.email) is distinct from (old.role, old.active, old.email) then
    if auth.uid() is not null and not is_admin() then
      raise exception 'Only admins can change roles, status or email';
    end if;
    if auth.uid() = old.id and (new.role <> 'admin' or not new.active) then
      raise exception 'Admins cannot remove their own admin access';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

alter table public.profiles enable row level security;
create policy "read own profile or admin" on public.profiles for select
  using (id = auth.uid() or is_admin());
create policy "update own profile or admin" on public.profiles for update
  using ((id = auth.uid() and is_active_user()) or is_admin());

-- Team directory: names only, for the team schedule. No email/phone/role.
create function public.team_directory()
returns table (id uuid, full_name text, active boolean)
language sql stable security definer set search_path = public as $$
  select id, full_name, active from profiles where is_active_user() order by full_name;
$$;

-- ───────────────────────── Shifts ─────────────────────────
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  role text not null check (length(trim(role)) > 0),      -- e.g. "Kitchen crew"
  location text,                                          -- building / area
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  instructions text,                                      -- shared with assigned volunteers and team
  cancelled boolean not null default false,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint shift_time_order check (ends_at > starts_at),
  constraint shift_max_length check (ends_at - starts_at <= interval '24 hours')
);
create index shifts_starts_at_idx on public.shifts (starts_at);

create table public.shift_assignments (
  shift_id uuid not null references public.shifts (id) on delete cascade,
  volunteer_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (shift_id, volunteer_id)
);
create index shift_assignments_volunteer_idx on public.shift_assignments (volunteer_id);

alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;

-- Any active team member can see the team schedule; only admins write.
create policy "team reads shifts" on public.shifts for select using (is_active_user());
create policy "admins write shifts" on public.shifts for all using (is_admin()) with check (is_admin());
create policy "team reads assignments" on public.shift_assignments for select using (is_active_user());
create policy "admins write assignments" on public.shift_assignments for all using (is_admin()) with check (is_admin());

-- ───────────────────────── Tasks ─────────────────────────
create type public.task_status as enum ('todo', 'in_progress', 'done');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  due_date date,
  location text,
  shift_id uuid references public.shifts (id) on delete set null,
  archived boolean not null default false,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Each assigned volunteer tracks their own completion.
create table public.task_assignments (
  task_id uuid not null references public.tasks (id) on delete cascade,
  volunteer_id uuid not null references public.profiles (id),
  status public.task_status not null default 'todo',
  updated_at timestamptz not null default now(),
  primary key (task_id, volunteer_id)
);
create index task_assignments_volunteer_idx on public.task_assignments (volunteer_id);

create function public.is_assigned_to_task(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from task_assignments where task_id = t and volunteer_id = auth.uid());
$$;

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger task_assignments_touch before update on public.task_assignments
  for each row execute function public.touch_updated_at();

alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;

create policy "read assigned tasks" on public.tasks for select
  using (is_admin() or (is_active_user() and not archived and is_assigned_to_task(id)));
create policy "admins write tasks" on public.tasks for all using (is_admin()) with check (is_admin());

-- Volunteers see who else shares their task (and their progress), and may update only their own row.
create policy "read task assignments" on public.task_assignments for select
  using (is_admin() or (is_active_user() and is_assigned_to_task(task_id)));
create policy "admins write task assignments" on public.task_assignments for all
  using (is_admin()) with check (is_admin());
create policy "volunteer updates own status" on public.task_assignments for update
  using (volunteer_id = auth.uid() and is_active_user())
  with check (volunteer_id = auth.uid());

-- Column-level privilege: through the API, only `status` can ever be updated on an assignment
-- (reassigning = delete + insert, which only admins may do).
revoke update on public.task_assignments from authenticated, anon;
grant update (status) on public.task_assignments to authenticated;

-- ───────────────────────── Notes & announcements ─────────────────────────
create type public.note_audience as enum ('all', 'selected');

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text not null default '',
  audience public.note_audience not null default 'all',
  shift_id uuid references public.shifts (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.note_recipients (
  note_id uuid not null references public.notes (id) on delete cascade,
  volunteer_id uuid not null references public.profiles (id),
  primary key (note_id, volunteer_id)
);

create function public.is_note_recipient(n uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from note_recipients where note_id = n and volunteer_id = auth.uid());
$$;

alter table public.notes enable row level security;
alter table public.note_recipients enable row level security;

create policy "read shared notes" on public.notes for select
  using (is_admin() or (is_active_user() and (audience = 'all' or is_note_recipient(id))));
create policy "admins write notes" on public.notes for all using (is_admin()) with check (is_admin());
create policy "read own recipient rows" on public.note_recipients for select
  using (is_admin() or volunteer_id = auth.uid());
create policy "admins write recipients" on public.note_recipients for all using (is_admin()) with check (is_admin());

-- Admin-only notes on a shift or task. Never readable by volunteers.
create table public.admin_notes (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid unique references public.shifts (id) on delete cascade,
  task_id uuid unique references public.tasks (id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  constraint admin_note_target check (num_nonnulls(shift_id, task_id) = 1)
);
alter table public.admin_notes enable row level security;
create policy "admins only" on public.admin_notes for all using (is_admin()) with check (is_admin());

-- ───────────────────────── Atomic admin saves ─────────────────────────
-- SECURITY INVOKER: RLS still applies; the explicit check gives a clear error message.
-- Newly added assignees must be active; existing (possibly deactivated) assignees are kept for history.

create function public.save_shift(
  p_id uuid, p_role text, p_location text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_instructions text, p_volunteer_ids uuid[], p_admin_note text
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_ids uuid[] := coalesce(p_volunteer_ids, '{}');
begin
  if not is_admin() then raise exception 'Only admins can manage shifts' using errcode = '42501'; end if;
  if p_id is null then
    insert into shifts (role, location, starts_at, ends_at, instructions)
    values (p_role, nullif(trim(p_location), ''), p_starts_at, p_ends_at, nullif(trim(p_instructions), ''))
    returning id into v_id;
  else
    update shifts set role = p_role, location = nullif(trim(p_location), ''), starts_at = p_starts_at,
      ends_at = p_ends_at, instructions = nullif(trim(p_instructions), '')
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Shift not found'; end if;
  end if;
  delete from shift_assignments where shift_id = v_id and not (volunteer_id = any (v_ids));
  insert into shift_assignments (shift_id, volunteer_id)
    select v_id, p.id from profiles p where p.id = any (v_ids) and p.active
  on conflict do nothing;
  insert into admin_notes (shift_id, body) values (v_id, coalesce(p_admin_note, ''))
  on conflict (shift_id) do update set body = excluded.body, updated_at = now();
  return v_id;
end;
$$;

create function public.save_task(
  p_id uuid, p_title text, p_description text, p_due_date date, p_location text,
  p_shift_id uuid, p_volunteer_ids uuid[], p_admin_note text
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_ids uuid[] := coalesce(p_volunteer_ids, '{}');
begin
  if not is_admin() then raise exception 'Only admins can manage tasks' using errcode = '42501'; end if;
  if p_id is null then
    insert into tasks (title, description, due_date, location, shift_id)
    values (p_title, nullif(trim(p_description), ''), p_due_date, nullif(trim(p_location), ''), p_shift_id)
    returning id into v_id;
  else
    update tasks set title = p_title, description = nullif(trim(p_description), ''), due_date = p_due_date,
      location = nullif(trim(p_location), ''), shift_id = p_shift_id
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Task not found'; end if;
  end if;
  -- Existing assignees keep their progress; removed ones lose it; new ones start at To Do.
  delete from task_assignments where task_id = v_id and not (volunteer_id = any (v_ids));
  insert into task_assignments (task_id, volunteer_id)
    select v_id, p.id from profiles p where p.id = any (v_ids) and p.active
  on conflict do nothing;
  insert into admin_notes (task_id, body) values (v_id, coalesce(p_admin_note, ''))
  on conflict (task_id) do update set body = excluded.body, updated_at = now();
  return v_id;
end;
$$;

create function public.save_note(
  p_id uuid, p_title text, p_body text, p_audience public.note_audience,
  p_shift_id uuid, p_task_id uuid, p_volunteer_ids uuid[]
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_ids uuid[] := case when p_audience = 'all' then '{}' else coalesce(p_volunteer_ids, '{}') end;
begin
  if not is_admin() then raise exception 'Only admins can share notes' using errcode = '42501'; end if;
  if p_audience = 'selected' and cardinality(v_ids) = 0 then
    raise exception 'Choose at least one volunteer for this note';
  end if;
  if p_id is null then
    insert into notes (title, body, audience, shift_id, task_id)
    values (p_title, coalesce(p_body, ''), p_audience, p_shift_id, p_task_id) returning id into v_id;
  else
    update notes set title = p_title, body = coalesce(p_body, ''), audience = p_audience,
      shift_id = p_shift_id, task_id = p_task_id
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Note not found'; end if;
  end if;
  delete from note_recipients where note_id = v_id and not (volunteer_id = any (v_ids));
  insert into note_recipients (note_id, volunteer_id) select v_id, unnest(v_ids) on conflict do nothing;
  return v_id;
end;
$$;

-- Nothing is readable without signing in.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_admin(), public.is_active_user(), public.team_directory(),
  public.is_assigned_to_task(uuid), public.is_note_recipient(uuid),
  public.save_shift(uuid, text, text, timestamptz, timestamptz, text, uuid[], text),
  public.save_task(uuid, text, text, date, text, uuid, uuid[], text),
  public.save_note(uuid, text, text, public.note_audience, uuid, uuid, uuid[]) to authenticated;
