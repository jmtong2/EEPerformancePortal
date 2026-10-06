-- =====================================================================
-- Eagle Eye Performance Portal v9: Supabase database setup / upgrade
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this -> Run.
--   · New project      : creates everything.
--   · Existing project : upgrades it in place to v9 and keeps your data.
-- Safe to run again at any time; it never deletes data.
--
-- Roles (profiles.role):
--   Admin       - everything + users + TL / OM & AOM / GM + the Data menu (import/export, period & holidays, KPI, new month, delete/undo/reset)
--   Management  - add and edit telecollectors and daily entries (no Data menu, no TL / OM & AOM / GM changes)
--   Analyst     - view only
--
-- Security model: tables are READ-ONLY through the API (row-level security). Every change goes through
-- the functions below, which check the caller's role first and run as one transaction.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ========================== TABLES ==========================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  role         text not null check (role in ('Admin', 'Management', 'Analyst')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- One row per telecollector per bucket (key = CAMPAIGN__bucket__NAME). Month-to-date figures for the current month.
create table if not exists public.collectors (
  key              text primary key check (char_length(key) between 1 and 200),
  team             text not null check (team in ('curing', 'recovery')),
  campaign         text not null check (campaign ~ '^[A-ZÑ0-9 .,''-]{1,60}$'),
  name             text not null check (name ~ '^[A-ZÑ .,''-]{1,80}$'),
  accs1            integer not null default 0 check (accs1 >= 0),
  collectibles     numeric(16,2) not null default 0 check (collectibles >= 0),
  collection       numeric(16,2) not null default 0,
  penalty          numeric(16,2) not null default 0,
  beginning        numeric(16,2) not null default 0 check (beginning >= 0),
  to_retain        numeric(16,2) check (to_retain >= 0),
  fixed_prov       numeric(16,2) not null default 0,
  repo             integer not null default 0,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  constraint to_retain_not_above_beginning check (beginning = 0 or to_retain <= beginning)
);
-- v7 columns (added to older databases as well)
alter table public.collectors add column if not exists principal_bal    numeric(16,2) not null default 0 check (principal_bal >= 0);
alter table public.collectors add column if not exists target_repo      numeric(12,2) check (target_repo >= 0);
alter table public.collectors add column if not exists repo_prov        numeric(16,2) not null default 0;
alter table public.collectors add column if not exists lm_collection    numeric(16,2) check (lm_collection >= 0);
alter table public.collectors add column if not exists lm_sp_collection numeric(16,2) check (lm_sp_collection >= 0);
alter table public.collectors add column if not exists lm_fixed_prov    numeric(16,2) check (lm_fixed_prov >= 0);
alter table public.collectors add column if not exists lm_sp_fixed_prov numeric(16,2) check (lm_sp_fixed_prov >= 0);
alter table public.collectors add column if not exists lm_repo          numeric(12,2) check (lm_repo >= 0);
alter table public.collectors add column if not exists lm_sp_repo       numeric(12,2) check (lm_sp_repo >= 0);
alter table public.collectors alter column to_retain drop not null;   -- v7: To Retain may be blank
-- v8 columns (Summary_Campaign_Revised layout): each provision figure has its own # of accounts; repo by age
alter table public.collectors add column if not exists ending         numeric(16,2) not null default 0 check (ending >= 0);
alter table public.collectors add column if not exists ending_accs    integer not null default 0 check (ending_accs >= 0);
alter table public.collectors add column if not exists beginning_accs integer not null default 0 check (beginning_accs >= 0);
alter table public.collectors add column if not exists to_retain_accs integer not null default 0 check (to_retain_accs >= 0);
alter table public.collectors add column if not exists fixed_accs     integer not null default 0 check (fixed_accs >= 0);
alter table public.collectors add column if not exists repo_age2      numeric(12,2) not null default 0 check (repo_age2 >= 0);
alter table public.collectors add column if not exists repo_age3      numeric(12,2) not null default 0 check (repo_age3 >= 0);
alter table public.collectors add column if not exists repo_age4      numeric(12,2) not null default 0 check (repo_age4 >= 0);
alter table public.collectors alter column to_retain drop default;

create table if not exists public.config (
  id             integer primary key default 1 check (id = 1),
  campaigns      jsonb not null default '[]'::jsonb check (jsonb_typeof(campaigns) = 'array'),
  leaders        jsonb not null default '{"tl":[],"om":[],"gm":[]}'::jsonb check (jsonb_typeof(leaders) = 'object'),
  kpi            jsonb,
  last_import_at bigint not null default 0
);
alter table public.config add column if not exists current_period text check (current_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
alter table public.config add column if not exists as_of          date;
alter table public.config add column if not exists holidays       jsonb not null default '[]'::jsonb check (jsonb_typeof(holidays) = 'array');
alter table public.config add column if not exists schema_version integer not null default 0;
insert into public.config (id) values (1) on conflict (id) do nothing;

create table if not exists public.entries (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  campaign   text,
  team       text,
  name       text,
  date       date not null,
  collection numeric(16,2) not null default 0 check (collection >= 0),
  penalty    numeric(16,2) not null default 0 check (penalty >= 0),
  beginning  numeric(16,2) not null default 0 check (beginning >= 0),
  to_retain  numeric(16,2) not null default 0 check (to_retain >= 0),
  fixed_prov numeric(16,2) not null default 0 check (fixed_prov >= 0),
  repo       integer not null default 0 check (repo >= 0),
  by_uid     uuid,
  by_name    text,
  ts         timestamptz not null default now()
);
alter table public.entries add column if not exists repo_prov numeric(16,2) not null default 0 check (repo_prov >= 0);
create index if not exists entries_ts_idx  on public.entries (ts desc);
create index if not exists entries_key_idx on public.entries (key);

-- Undo copy (taken before delete-all / reset / import / new month). Meta is small and live; the data is never sent to browsers.
create table if not exists public.snapshots (
  id       integer primary key default 1 check (id = 1),
  reason   text not null,
  taken_at bigint not null,
  taken_by text,
  counts   jsonb
);
create table if not exists public.snapshot_data (
  id   integer primary key default 1 check (id = 1),
  data jsonb not null
);
-- Copy of the data right after the last Excel import ("Reset to last imported file"). Never sent to browsers.
create table if not exists public.baseline (
  id       integer primary key default 1 check (id = 1),
  data     jsonb not null,
  label    text,
  saved_at bigint not null
);

-- "Forgot password?" requests from the login screen (the Admin sees them under Users). Readable by Admins only.
create table if not exists public.password_reset_requests (
  id           uuid primary key default gen_random_uuid(),
  username     text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  requested_at timestamptz not null default now()
);

-- ========================== ONE-TIME v7 UPGRADE ==========================
-- Clears To Retain (it will come from the new source) and seeds the 2026 Philippine holidays once.
do $$
begin
  if coalesce((select schema_version from public.config where id = 1), 0) < 7 then
    update public.collectors set to_retain = null where true;
    update public.config set
      holidays = case when holidays = '[]'::jsonb then '[
        {"date":"2026-01-01","name":"New Year''s Day"},
        {"date":"2026-02-17","name":"Chinese New Year"},
        {"date":"2026-04-02","name":"Maundy Thursday"},
        {"date":"2026-04-03","name":"Good Friday"},
        {"date":"2026-04-09","name":"Araw ng Kagitingan"},
        {"date":"2026-05-01","name":"Labor Day"},
        {"date":"2026-06-12","name":"Independence Day"},
        {"date":"2026-08-21","name":"Ninoy Aquino Day"},
        {"date":"2026-08-31","name":"National Heroes Day"},
        {"date":"2026-11-30","name":"Bonifacio Day"},
        {"date":"2026-12-08","name":"Feast of the Immaculate Conception"},
        {"date":"2026-12-24","name":"Christmas Eve"},
        {"date":"2026-12-25","name":"Christmas Day"},
        {"date":"2026-12-30","name":"Rizal Day"},
        {"date":"2026-12-31","name":"Last Day of the Year"}
      ]'::jsonb else holidays end,
      schema_version = 7
    where id = 1;
  end if;
end $$;

-- ========================== ONE-TIME v8 UPGRADE ==========================
-- KPI Rate back to the standard targets and weights (Collection 40%/35 & 40%/30, Penalty 10%/30 & 6%/25,
-- Provision 55%/25 & 70%/35, Repo 2%/10 & 2%/10 for Curing & Recovery).
do $$
begin
  if coalesce((select schema_version from public.config where id = 1), 0) < 8 then
    update public.config set kpi = null, schema_version = 8 where id = 1;
  end if;
end $$;

-- ========================== ONE-TIME v9 UPGRADE ==========================
-- The standard TL and OM & AOM lists (the same as DEFAULT_LEADERS in js/data/defaults.js). After this the Admin changes
-- them in the portal (TL and OM & AOM tabs). The GM list is kept. A campaign that is named differently in the data
-- (e.g. "CEPAT KREDIT" for CEPAT) is matched when exactly one campaign in the data starts with that name.
-- The undo copy and the last-import copy get the same lists, so Undo and "Reset to last imported file" keep them.
create or replace function public._v9_campaign(p text) returns text
language sql stable set search_path = public as $$
  select case
    when exists (select 1 from collectors where campaign = p) then p
    when (select count(distinct campaign) from collectors where campaign like p || ' %') = 1
      then (select min(campaign) from collectors where campaign like p || ' %')
    else p end;
$$;
create or replace function public._v9_leaders(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', l->>'name', 'campaigns',
           (select jsonb_agg(_v9_campaign(c) order by o) from jsonb_array_elements_text(l->'campaigns') with ordinality as y(c, o)))
         order by n), '[]'::jsonb)
  from jsonb_array_elements(p) with ordinality as x(l, n);
$$;
revoke execute on function public._v9_campaign(text) from public, anon, authenticated;
revoke execute on function public._v9_leaders(jsonb) from public, anon, authenticated;

do $$
declare v_leaders jsonb;
begin
  if coalesce((select schema_version from public.config where id = 1), 0) < 9 then
    select jsonb_build_object(
      'tl', public._v9_leaders('[
        {"name":"RICHMOND OLIVEROS","campaigns":["ASIALINK"]},
        {"name":"JOSE ANGELO MANARPIIS","campaigns":["SURECYCLE","SOUTH ASIALINK","WISEFUND"]},
        {"name":"JOHN LESTER MAMARIL","campaigns":["GLOBAL DOMINION","GLOBAL CEBUANA"]},
        {"name":"JOHN CERLO CALIPES","campaigns":["CEPAT"]}
      ]'::jsonb),
      'om', public._v9_leaders('[
        {"name":"JAYME ANN PIL","campaigns":["ASIALINK"]},
        {"name":"ROXELL VISTAL","campaigns":["ASIALINK"]},
        {"name":"NICHOLE DELA CRUZ","campaigns":["SOUTH ASIALINK","WISEFUND","SURECYCLE"]},
        {"name":"MARHENIEL GADO","campaigns":["SOUTH ASIALINK","WISEFUND","SURECYCLE"]},
        {"name":"CECILE MARIE SOLANOY","campaigns":["GLOBAL DOMINION","GLOBAL CEBUANA"]},
        {"name":"ELOISA JANE BALLESTEROS","campaigns":["CEPAT"]}
      ]'::jsonb),
      'gm', coalesce(c.leaders->'gm', '[]'::jsonb))
    into v_leaders from public.config c where c.id = 1;
    update public.config set leaders = v_leaders, schema_version = 9 where id = 1;
    update public.baseline set data = jsonb_set(data, '{config,leaders}', v_leaders) where data ? 'config';
    update public.snapshot_data set data = jsonb_set(data, '{config,leaders}', v_leaders) where data ? 'config';
  end if;
end $$;

-- ========================== ROLE HELPERS ==========================
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role in ('Admin', 'Management'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'Admin');
$$;

create or replace function public.needs_setup() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles);
$$;
grant execute on function public.needs_setup() to anon, authenticated;

-- First account ever becomes Admin (only works while there are no profiles).
create or replace function public.claim_first_admin(p_username text, p_display_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  lock table profiles in exclusive mode;
  if exists (select 1 from profiles) then raise exception 'Setup was already completed'; end if;
  insert into profiles (id, username, display_name, role) values (auth.uid(), lower(p_username), upper(p_display_name), 'Admin');
end $$;

-- ========================== USERS (Admin only) ==========================
create or replace function public.admin_create_profile(p_uid uuid, p_username text, p_display_name text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the Admin can add users'; end if;
  if p_role not in ('Admin', 'Management', 'Analyst') then raise exception 'Unknown role'; end if;
  if not exists (select 1 from auth.users where id = p_uid) then raise exception 'Login not found'; end if;
  insert into profiles (id, username, display_name, role) values (p_uid, lower(p_username), p_display_name, p_role);
exception when unique_violation then raise exception 'Username already exists';
end $$;

create or replace function public.admin_update_user(p_uid uuid, p_role text default null, p_active boolean default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the Admin can manage users'; end if;
  if p_uid = auth.uid() then raise exception 'You cannot change your own role or status'; end if;
  if p_role is not null and p_role not in ('Admin', 'Management', 'Analyst') then raise exception 'Unknown role'; end if;
  update profiles set role = coalesce(p_role, role), active = coalesce(p_active, active) where id = p_uid;
  if not found then raise exception 'User not found'; end if;
end $$;

-- Deletes the login completely (the profile goes with it), so the username can be reused.
create or replace function public.admin_delete_user(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the Admin can delete users'; end if;
  if p_uid = auth.uid() then raise exception 'You cannot delete yourself'; end if;
  delete from auth.users where id = p_uid;
end $$;

create or replace function public.admin_set_password(p_uid uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'Only the Admin can reset passwords'; end if;
  if char_length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_uid;
  if not found then raise exception 'User not found'; end if;
  delete from password_reset_requests where username = (select username from profiles where id = p_uid);   -- request handled
end $$;

-- ========================== INTERNAL HELPERS (not callable from browsers) ==========================
-- Inserts/updates telecollectors from a JSON array (column names as keys; missing optional values stay blank).
create or replace function public._upsert_collectors(p_rows jsonb, p_who text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into collectors (key, team, campaign, name, accs1, collectibles, collection, penalty, beginning, principal_bal, to_retain,
                          fixed_prov, target_repo, repo, repo_prov, lm_collection, lm_sp_collection, lm_fixed_prov, lm_sp_fixed_prov,
                          lm_repo, lm_sp_repo, ending, ending_accs, beginning_accs, to_retain_accs, fixed_accs, repo_age2, repo_age3, repo_age4,
                          updated_at, updated_by)
  select r.key, r.team, r.campaign, r.name, coalesce(r.accs1, 0), coalesce(r.collectibles, 0), coalesce(r.collection, 0), coalesce(r.penalty, 0),
         coalesce(r.beginning, 0), coalesce(r.principal_bal, 0), r.to_retain, coalesce(r.fixed_prov, 0), r.target_repo, coalesce(r.repo, 0),
         coalesce(r.repo_prov, 0), r.lm_collection, r.lm_sp_collection, r.lm_fixed_prov, r.lm_sp_fixed_prov, r.lm_repo, r.lm_sp_repo,
         coalesce(r.ending, 0), coalesce(r.ending_accs, 0), coalesce(r.beginning_accs, 0), coalesce(r.to_retain_accs, 0), coalesce(r.fixed_accs, 0),
         coalesce(r.repo_age2, 0), coalesce(r.repo_age3, 0), coalesce(r.repo_age4, 0),
         now(), coalesce(p_who, r.updated_by)
    from jsonb_populate_recordset(null::public.collectors, coalesce(p_rows, '[]'::jsonb)) r
  on conflict (key) do update set
     team = excluded.team, campaign = excluded.campaign, name = excluded.name, accs1 = excluded.accs1, collectibles = excluded.collectibles,
     collection = excluded.collection, penalty = excluded.penalty, beginning = excluded.beginning, principal_bal = excluded.principal_bal,
     to_retain = excluded.to_retain, fixed_prov = excluded.fixed_prov, target_repo = excluded.target_repo, repo = excluded.repo,
     repo_prov = excluded.repo_prov, lm_collection = excluded.lm_collection, lm_sp_collection = excluded.lm_sp_collection,
     lm_fixed_prov = excluded.lm_fixed_prov, lm_sp_fixed_prov = excluded.lm_sp_fixed_prov, lm_repo = excluded.lm_repo,
     lm_sp_repo = excluded.lm_sp_repo, ending = excluded.ending, ending_accs = excluded.ending_accs, beginning_accs = excluded.beginning_accs,
     to_retain_accs = excluded.to_retain_accs, fixed_accs = excluded.fixed_accs, repo_age2 = excluded.repo_age2, repo_age3 = excluded.repo_age3,
     repo_age4 = excluded.repo_age4, updated_at = now(), updated_by = excluded.updated_by;
end $$;

create or replace function public._current_data() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'collectors', coalesce((select jsonb_agg(to_jsonb(c) - 'updated_at') from collectors c), '[]'::jsonb),
    'entries',    coalesce((select jsonb_agg(to_jsonb(e)) from entries e), '[]'::jsonb),
    'config',     coalesce((select to_jsonb(cf) - 'id' - 'schema_version' from config cf where cf.id = 1), '{}'::jsonb)
  );
$$;

create or replace function public._take_snapshot(p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select display_name into who from profiles where id = auth.uid();
  insert into snapshot_data (id, data) values (1, _current_data())
    on conflict (id) do update set data = excluded.data;
  insert into snapshots (id, reason, taken_at, taken_by, counts)
  values (1, p_reason, floor(extract(epoch from clock_timestamp()) * 1000)::bigint, coalesce(who, ''),
          jsonb_build_object('collectors', (select count(*) from collectors), 'entries', (select count(*) from entries)))
  on conflict (id) do update set reason = excluded.reason, taken_at = excluded.taken_at, taken_by = excluded.taken_by, counts = excluded.counts;
end $$;

-- Replaces ALL telecollectors, entries and settings with the given data set.
create or replace function public._restore_data(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from entries where true;
  delete from collectors where true;
  update config set
    campaigns      = coalesce(p->'config'->'campaigns', '[]'::jsonb),
    leaders        = coalesce(p->'config'->'leaders', '{"tl":[],"om":[],"gm":[]}'::jsonb),
    kpi            = p->'config'->'kpi',
    last_import_at = coalesce((p->'config'->>'last_import_at')::bigint, 0),
    current_period = nullif(p->'config'->>'current_period', ''),
    as_of          = nullif(p->'config'->>'as_of', '')::date,
    holidays       = case when jsonb_typeof(p->'config'->'holidays') = 'array' then p->'config'->'holidays' else holidays end
  where id = 1;
  perform _upsert_collectors(p->'collectors', null);
  insert into entries (id, key, campaign, team, name, date, collection, penalty, beginning, to_retain, fixed_prov, repo, repo_prov, by_uid, by_name, ts)
  select coalesce(e.id, gen_random_uuid()), e.key, e.campaign, e.team, e.name, coalesce(e.date, current_date), coalesce(e.collection, 0),
         coalesce(e.penalty, 0), coalesce(e.beginning, 0), coalesce(e.to_retain, 0), coalesce(e.fixed_prov, 0), coalesce(e.repo, 0),
         coalesce(e.repo_prov, 0), e.by_uid, e.by_name, coalesce(e.ts, now())
    from jsonb_populate_recordset(null::public.entries, coalesce(p->'entries', '[]'::jsonb)) e;
end $$;

revoke execute on function public._upsert_collectors(jsonb, text) from public, anon, authenticated;
revoke execute on function public._current_data() from public, anon, authenticated;
revoke execute on function public._take_snapshot(text) from public, anon, authenticated;
revoke execute on function public._restore_data(jsonb) from public, anon, authenticated;

-- ========================== DAILY ENTRIES (Admin + Management) ==========================
-- Functions whose parameters changed in v7 are dropped first so the old versions cannot be called.
drop function if exists public.add_daily_entry(text, date, numeric, numeric, numeric, numeric, integer);
drop function if exists public.admin_import_collectors(jsonb, text, text);
drop function if exists public.admin_replace_all(jsonb, text);

-- Adds to an existing telecollector and moves the data "as of" date forward.
create or replace function public.add_daily_entry(
  p_key text, p_date date, p_collection numeric, p_penalty numeric, p_fixed_prov numeric, p_repo integer, p_repo_prov numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles; c collectors;
begin
  select * into me from profiles where id = auth.uid() and active and role in ('Admin', 'Management');
  if not found then raise exception 'Only Admin and Management can submit daily entries'; end if;
  p_collection := coalesce(p_collection, 0); p_penalty := coalesce(p_penalty, 0); p_fixed_prov := coalesce(p_fixed_prov, 0);
  p_repo := coalesce(p_repo, 0); p_repo_prov := coalesce(p_repo_prov, 0);
  if p_collection < 0 or p_penalty < 0 or p_fixed_prov < 0 or p_repo < 0 or p_repo_prov < 0 then raise exception 'Amounts cannot be negative'; end if;
  if p_collection = 0 and p_penalty = 0 and p_fixed_prov = 0 and p_repo = 0 and p_repo_prov = 0 then raise exception 'Enter at least one amount'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Manila')::date then raise exception 'Date cannot be in the future'; end if;

  select * into c from collectors where key = p_key for update;
  if not found then raise exception 'Telecollector not found. Add them first via Add Tele Collector.'; end if;
  if c.accs1 > 0 and c.repo + p_repo > c.accs1 then raise exception 'Repo cannot exceed the number of accounts (%)', c.accs1; end if;

  update collectors set collection = collection + p_collection, penalty = penalty + p_penalty, fixed_prov = fixed_prov + p_fixed_prov,
         repo = repo + p_repo, repo_prov = repo_prov + p_repo_prov, updated_at = now(), updated_by = me.username
   where key = p_key;
  insert into entries (key, campaign, team, name, date, collection, penalty, fixed_prov, repo, repo_prov, by_uid, by_name)
  values (c.key, c.campaign, c.team, c.name, p_date, p_collection, p_penalty, p_fixed_prov, p_repo, p_repo_prov, auth.uid(), me.display_name);
  update config set as_of = greatest(coalesce(as_of, p_date), p_date)
   where id = 1 and (current_period is null or current_period = to_char(p_date, 'YYYY-MM'));
end $$;

-- Undo one entry (subtracts its amounts).
create or replace function public.delete_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e entries; v_import bigint;
begin
  if not is_editor() then raise exception 'Only Admin and Management can undo entries'; end if;
  delete from entries where id = p_id returning * into e;
  if not found then return; end if;
  select last_import_at into v_import from config where id = 1;
  if coalesce(v_import, 0) > 0 and e.ts < to_timestamp(v_import::double precision / 1000) then
    raise exception 'This entry was made before the last Excel import or new month, so it cannot be undone';
  end if;
  update collectors set collection = collection - e.collection, penalty = penalty - e.penalty, beginning = beginning - e.beginning,
         to_retain = case when to_retain is null then null else to_retain - e.to_retain end,
         fixed_prov = fixed_prov - e.fixed_prov, repo = repo - e.repo, repo_prov = repo_prov - e.repo_prov, updated_at = now()
   where key = e.key;
exception when check_violation then
  raise exception 'Undoing this entry would make Beginning lower than To Retain. Edit To Retain first.';
end $$;

-- ========================== TELECOLLECTORS & SETTINGS ==========================
-- Add or edit a telecollector in one transaction (blocks duplicates, handles renames).
create or replace function public.save_collector(p_old_key text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text := p->>'key'; who text;
begin
  if not is_editor() then raise exception 'Only Admin and Management can add or edit telecollectors'; end if;
  if k is null or k = '' then raise exception 'Missing telecollector key'; end if;
  if (p_old_key is null or p_old_key <> k) and exists (select 1 from collectors where key = k) then raise exception 'DUPLICATE:%', k; end if;
  select username into who from profiles where id = auth.uid();
  if p_old_key is not null and p_old_key <> k then delete from collectors where key = p_old_key; end if;
  perform _upsert_collectors(jsonb_build_array(p), who);
  if p_old_key is not null and p_old_key <> k then
    update entries set key = k, name = p->>'name', campaign = p->>'campaign', team = p->>'team' where key = p_old_key;
  end if;
  update config set campaigns = campaigns || jsonb_build_array(p->>'campaign') where id = 1 and not (campaigns ? (p->>'campaign'));
exception when check_violation then
  raise exception 'Invalid telecollector data (check the name, negative values, and that To Retain is not more than Beginning)';
end $$;

create or replace function public.delete_collector(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_editor() then raise exception 'Only Admin and Management can delete telecollectors'; end if;
  delete from collectors where key = p_key;
end $$;

-- TL / OM & AOM / GM, campaigns, KPI settings, month, "as of" date and holidays: Admin only (v9).
create or replace function public.save_config(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the Admin can change TL / OM & AOM / GM, KPI settings, the month and holidays'; end if;
  if p ? 'campaigns' and jsonb_typeof(p->'campaigns') <> 'array' then raise exception 'Invalid campaigns'; end if;
  if p ? 'leaders' and jsonb_typeof(p->'leaders') <> 'object' then raise exception 'Invalid TL/OM/GM data'; end if;
  if p ? 'holidays' and jsonb_typeof(p->'holidays') <> 'array' then raise exception 'Invalid holidays'; end if;
  update config set
    campaigns      = case when p ? 'campaigns' then p->'campaigns' else campaigns end,
    leaders        = case when p ? 'leaders' then p->'leaders' else leaders end,
    kpi            = case when p ? 'kpi' then p->'kpi' else kpi end,
    current_period = case when p ? 'current_period' then nullif(p->>'current_period', '') else current_period end,
    as_of          = case when p ? 'as_of' then nullif(p->>'as_of', '')::date else as_of end,
    holidays       = case when p ? 'holidays' then p->'holidays' else holidays end
  where id = 1;
exception when check_violation or invalid_datetime_format or datetime_field_overflow then
  raise exception 'Invalid month or date (month must look like 2026-10, dates like 2026-10-05)';
end $$;

-- ========================== DATA MENU (Admin only) ==========================
create or replace function public.admin_delete_all() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the Admin can delete all data'; end if;
  perform _take_snapshot('Delete all data');
  delete from entries where true;
  delete from collectors where true;
end $$;

create or replace function public.admin_undo_last() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m snapshots; d jsonb;
begin
  if not is_admin() then raise exception 'Only the Admin can undo'; end if;
  select * into m from snapshots where id = 1;
  if not found then raise exception 'Nothing to undo'; end if;
  select data into d from snapshot_data where id = 1;
  if d is null then raise exception 'The undo copy is missing, so it cannot be restored'; end if;
  perform _restore_data(d);
  delete from snapshot_data where id = 1;
  delete from snapshots where id = 1;
  return jsonb_build_object('reason', m.reason, 'takenAt', m.taken_at, 'takenBy', m.taken_by);
end $$;

-- Excel import. p_meta (optional): {"period":"2026-10","as_of":"2026-10-05","holidays":[{"date":..,"name":..}],"leaders":{"tl":[],"om":[],"gm":[]}}
create or replace function public.admin_import_collectors(p_records jsonb, p_mode text, p_label text, p_meta jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare who text; v_leaders jsonb;
begin
  if not is_admin() then raise exception 'Only the Admin can import Excel files'; end if;
  if p_mode not in ('replace', 'merge') then raise exception 'Unknown import mode'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'Nothing to import: the file has no telecollector rows';
  end if;
  if jsonb_array_length(p_records) > 5000 then raise exception 'Too many rows (maximum 5000)'; end if;

  perform _take_snapshot(format('Excel import (%s): %s', case when p_mode = 'replace' then 'replace all' else 'update & add' end, left(coalesce(p_label, ''), 120)));
  select username into who from profiles where id = auth.uid();
  if p_mode = 'replace' then
    delete from entries where true;
    delete from collectors where true;
  end if;
  perform _upsert_collectors(p_records, who);

  v_leaders := case when jsonb_typeof(p_meta->'leaders') = 'object' then p_meta->'leaders' else null end;
  update config set
    leaders = coalesce(v_leaders, leaders),
    campaigns = case when p_mode = 'replace' then
        coalesce((select jsonb_agg(v order by v) from (
            select x->>'campaign' as v from jsonb_array_elements(p_records) x
            union
            select jsonb_array_elements_text(l->'campaigns') from jsonb_each(coalesce(v_leaders, config.leaders)) t(k, arr), jsonb_array_elements(t.arr) l
        ) s where v is not null and v <> ''), '[]'::jsonb)
      else campaigns || coalesce((select jsonb_agg(distinct x->>'campaign') from jsonb_array_elements(p_records) x
                                  where not (config.campaigns ? (x->>'campaign'))), '[]'::jsonb)
    end,
    current_period = coalesce(nullif(p_meta->>'period', ''), current_period),
    as_of          = coalesce(nullif(p_meta->>'as_of', '')::date, as_of),
    holidays       = case when jsonb_typeof(p_meta->'holidays') = 'array' and jsonb_array_length(p_meta->'holidays') > 0 then p_meta->'holidays' else holidays end,
    last_import_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  where id = 1;

  insert into baseline (id, data, label, saved_at)
  values (1, _current_data() || jsonb_build_object('entries', '[]'::jsonb), left(coalesce(p_label, ''), 120), floor(extract(epoch from clock_timestamp()) * 1000)::bigint)
  on conflict (id) do update set data = excluded.data, label = excluded.label, saved_at = excluded.saved_at;
exception
  when check_violation then raise exception 'Some rows have invalid values (check names, negative values, and To Retain vs Beginning)';
  when invalid_datetime_format or datetime_field_overflow then raise exception 'The AS OF DATE in the file is not a valid date';
end $$;

-- Goes back to the data exactly as it was right after the last Excel import (entries log cleared). Undo-able.
create or replace function public.admin_reset_to_baseline() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b baseline;
begin
  if not is_admin() then raise exception 'Only the Admin can reset the data'; end if;
  select * into b from baseline where id = 1;
  if not found then raise exception 'No Excel file has been imported yet, so there is nothing to reset to'; end if;
  perform _take_snapshot('Reset to last imported file');
  perform _restore_data(b.data);
  return jsonb_build_object('label', b.label, 'savedAt', b.saved_at);
end $$;

-- Closes the month: this month's actuals become "last month", actuals restart at zero, the month moves forward. Undo-able.
create or replace function public.admin_start_new_month() returns text
language plpgsql security definer set search_path = public as $$
declare v_period text; v_next text;
begin
  if not is_admin() then raise exception 'Only the Admin can start a new month'; end if;
  perform _take_snapshot('Start new month');
  select coalesce(current_period, to_char(now() at time zone 'Asia/Manila', 'YYYY-MM')) into v_period from config where id = 1;
  v_next := to_char(to_date(v_period || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
  update collectors set
    lm_collection = collection, lm_fixed_prov = fixed_prov, lm_repo = repo,
    lm_sp_collection = null, lm_sp_fixed_prov = null, lm_sp_repo = null,
    collection = 0, penalty = 0, fixed_prov = 0, fixed_accs = 0, repo = 0, repo_prov = 0, repo_age2 = 0, repo_age3 = 0, repo_age4 = 0, updated_at = now()
  where true;
  update config set current_period = v_next, as_of = null, last_import_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint where id = 1;
  return v_next;
end $$;

-- ========================== FORGOT PASSWORD ==========================
-- Anyone (also before logging in) may ask the Admin for a new password. The answer is the same whether or not the
-- username exists, one request per username is kept, and at most 100 are stored.
create or replace function public.request_password_reset(p_username text) returns void
language plpgsql security definer set search_path = public as $$
declare u text := lower(trim(coalesce(p_username, '')));
begin
  if u !~ '^[a-z0-9._-]{3,30}$' then return; end if;
  if not exists (select 1 from profiles where username = u) then return; end if;
  if (select count(*) from password_reset_requests) >= 100 then return; end if;
  insert into password_reset_requests (username) values (u)
  on conflict (username) do update set requested_at = now();
end $$;
grant execute on function public.request_password_reset(text) to anon, authenticated;

create or replace function public.admin_dismiss_reset_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the Admin can manage password requests'; end if;
  delete from password_reset_requests where id = p_id;
end $$;

-- ========================== ROW LEVEL SECURITY ==========================
alter table public.profiles      enable row level security;
alter table public.collectors    enable row level security;
alter table public.config        enable row level security;
alter table public.entries       enable row level security;
alter table public.snapshots     enable row level security;
alter table public.snapshot_data enable row level security;
alter table public.baseline      enable row level security;
alter table public.password_reset_requests enable row level security;

-- Read access only. There are deliberately NO insert/update/delete policies: all changes go through the functions above.
drop policy if exists profiles_select   on public.profiles;
drop policy if exists collectors_select on public.collectors;
drop policy if exists config_select     on public.config;
drop policy if exists entries_select    on public.entries;
drop policy if exists snapshots_select  on public.snapshots;
create policy profiles_select   on public.profiles   for select using (id = auth.uid() or is_admin());
create policy collectors_select on public.collectors for select using (is_active());
create policy config_select     on public.config     for select using (is_active());
create policy entries_select    on public.entries    for select using (is_editor());   -- Analysts cannot see the entries log
create policy snapshots_select  on public.snapshots  for select using (is_admin());    -- undo info: Admin only
drop policy if exists reset_requests_select on public.password_reset_requests;
create policy reset_requests_select on public.password_reset_requests for select using (is_admin());
-- snapshot_data and baseline: no policy at all -> never readable through the API

revoke insert, update, delete, truncate on public.profiles, public.collectors, public.config, public.entries,
       public.snapshots, public.snapshot_data, public.baseline, public.password_reset_requests from anon, authenticated;
revoke select on public.snapshot_data, public.baseline from anon, authenticated;

-- ========================== REALTIME (live updates on every PC) ==========================
do $$
begin
  begin alter publication supabase_realtime add table public.collectors; exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.config;     exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.entries;    exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.snapshots;  exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.profiles;   exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.password_reset_requests; exception when duplicate_object or undefined_object then null; end;
end $$;
