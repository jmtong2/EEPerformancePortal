-- =====================================================================
-- Eagle Eye Performance Portal v9: Supabase database setup / upgrade
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this -> Run.
--   · New project      : creates everything.
--   · Existing project : upgrades it in place to v9 and keeps your data.
-- Safe to run again at any time.
--
-- Roles (profiles.role):
--   Admin       - everything + users + TL / OM & AOM / GM + the Data menu (import/export, period & holidays, KPI, new month, delete/undo/reset)
--   Management  - add and edit telecollectors and daily entries (no Data menu, no TL / OM & AOM / GM changes)
--   Analyst     - view only
--
-- Storage: every value has its own column with a proper data type (amounts numeric, counts integer, dates date,
-- times timestamptz, lists text[]). JSON is only used to SEND a batch to a function in one call (an Excel import,
-- a settings save); it is never stored.
--   collectors, entries                          telecollectors (month-to-date) and the daily entries log
--   config (one row)                             month, "as of" date, KPI score cap, change counters
--   campaigns, leaders, kpi_settings, holidays   settings
--   snapshots, baseline                          what the undo copy and the last-import copy are (the Admin sees this)
--   backup.*                                     the undo copy and the last-import copy themselves: the same tables plus a
--                                                "kind" column ('undo' / 'baseline'); never reachable from browsers
--   profiles, password_reset_requests, sync_tombstones
-- Upgrading from v8 or older moves the settings and copies that were stored as JSON into these tables.
--
-- Security model: tables are READ-ONLY through the API (row-level security). Every change goes through
-- the functions below, which check the caller's role first and run as one transaction.
--
-- Keeping every PC up to date (efficient with large data): each change function bumps config.data_rev (bulk ones such as
-- an import, undo or new month also bump full_rev; settings changes bump settings_rev). Realtime only sends the config row,
-- so a change costs one small message per PC instead of one per row; each PC then downloads only the rows changed since
-- its last sync (updated_at, indexed) plus sync_tombstones (deleted rows). See js/backends/supabase-backend.js.
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
  updated_by       text
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
alter table public.collectors add column if not exists ending         numeric(16,2) not null default 0;   -- may be negative (see below)
alter table public.collectors add column if not exists ending_accs    integer not null default 0 check (ending_accs >= 0);
alter table public.collectors add column if not exists beginning_accs integer not null default 0 check (beginning_accs >= 0);
alter table public.collectors add column if not exists to_retain_accs integer not null default 0 check (to_retain_accs >= 0);
alter table public.collectors add column if not exists fixed_accs     integer not null default 0 check (fixed_accs >= 0);
alter table public.collectors add column if not exists repo_age2      numeric(12,2) not null default 0 check (repo_age2 >= 0);
alter table public.collectors add column if not exists repo_age3      numeric(12,2) not null default 0 check (repo_age3 >= 0);
alter table public.collectors add column if not exists repo_age4      numeric(12,2) not null default 0 check (repo_age4 >= 0);
alter table public.collectors alter column to_retain drop default;
-- Allowed, but the Excel import lists these rows and the Admin verifies them before importing. Older databases had rules
-- against both: To Retain may be more than Beginning (each provision figure has its own # of accounts), and Ending may be
-- negative. (The Ending rule was an unnamed "check (ending >= 0)", so it is found by its definition.)
alter table public.collectors drop constraint if exists to_retain_not_above_beginning;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.collectors'::regclass and contype = 'c' and pg_get_constraintdef(oid) like 'CHECK ((ending >= %'
  loop
    execute format('alter table public.collectors drop constraint %I', c.conname);
  end loop;
end $$;

-- One row: the month, the data "as of" date and the change counters. (Before v9 it also held the settings as JSON.)
create table if not exists public.config (
  id             integer primary key default 1 check (id = 1),
  last_import_at bigint not null default 0
);
alter table public.config add column if not exists current_period text check (current_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
alter table public.config add column if not exists as_of          date;
alter table public.config add column if not exists schema_version integer not null default 0;
alter table public.config add column if not exists kpi_cap        numeric(5,1) check (kpi_cap between 100 and 200);   -- KPI score cap per metric; blank = standard (120)
-- v9 change counters (see the top of this file)
alter table public.config add column if not exists data_rev     bigint not null default 0;
alter table public.config add column if not exists full_rev     bigint not null default 0;
alter table public.config add column if not exists settings_rev bigint not null default 0;
alter table public.config add column if not exists full_at      timestamptz;   -- when the last bulk change ran: every row it wrote has exactly this updated_at
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
alter table public.entries add column if not exists updated_at timestamptz not null default now();   -- v9: changes when a rename moves the entry
create index if not exists entries_ts_idx  on public.entries (ts desc);
create index if not exists entries_key_idx on public.entries (key);
-- v9: "what changed since my last sync" lookups
create index if not exists entries_updated_at_idx    on public.entries (updated_at);
create index if not exists collectors_updated_at_idx on public.collectors (updated_at);

-- ---------- settings (v9: one typed table each) ----------
create table if not exists public.campaigns (
  name text primary key check (name ~ '^[A-ZÑ0-9 .,''-]{1,60}$')
);
-- TL / OM & AOM / GM and the campaigns each one handles (in the order shown).
create table if not exists public.leaders (
  role       text not null check (role in ('tl', 'om', 'gm')),
  name       text not null check (name ~ '^[A-ZÑ .,''-]{1,80}$'),
  sort_order integer not null default 0,
  campaigns  text[] not null check (cardinality(campaigns) between 1 and 100),
  primary key (role, name)
);
-- KPI Rate targets (%) and weights per bucket.
create table if not exists public.kpi_settings (
  bucket            text primary key check (bucket in ('curing', 'recovery')),
  collection_target numeric(5,2) not null check (collection_target > 0 and collection_target <= 100),
  collection_weight numeric(5,2) not null check (collection_weight between 0 and 100),
  penalty_target    numeric(5,2) not null check (penalty_target > 0 and penalty_target <= 100),
  penalty_weight    numeric(5,2) not null check (penalty_weight between 0 and 100),
  provision_target  numeric(5,2) not null check (provision_target > 0 and provision_target <= 100),
  provision_weight  numeric(5,2) not null check (provision_weight between 0 and 100),
  repo_target       numeric(5,2) not null check (repo_target > 0 and repo_target <= 100),
  repo_weight       numeric(5,2) not null check (repo_weight between 0 and 100)
);
-- Holidays and non-working days (they are left out of the business days behind ON TRACK).
create table if not exists public.holidays (
  date date primary key,
  name text not null default '' check (char_length(name) <= 60)
);

-- v9: rows deleted one at a time (a telecollector, a renamed telecollector's old key, an undone entry), so other PCs can
-- remove them without reloading everything. Emptied by every bulk change, after which every PC reloads anyway.
create table if not exists public.sync_tombstones (
  tbl        text not null check (tbl in ('collectors', 'entries')),
  row_key    text not null,
  deleted_at timestamptz not null default now()
);
create index if not exists sync_tombstones_deleted_at_idx on public.sync_tombstones (deleted_at);

-- What the undo copy is (taken before delete-all / reset / import / new month). Readable by the Admin; the copy itself is in backup.*.
create table if not exists public.snapshots (
  id       integer primary key default 1 check (id = 1),
  reason   text not null,
  taken_at bigint not null,
  taken_by text
);
alter table public.snapshots add column if not exists collectors_count integer not null default 0;
alter table public.snapshots add column if not exists entries_count    integer not null default 0;
-- What the last-import copy is ("Reset to last imported file"). Never sent to browsers; the copy itself is in backup.*.
create table if not exists public.baseline (
  id       integer primary key default 1 check (id = 1),
  label    text,
  saved_at bigint not null
);

-- "Forgot password?" requests from the login screen (the Admin sees them under Users). Readable by Admins only.
create table if not exists public.password_reset_requests (
  id           uuid primary key default gen_random_uuid(),
  username     text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  requested_at timestamptz not null default now()
);

-- ---------- backup schema: the undo copy ('undo') and the last-import copy ('baseline') ----------
-- Same columns and data types as the live tables, plus "kind". Not reachable from browsers (see the security section).
create schema if not exists backup;
create table if not exists backup.collectors   (kind text not null check (kind in ('undo', 'baseline')), like public.collectors including defaults, primary key (kind, key));
create table if not exists backup.entries      (kind text not null check (kind in ('undo', 'baseline')), like public.entries including defaults, primary key (kind, id));
create table if not exists backup.campaigns    (kind text not null check (kind in ('undo', 'baseline')), like public.campaigns, primary key (kind, name));
create table if not exists backup.leaders      (kind text not null check (kind in ('undo', 'baseline')), like public.leaders including defaults, primary key (kind, role, name));
create table if not exists backup.kpi_settings (kind text not null check (kind in ('undo', 'baseline')), like public.kpi_settings, primary key (kind, bucket));
create table if not exists backup.holidays     (kind text not null check (kind in ('undo', 'baseline')), like public.holidays including defaults, primary key (kind, date));
create table if not exists backup.config (
  kind           text primary key check (kind in ('undo', 'baseline')),
  last_import_at bigint not null default 0,
  current_period text,
  as_of          date,
  kpi_cap        numeric(5,1)
);
-- Columns added to a live table in a later version are added to its backup table too.
do $$
declare t text; c record;
begin
  foreach t in array array['collectors', 'entries', 'campaigns', 'leaders', 'kpi_settings', 'holidays'] loop
    for c in
      select a.attname, format_type(a.atttypid, a.atttypmod) as typ
        from pg_attribute a
       where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
         and not exists (select 1 from pg_attribute b where b.attrelid = format('backup.%I', t)::regclass and b.attname = a.attname and not b.attisdropped)
       order by a.attnum
    loop
      execute format('alter table backup.%I add column %I %s', t, c.attname, c.typ);
    end loop;
  end loop;
end $$;

-- ========================== INTERNAL HELPERS (not callable from browsers) ==========================
-- Column list of a live table in table order, used to copy rows to and from its backup table (so columns added in later
-- versions are included automatically). p_fill: a blank value in a column that must have one gets the column's default.
create or replace function public._col_list(p_table text, p_skip text[] default '{}', p_fill boolean default false, p_src text default null)
returns text language sql stable set search_path = public as $$
  select string_agg(
           case when p_fill and a.attnotnull and d.adbin is not null
                then format('coalesce(%s%I, %s)', coalesce(p_src || '.', ''), a.attname, pg_get_expr(d.adbin, d.adrelid))
                else format('%s%I', coalesce(p_src || '.', ''), a.attname) end,
           ', ' order by a.attnum)
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = format('public.%I', p_table)::regclass and a.attnum > 0 and not a.attisdropped
     and not (a.attname::text = any (p_skip));
$$;

-- A date from text, or null when it is not a valid YYYY-MM-DD date.
create or replace function public._try_date(t text) returns date
language plpgsql stable as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return t::date;
exception when others then return null;
end $$;

-- The JSON the portal sends (and that older versions stored) -> typed rows. Anything invalid is left out.
create or replace function public._campaigns_from_json(p jsonb) returns setof text
language sql immutable as $$
  select distinct c from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) as c
   where c ~ '^[A-ZÑ0-9 .,''-]{1,60}$';
$$;
-- {"tl":[{"name":..,"campaigns":[..]}],"om":[..],"gm":[..]}
create or replace function public._leaders_from_json(p jsonb)
returns table (role text, name text, sort_order integer, campaigns text[])
language sql immutable as $$
  select r.k, x.l->>'name', x.n::integer,
         array(select c from jsonb_array_elements_text(x.l->'campaigns') with ordinality as y(c, o)
                where c ~ '^[A-ZÑ0-9 .,''-]{1,60}$' group by c order by min(o))
    from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) as r(k, v)
   cross join lateral jsonb_array_elements(case when jsonb_typeof(r.v) = 'array' then r.v else '[]'::jsonb end) with ordinality as x(l, n)
   where r.k in ('tl', 'om', 'gm') and jsonb_typeof(x.l) = 'object' and (x.l->>'name') ~ '^[A-ZÑ .,''-]{1,80}$'
     and jsonb_typeof(x.l->'campaigns') = 'array'
     and exists (select 1 from jsonb_array_elements_text(x.l->'campaigns') as z(c) where z.c ~ '^[A-ZÑ0-9 .,''-]{1,60}$');
$$;
-- [{"date":"2026-12-25","name":".."}]
create or replace function public._holidays_from_json(p jsonb)
returns table (date date, name text)
language sql stable set search_path = public as $$
  select distinct on (x.d) x.d, left(coalesce(h->>'name', ''), 60)
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) as h
   cross join lateral (select _try_date(h->>'date') as d) as x
   where x.d is not null
   order by x.d;
$$;
-- A KPI target (0 < x <= 100) or weight (0 <= x <= 100); missing or invalid -> the standard value.
create or replace function public._kpi_num(p jsonb, p_path text[], p_default numeric, p_target boolean) returns numeric
language plpgsql immutable as $$
declare v numeric;
begin
  begin v := (p #>> p_path)::numeric; exception when others then return p_default; end;
  if v is null or (p_target and not (v > 0 and v <= 100)) or (not p_target and not (v >= 0 and v <= 100)) then return p_default; end if;
  return round(v, 2);
end $$;
-- {"cap":120,"curing":{"weights":{..},"targets":{..}},"recovery":{..}} -> one row per bucket.
-- The standard targets and weights (the same as DEFAULT_KPI in js/data/defaults.js) fill in anything missing.
create or replace function public._kpi_from_json(p jsonb)
returns table (bucket text, collection_target numeric, collection_weight numeric, penalty_target numeric, penalty_weight numeric,
               provision_target numeric, provision_weight numeric, repo_target numeric, repo_weight numeric)
language sql immutable set search_path = public as $$
  select d.b,
         _kpi_num(p, array[d.b, 'targets', 'collection'], d.ct, true), _kpi_num(p, array[d.b, 'weights', 'collection'], d.cw, false),
         _kpi_num(p, array[d.b, 'targets', 'penalty'],    d.pt, true), _kpi_num(p, array[d.b, 'weights', 'penalty'],    d.pw, false),
         _kpi_num(p, array[d.b, 'targets', 'provision'],  d.vt, true), _kpi_num(p, array[d.b, 'weights', 'provision'],  d.vw, false),
         _kpi_num(p, array[d.b, 'targets', 'repo'],       d.rt, true), _kpi_num(p, array[d.b, 'weights', 'repo'],       d.rw, false)
    from (values ('curing', 40, 35, 10, 30, 55, 25, 2, 10), ('recovery', 40, 30, 6, 25, 70, 35, 2, 10)) as d(b, ct, cw, pt, pw, vt, vw, rt, rw);
$$;
create or replace function public._kpi_cap(p jsonb) returns numeric
language plpgsql immutable as $$
declare v numeric;
begin
  begin v := (p->>'cap')::numeric; exception when others then return null; end;
  return case when v between 100 and 200 then round(v, 1) end;
end $$;

-- Replace one kind of setting (from the JSON the portal sends). Unlike the upgrade, which skips anything unreadable,
-- a save is refused as a whole when any leader or campaign name is not valid (nothing is dropped silently).
create or replace function public._set_leaders(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Invalid TL/OM/GM data'; end if;
  if exists (select 1 from jsonb_each(p) as r(k, v)
              cross join lateral jsonb_array_elements(case when jsonb_typeof(r.v) = 'array' then r.v else '[]'::jsonb end) as x(l)
             where r.k in ('tl', 'om', 'gm')
               and (coalesce(x.l->>'name', '') !~ '^[A-ZÑ .,''-]{1,80}$'
                    or jsonb_typeof(x.l->'campaigns') is distinct from 'array' or jsonb_array_length(x.l->'campaigns') = 0
                    or exists (select 1 from jsonb_array_elements_text(x.l->'campaigns') as c where c !~ '^[A-ZÑ0-9 .,''-]{1,60}$'))) then
    raise exception using errcode = 'check_violation', message = 'Invalid TL/OM/GM data: each needs a name (letters only) and at least one valid campaign';
  end if;
  delete from leaders where true;
  insert into leaders (role, name, sort_order, campaigns) select * from _leaders_from_json(p) on conflict (role, name) do nothing;
  insert into campaigns (name) select distinct c from leaders, unnest(campaigns) as c on conflict (name) do nothing;
end $$;
create or replace function public._set_holidays(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'Invalid holidays'; end if;
  delete from holidays where true;
  insert into holidays (date, name) select * from _holidays_from_json(p);
end $$;
create or replace function public._set_kpi(p jsonb) returns void   -- null = the standard targets and weights
language plpgsql security definer set search_path = public as $$
begin
  delete from kpi_settings where true;
  insert into kpi_settings (bucket, collection_target, collection_weight, penalty_target, penalty_weight, provision_target, provision_weight, repo_target, repo_weight)
  select * from _kpi_from_json(p);
  update config set kpi_cap = _kpi_cap(p) where id = 1;
end $$;

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

-- ---------- the undo copy and the last-import copy (backup.*) ----------
create or replace function public._drop_copy(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  foreach t in array array['collectors', 'entries', 'campaigns', 'leaders', 'kpi_settings', 'holidays', 'config'] loop
    execute format('delete from backup.%I where kind = $1', t) using p_kind;
  end loop;
end $$;
-- Saves the live data as a copy of this kind (replacing the previous one). The last-import copy has no entries.
create or replace function public._save_copy(p_kind text, p_entries boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare t text; cols text;
begin
  perform _drop_copy(p_kind);
  foreach t in array array['collectors', 'entries', 'campaigns', 'leaders', 'kpi_settings', 'holidays'] loop
    continue when t = 'entries' and not p_entries;
    cols := _col_list(t);
    execute format('insert into backup.%I (kind, %s) select $1, %s from public.%I', t, cols, cols, t) using p_kind;
  end loop;
  insert into backup.config (kind, last_import_at, current_period, as_of, kpi_cap)
  select p_kind, last_import_at, current_period, as_of, kpi_cap from config where id = 1;
end $$;
-- Replaces ALL telecollectors, entries and settings with a copy. Restored rows count as changed now (updated_at).
create or replace function public._restore_copy(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  delete from entries where true;
  delete from collectors where true;
  delete from leaders where true;
  delete from campaigns where true;
  delete from kpi_settings where true;
  delete from holidays where true;
  foreach t in array array['collectors', 'entries', 'campaigns', 'leaders', 'kpi_settings', 'holidays'] loop
    execute format('insert into public.%I (%s) select %s from backup.%I b where b.kind = $1',
                   t, _col_list(t, array['updated_at']), _col_list(t, array['updated_at'], true, 'b'), t) using p_kind;
  end loop;
  insert into kpi_settings (bucket, collection_target, collection_weight, penalty_target, penalty_weight, provision_target, provision_weight, repo_target, repo_weight)
  select * from _kpi_from_json(null) on conflict (bucket) do nothing;   -- a copy without KPI rows -> the standard ones
  update config c set last_import_at = b.last_import_at, current_period = b.current_period, as_of = b.as_of, kpi_cap = b.kpi_cap
    from backup.config b where c.id = 1 and b.kind = p_kind;
end $$;
-- Upgrade only: a copy that older versions stored as one JSON value -> the backup tables.
create or replace function public._copy_from_json(p_kind text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t text; cfg jsonb := case when jsonb_typeof(p->'config') = 'object' then p->'config' else '{}'::jsonb end;
begin
  perform _drop_copy(p_kind);
  foreach t in array array['collectors', 'entries'] loop
    execute format('insert into backup.%I (kind, %s) select $1, %s from jsonb_populate_recordset(null::public.%I, $2) r',
                   t, _col_list(t), _col_list(t, '{}', true, 'r'), t)
      using p_kind, case when jsonb_typeof(p->t) = 'array' then p->t else '[]'::jsonb end;
  end loop;
  insert into backup.campaigns (kind, name) select p_kind, c from _campaigns_from_json(cfg->'campaigns') as c;
  insert into backup.leaders (kind, role, name, sort_order, campaigns) select p_kind, l.* from _leaders_from_json(cfg->'leaders') as l on conflict do nothing;
  insert into backup.campaigns (kind, name) select distinct p_kind, c from backup.leaders, unnest(campaigns) as c where kind = p_kind on conflict do nothing;
  insert into backup.kpi_settings (kind, bucket, collection_target, collection_weight, penalty_target, penalty_weight, provision_target, provision_weight, repo_target, repo_weight)
  select p_kind, k.* from _kpi_from_json(cfg->'kpi') as k;
  if jsonb_typeof(cfg->'holidays') = 'array' then
    insert into backup.holidays (kind, date, name) select p_kind, h.date, h.name from _holidays_from_json(cfg->'holidays') as h;
  else   -- a copy from before holidays existed keeps the current ones when it is restored
    insert into backup.holidays (kind, date, name) select p_kind, h.date, h.name from holidays as h;
  end if;
  insert into backup.config (kind, last_import_at, current_period, as_of, kpi_cap)
  values (p_kind, coalesce(case when (cfg->>'last_import_at') ~ '^\d+$' then (cfg->>'last_import_at')::bigint end, 0),
          case when (cfg->>'current_period') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then cfg->>'current_period' end,
          _try_date(cfg->>'as_of'), _kpi_cap(cfg->'kpi'));
end $$;

-- Tells the other PCs that data changed (see the top of this file). Called last in every change function, so the
-- config change follows the row changes. p_full = bulk change: every PC reloads everything (settings included), so the
-- list of deleted rows is no longer needed and is emptied. full_at = now(), the time stamp of every row the bulk change
-- wrote, so the next change-only sync can skip exactly those rows. Single changes stamp rows with clock_timestamp() (the
-- moment of writing, after any wait for a lock), so a change made right after a bulk change is never mistaken for part of it.
create or replace function public._bump_rev(p_full boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_full then delete from sync_tombstones where true; end if;
  update config set data_rev = data_rev + 1, full_rev = full_rev + (case when p_full then 1 else 0 end),
         full_at = case when p_full then now() else full_at end
   where id = 1;
end $$;

-- Change functions run one at a time: each locks the config row first, so the time stamps the PCs sync by follow the
-- order the changes were saved in. Every change is quick, so nobody notices the wait.
create or replace function public._lock_writes() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from config where id = 1 for update;
end $$;

create or replace function public._take_snapshot(p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select display_name into who from profiles where id = auth.uid();
  perform _save_copy('undo');
  insert into snapshots (id, reason, taken_at, taken_by, collectors_count, entries_count)
  values (1, p_reason, floor(extract(epoch from clock_timestamp()) * 1000)::bigint, coalesce(who, ''),
          (select count(*) from collectors), (select count(*) from entries))
  on conflict (id) do update set reason = excluded.reason, taken_at = excluded.taken_at, taken_by = excluded.taken_by,
     collectors_count = excluded.collectors_count, entries_count = excluded.entries_count;
end $$;

-- Older helpers that worked on JSON copies.
drop function if exists public._current_data();
drop function if exists public._restore_data(jsonb);
drop function if exists public._v9_leaders(jsonb);

-- ========================== UPGRADE: SETTINGS AND COPIES OUT OF JSON (v9) ==========================
-- Before v9 the settings were JSON columns of the config row, and the undo copy / last-import copy were one big JSON
-- value each. Their contents move into the typed tables above; then those JSON columns and the snapshot_data table are
-- dropped. A copy that cannot be read is skipped (with a notice) instead of stopping the upgrade.
do $$
declare v_cfg jsonb; v_copy jsonb;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'config' and column_name = 'leaders') then
    select to_jsonb(c) into v_cfg from public.config c where c.id = 1;
    insert into public.campaigns (name) select c from public._campaigns_from_json(v_cfg->'campaigns') as c on conflict do nothing;
    insert into public.leaders (role, name, sort_order, campaigns) select * from public._leaders_from_json(v_cfg->'leaders') on conflict do nothing;
    insert into public.campaigns (name) select distinct c from public.leaders, unnest(campaigns) as c on conflict do nothing;
    delete from public.kpi_settings where true;
    insert into public.kpi_settings (bucket, collection_target, collection_weight, penalty_target, penalty_weight, provision_target, provision_weight, repo_target, repo_weight)
    select * from public._kpi_from_json(v_cfg->'kpi');
    update public.config set kpi_cap = public._kpi_cap(v_cfg->'kpi') where id = 1;
    insert into public.holidays (date, name) select * from public._holidays_from_json(v_cfg->'holidays') on conflict do nothing;
    alter table public.config drop column if exists campaigns, drop column if exists leaders, drop column if exists kpi, drop column if exists holidays;
  end if;

  if to_regclass('public.snapshot_data') is not null then
    begin
      select data into v_copy from public.snapshot_data where id = 1;
      if v_copy is not null then perform public._copy_from_json('undo', v_copy); end if;
    exception when others then raise notice 'The old undo copy could not be moved and was left out: %', sqlerrm;
    end;
    drop table public.snapshot_data;
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'baseline' and column_name = 'data') then
    begin
      select data into v_copy from public.baseline where id = 1;
      if v_copy is not null then perform public._copy_from_json('baseline', v_copy); end if;
    exception when others then raise notice 'The old last-import copy could not be moved and was left out: %', sqlerrm;
    end;
    alter table public.baseline drop column data;
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'snapshots' and column_name = 'counts') then
    update public.snapshots set
      collectors_count = coalesce(case when (counts->>'collectors') ~ '^\d+$' then (counts->>'collectors')::integer end, 0),
      entries_count    = coalesce(case when (counts->>'entries') ~ '^\d+$' then (counts->>'entries')::integer end, 0)
     where counts is not null;
    alter table public.snapshots drop column counts;
  end if;
end $$;

-- ========================== ONE-TIME v7 UPGRADE ==========================
-- Clears To Retain (it will come from the new source) and seeds the 2026 Philippine holidays once.
do $$
begin
  if coalesce((select schema_version from public.config where id = 1), 0) < 7 then
    update public.collectors set to_retain = null where true;
    if not exists (select 1 from public.holidays) then
      insert into public.holidays (date, name) select * from public._holidays_from_json('[
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
      ]'::jsonb);
    end if;
    update public.config set schema_version = 7 where id = 1;
  end if;
end $$;

-- ========================== ONE-TIME v8 UPGRADE ==========================
-- KPI Rate back to the standard targets and weights (Collection 40%/35 & 40%/30, Penalty 10%/30 & 6%/25,
-- Provision 55%/25 & 70%/35, Repo 2%/10 & 2%/10 for Curing & Recovery).
do $$
begin
  if coalesce((select schema_version from public.config where id = 1), 0) < 8 then
    perform public._set_kpi(null);
    update public.config set schema_version = 8 where id = 1;
  end if;
end $$;
-- Both buckets always have KPI rows (the standard ones unless the Admin changed them).
insert into public.kpi_settings (bucket, collection_target, collection_weight, penalty_target, penalty_weight, provision_target, provision_weight, repo_target, repo_weight)
select * from public._kpi_from_json(null) on conflict (bucket) do nothing;

-- ========================== ONE-TIME v9 UPGRADE ==========================
-- The standard TL, OM & AOM and GM lists (the same as DEFAULT_LEADERS in js/data/defaults.js; CEPAT has no TL). After this
-- the Admin changes them in the portal (TL, OM & AOM and GM tabs). A campaign that is named differently in the data
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

do $$
begin
  if coalesce((select schema_version from public.config where id = 1), 0) < 9 then
    delete from public.leaders where true;
    insert into public.leaders (role, name, sort_order, campaigns)
    select l.role, l.name, l.sort_order, array(select public._v9_campaign(c) from unnest(l.campaigns) with ordinality as u(c, o) order by o)
      from public._leaders_from_json('{
        "tl": [
          {"name":"RICHMOND OLIVEROS","campaigns":["ASIALINK"]},
          {"name":"JOSE ANGELO MANARPIIS","campaigns":["SURECYCLE","SOUTH ASIALINK","WISEFUND"]},
          {"name":"JOHN LESTER MAMARIL","campaigns":["GLOBAL DOMINION","GLOBAL CEBUANA"]}
        ],
        "om": [
          {"name":"JAYME ANN PIL","campaigns":["ASIALINK"]},
          {"name":"ROXELL VISTAL","campaigns":["ASIALINK"]},
          {"name":"NICHOLE DELA CRUZ","campaigns":["SOUTH ASIALINK","WISEFUND","SURECYCLE"]},
          {"name":"MARHENIEL GADO","campaigns":["SOUTH ASIALINK","WISEFUND","SURECYCLE"]},
          {"name":"CECILE MARIE SOLANOY","campaigns":["GLOBAL DOMINION","GLOBAL CEBUANA"]},
          {"name":"ELOISA JANE BALLESTEROS","campaigns":["CEPAT"]}
        ],
        "gm": [
          {"name":"ARNEL SALLOMAN","campaigns":["ASIALINK"]},
          {"name":"POP ANTHON PRADILLA","campaigns":["SURECYCLE","SOUTH ASIALINK","WISEFUND"]},
          {"name":"JAY-AR FIGUEROA","campaigns":["GLOBAL DOMINION","GLOBAL CEBUANA"]},
          {"name":"ROMMEL SARAOSOS","campaigns":["CEPAT"]}
        ]}'::jsonb) as l;
    insert into public.campaigns (name) select distinct c from public.leaders, unnest(campaigns) as c on conflict do nothing;
    delete from backup.leaders where true;
    insert into backup.leaders (kind, role, name, sort_order, campaigns)
    select k.kind, l.role, l.name, l.sort_order, l.campaigns from backup.config as k cross join public.leaders as l;
    update public.config set schema_version = 9 where id = 1;
  end if;
end $$;

-- ========================== SCHEMA 10 / 11 ==========================
-- 10: To Retain may be more than Beginning · 11: Ending may be negative (both old rules are dropped with the tables above).
-- This marks the database as up to date, which hides the Admin's "Update the database" notice in the portal.
update public.config set schema_version = 11 where id = 1 and schema_version < 11;

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
  perform _lock_writes();
  p_collection := coalesce(p_collection, 0); p_penalty := coalesce(p_penalty, 0); p_fixed_prov := coalesce(p_fixed_prov, 0);
  p_repo := coalesce(p_repo, 0); p_repo_prov := coalesce(p_repo_prov, 0);
  if p_collection < 0 or p_penalty < 0 or p_fixed_prov < 0 or p_repo < 0 or p_repo_prov < 0 then raise exception 'Amounts cannot be negative'; end if;
  if p_collection = 0 and p_penalty = 0 and p_fixed_prov = 0 and p_repo = 0 and p_repo_prov = 0 then raise exception 'Enter at least one amount'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Manila')::date then raise exception 'Date cannot be in the future'; end if;

  select * into c from collectors where key = p_key for update;
  if not found then raise exception 'Telecollector not found. Add them first via Add Tele Collector.'; end if;
  if c.accs1 > 0 and c.repo + p_repo > c.accs1 then raise exception 'Repo cannot exceed the number of accounts (%)', c.accs1; end if;

  update collectors set collection = collection + p_collection, penalty = penalty + p_penalty, fixed_prov = fixed_prov + p_fixed_prov,
         repo = repo + p_repo, repo_prov = repo_prov + p_repo_prov, updated_at = clock_timestamp(), updated_by = me.username
   where key = p_key;
  insert into entries (key, campaign, team, name, date, collection, penalty, fixed_prov, repo, repo_prov, by_uid, by_name, updated_at)
  values (c.key, c.campaign, c.team, c.name, p_date, p_collection, p_penalty, p_fixed_prov, p_repo, p_repo_prov, auth.uid(), me.display_name, clock_timestamp());
  -- One config change: moves the "as of" date forward and tells the other PCs (data_rev).
  update config set data_rev = data_rev + 1,
         as_of = case when current_period is null or current_period = to_char(p_date, 'YYYY-MM')
                      then greatest(coalesce(as_of, p_date), p_date) else as_of end
   where id = 1;
end $$;

-- Undo one entry (subtracts its amounts).
create or replace function public.delete_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e entries; v_import bigint;
begin
  if not is_editor() then raise exception 'Only Admin and Management can undo entries'; end if;
  perform _lock_writes();
  delete from entries where id = p_id returning * into e;
  if not found then return; end if;
  select last_import_at into v_import from config where id = 1;
  if coalesce(v_import, 0) > 0 and e.ts < to_timestamp(v_import::double precision / 1000) then
    raise exception 'This entry was made before the last Excel import or new month, so it cannot be undone';
  end if;
  update collectors set collection = collection - e.collection, penalty = penalty - e.penalty, beginning = beginning - e.beginning,
         to_retain = case when to_retain is null then null else to_retain - e.to_retain end,
         fixed_prov = fixed_prov - e.fixed_prov, repo = repo - e.repo, repo_prov = repo_prov - e.repo_prov, updated_at = clock_timestamp()
   where key = e.key;
  insert into sync_tombstones (tbl, row_key, deleted_at) values ('entries', e.id::text, clock_timestamp());
  perform _bump_rev(false);
exception when check_violation then
  raise exception 'Undoing this entry would make a figure negative. Check the telecollector first.';
end $$;

-- ========================== TELECOLLECTORS & SETTINGS ==========================
-- Add or edit a telecollector in one transaction (blocks duplicates, handles renames).
create or replace function public.save_collector(p_old_key text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text := p->>'key'; who text; v_new_campaign boolean;
begin
  if not is_editor() then raise exception 'Only Admin and Management can add or edit telecollectors'; end if;
  perform _lock_writes();
  if k is null or k = '' then raise exception 'Missing telecollector key'; end if;
  if (p_old_key is null or p_old_key <> k) and exists (select 1 from collectors where key = k) then raise exception 'DUPLICATE:%', k; end if;
  select username into who from profiles where id = auth.uid();
  if p_old_key is not null and p_old_key <> k then
    delete from collectors where key = p_old_key;
    insert into sync_tombstones (tbl, row_key, deleted_at) values ('collectors', p_old_key, clock_timestamp());
  end if;
  perform _upsert_collectors(jsonb_build_array(p), who);
  update collectors set updated_at = clock_timestamp() where key = k;
  if p_old_key is not null and p_old_key <> k then
    update entries set key = k, name = p->>'name', campaign = p->>'campaign', team = p->>'team', updated_at = clock_timestamp() where key = p_old_key;
  end if;
  insert into campaigns (name) values (p->>'campaign') on conflict (name) do nothing;
  v_new_campaign := found;
  -- One config change tells the other PCs (data_rev; settings_rev when the campaign is new).
  update config set data_rev = data_rev + 1, settings_rev = settings_rev + (case when v_new_campaign then 1 else 0 end) where id = 1;
exception when check_violation then
  raise exception 'Invalid telecollector data (a name with characters that are not allowed, or a negative figure other than Ending)';
end $$;

create or replace function public.delete_collector(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_editor() then raise exception 'Only Admin and Management can delete telecollectors'; end if;
  perform _lock_writes();
  delete from collectors where key = p_key;
  if found then
    insert into sync_tombstones (tbl, row_key, deleted_at) values ('collectors', p_key, clock_timestamp());
    perform _bump_rev(false);
  end if;
end $$;

-- TL / OM & AOM / GM, campaigns, KPI settings, month, "as of" date and holidays: Admin only (v9).
-- p (only the parts being changed): {"campaigns":[..],"leaders":{"tl":[..],..},"kpi":{..} or null,"holidays":[..],"current_period":"2026-10","as_of":".."}
create or replace function public.save_config(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the Admin can change TL / OM & AOM / GM, KPI settings, the month and holidays'; end if;
  perform _lock_writes();
  if p ? 'campaigns' then
    if jsonb_typeof(p->'campaigns') <> 'array' then raise exception 'Invalid campaigns'; end if;
    insert into campaigns (name) select distinct c from jsonb_array_elements_text(p->'campaigns') as c where c <> '' on conflict (name) do nothing;
  end if;
  if p ? 'leaders'  then perform _set_leaders(p->'leaders'); end if;
  if p ? 'kpi'      then perform _set_kpi(p->'kpi'); end if;
  if p ? 'holidays' then perform _set_holidays(p->'holidays'); end if;
  update config set
    current_period = case when p ? 'current_period' then nullif(p->>'current_period', '') else current_period end,
    as_of          = case when p ? 'as_of' then nullif(p->>'as_of', '')::date else as_of end,
    settings_rev   = settings_rev + 1
  where id = 1;
exception
  when check_violation then raise exception 'Invalid settings: check the campaign and TL / OM & AOM / GM names, and that the month looks like 2026-10';
  when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid month or date (month must look like 2026-10, dates like 2026-10-05)';
end $$;

-- ========================== DATA MENU (Admin only) ==========================
create or replace function public.admin_delete_all() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the Admin can delete all data'; end if;
  perform _lock_writes();
  perform _take_snapshot('Delete all data');
  delete from entries where true;
  delete from collectors where true;
  perform _bump_rev(true);
end $$;

create or replace function public.admin_undo_last() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m snapshots;
begin
  if not is_admin() then raise exception 'Only the Admin can undo'; end if;
  perform _lock_writes();
  select * into m from snapshots where id = 1;
  if not found then raise exception 'Nothing to undo'; end if;
  if not exists (select 1 from backup.config where kind = 'undo') then raise exception 'The undo copy is missing, so it cannot be restored'; end if;
  perform _restore_copy('undo');
  perform _drop_copy('undo');
  delete from snapshots where id = 1;
  perform _bump_rev(true);
  return jsonb_build_object('reason', m.reason, 'takenAt', m.taken_at, 'takenBy', m.taken_by);
end $$;

-- Excel import. p_records: the telecollector rows. p_meta (optional): {"period":"2026-10","as_of":"2026-10-05",
-- "holidays":[{"date":..,"name":..}],"leaders":{"tl":[],"om":[],"gm":[]}}. Both are only the way the file is sent; every
-- value is stored in its own typed column.
create or replace function public.admin_import_collectors(p_records jsonb, p_mode text, p_label text, p_meta jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if not is_admin() then raise exception 'Only the Admin can import Excel files'; end if;
  if p_mode not in ('replace', 'merge') then raise exception 'Unknown import mode'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'Nothing to import: the file has no telecollector rows';
  end if;
  if jsonb_array_length(p_records) > 5000 then raise exception 'Too many rows (maximum 5000)'; end if;
  perform _lock_writes();

  perform _take_snapshot(format('Excel import (%s): %s', case when p_mode = 'replace' then 'replace all' else 'update & add' end, left(coalesce(p_label, ''), 120)));
  select username into who from profiles where id = auth.uid();
  if p_mode = 'replace' then
    delete from entries where true;
    delete from collectors where true;
  end if;
  perform _upsert_collectors(p_records, who);

  if jsonb_typeof(p_meta->'leaders') = 'object' then perform _set_leaders(p_meta->'leaders'); end if;
  -- Campaigns: replace = the file's plus the ones the leaders handle; update & add = the current ones plus the file's.
  if p_mode = 'replace' then delete from campaigns where true; end if;
  insert into campaigns (name) select distinct x->>'campaign' from jsonb_array_elements(p_records) as x where coalesce(x->>'campaign', '') <> '' on conflict (name) do nothing;
  insert into campaigns (name) select distinct c from leaders, unnest(campaigns) as c on conflict (name) do nothing;
  if jsonb_typeof(p_meta->'holidays') = 'array' and jsonb_array_length(p_meta->'holidays') > 0 then perform _set_holidays(p_meta->'holidays'); end if;
  update config set
    current_period = coalesce(nullif(p_meta->>'period', ''), current_period),
    as_of          = coalesce(nullif(p_meta->>'as_of', '')::date, as_of),
    last_import_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  where id = 1;

  perform _save_copy('baseline', false);
  insert into baseline (id, label, saved_at) values (1, left(coalesce(p_label, ''), 120), floor(extract(epoch from clock_timestamp()) * 1000)::bigint)
  on conflict (id) do update set label = excluded.label, saved_at = excluded.saved_at;
  perform _bump_rev(true);
exception
  when check_violation then raise exception 'Some rows have invalid values (a name with characters that are not allowed, or a negative figure other than Ending)';
  when invalid_datetime_format or datetime_field_overflow then raise exception 'The AS OF DATE in the file is not a valid date';
end $$;

-- Goes back to the data exactly as it was right after the last Excel import (entries log cleared). Undo-able.
create or replace function public.admin_reset_to_baseline() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b baseline;
begin
  if not is_admin() then raise exception 'Only the Admin can reset the data'; end if;
  perform _lock_writes();
  select * into b from baseline where id = 1;
  if not found or not exists (select 1 from backup.config where kind = 'baseline') then
    raise exception 'No Excel file has been imported yet, so there is nothing to reset to';
  end if;
  perform _take_snapshot('Reset to last imported file');
  perform _restore_copy('baseline');
  perform _bump_rev(true);
  return jsonb_build_object('label', b.label, 'savedAt', b.saved_at);
end $$;

-- Closes the month: this month's actuals become "last month", actuals restart at zero, the month moves forward. Undo-able.
create or replace function public.admin_start_new_month() returns text
language plpgsql security definer set search_path = public as $$
declare v_period text; v_next text;
begin
  if not is_admin() then raise exception 'Only the Admin can start a new month'; end if;
  perform _lock_writes();
  perform _take_snapshot('Start new month');
  select coalesce(current_period, to_char(now() at time zone 'Asia/Manila', 'YYYY-MM')) into v_period from config where id = 1;
  v_next := to_char(to_date(v_period || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
  update collectors set
    lm_collection = collection, lm_fixed_prov = fixed_prov, lm_repo = repo,
    lm_sp_collection = null, lm_sp_fixed_prov = null, lm_sp_repo = null,
    collection = 0, penalty = 0, fixed_prov = 0, fixed_accs = 0, repo = 0, repo_prov = 0, repo_age2 = 0, repo_age3 = 0, repo_age4 = 0, updated_at = now()
  where true;
  update config set current_period = v_next, as_of = null, last_import_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint where id = 1;
  perform _bump_rev(true);
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

-- Internal helpers cannot be called from browsers (they run only inside the functions above).
revoke execute on function public._col_list(text, text[], boolean, text) from public, anon, authenticated;
revoke execute on function public._try_date(text) from public, anon, authenticated;
revoke execute on function public._campaigns_from_json(jsonb) from public, anon, authenticated;
revoke execute on function public._leaders_from_json(jsonb) from public, anon, authenticated;
revoke execute on function public._holidays_from_json(jsonb) from public, anon, authenticated;
revoke execute on function public._kpi_num(jsonb, text[], numeric, boolean) from public, anon, authenticated;
revoke execute on function public._kpi_from_json(jsonb) from public, anon, authenticated;
revoke execute on function public._kpi_cap(jsonb) from public, anon, authenticated;
revoke execute on function public._set_leaders(jsonb) from public, anon, authenticated;
revoke execute on function public._set_holidays(jsonb) from public, anon, authenticated;
revoke execute on function public._set_kpi(jsonb) from public, anon, authenticated;
revoke execute on function public._upsert_collectors(jsonb, text) from public, anon, authenticated;
revoke execute on function public._drop_copy(text) from public, anon, authenticated;
revoke execute on function public._save_copy(text, boolean) from public, anon, authenticated;
revoke execute on function public._restore_copy(text) from public, anon, authenticated;
revoke execute on function public._copy_from_json(text, jsonb) from public, anon, authenticated;
revoke execute on function public._bump_rev(boolean) from public, anon, authenticated;
revoke execute on function public._take_snapshot(text) from public, anon, authenticated;
revoke execute on function public._lock_writes() from public, anon, authenticated;
revoke execute on function public._v9_campaign(text) from public, anon, authenticated;

-- ========================== ROW LEVEL SECURITY ==========================
alter table public.profiles      enable row level security;
alter table public.collectors    enable row level security;
alter table public.config        enable row level security;
alter table public.entries       enable row level security;
alter table public.campaigns     enable row level security;
alter table public.leaders       enable row level security;
alter table public.kpi_settings  enable row level security;
alter table public.holidays      enable row level security;
alter table public.snapshots     enable row level security;
alter table public.baseline      enable row level security;
alter table public.password_reset_requests enable row level security;
alter table public.sync_tombstones enable row level security;

-- Read access only. There are deliberately NO insert/update/delete policies: all changes go through the functions above.
-- The role checks are wrapped in (select ...) so Postgres runs them once per query instead of once per row, which keeps
-- reads of large tables fast (Supabase's recommended pattern).
drop policy if exists profiles_select     on public.profiles;
drop policy if exists collectors_select   on public.collectors;
drop policy if exists config_select       on public.config;
drop policy if exists entries_select      on public.entries;
drop policy if exists campaigns_select    on public.campaigns;
drop policy if exists leaders_select      on public.leaders;
drop policy if exists kpi_settings_select on public.kpi_settings;
drop policy if exists holidays_select     on public.holidays;
drop policy if exists snapshots_select    on public.snapshots;
create policy profiles_select     on public.profiles     for select using (id = (select auth.uid()) or (select is_admin()));
create policy collectors_select   on public.collectors   for select using ((select is_active()));
create policy config_select       on public.config       for select using ((select is_active()));
create policy entries_select      on public.entries      for select using ((select is_editor()));   -- Analysts cannot see the entries log
create policy campaigns_select    on public.campaigns    for select using ((select is_active()));
create policy leaders_select      on public.leaders      for select using ((select is_active()));
create policy kpi_settings_select on public.kpi_settings for select using ((select is_active()));
create policy holidays_select     on public.holidays     for select using ((select is_active()));
create policy snapshots_select    on public.snapshots    for select using ((select is_admin()));    -- undo info: Admin only
drop policy if exists reset_requests_select on public.password_reset_requests;
create policy reset_requests_select on public.password_reset_requests for select using ((select is_admin()));
-- Deleted-row list: telecollector keys for every active user, entry ids only for Admin and Management (like the tables).
drop policy if exists sync_tombstones_select on public.sync_tombstones;
create policy sync_tombstones_select on public.sync_tombstones for select
  using ((select is_active()) and (tbl = 'collectors' or (select is_editor())));
-- baseline: no policy at all -> never readable through the API

revoke insert, update, delete, truncate on public.profiles, public.collectors, public.config, public.entries,
       public.campaigns, public.leaders, public.kpi_settings, public.holidays,
       public.snapshots, public.baseline, public.password_reset_requests, public.sync_tombstones from anon, authenticated;
revoke select on public.baseline from anon, authenticated;

-- backup.*: the API does not publish this schema, browsers get no rights on it, and row-level security (no policy)
-- would hide every row even if it were published by mistake.
revoke all on schema backup from public, anon, authenticated;
revoke all on all tables in schema backup from public, anon, authenticated;
alter table backup.collectors   enable row level security;
alter table backup.entries      enable row level security;
alter table backup.campaigns    enable row level security;
alter table backup.leaders      enable row level security;
alter table backup.kpi_settings enable row level security;
alter table backup.holidays     enable row level security;
alter table backup.config       enable row level security;

-- ========================== REALTIME (live updates on every PC) ==========================
-- Telecollector, entry and settings changes reach the other PCs through the config row (see the top of this file), so
-- those tables are not sent row by row: with many rows and users that is the slow, expensive part of Supabase Realtime.
do $$
begin
  begin alter publication supabase_realtime add table public.config;     exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.snapshots;  exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.profiles;   exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.password_reset_requests; exception when duplicate_object or undefined_object then null; end;
  -- Not being in the publication (or no publication at all) is fine here.
  begin alter publication supabase_realtime drop table public.collectors; exception when others then null; end;
  begin alter publication supabase_realtime drop table public.entries;    exception when others then null; end;
end $$;
