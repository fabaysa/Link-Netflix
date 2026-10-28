create extension if not exists pgcrypto;

-- Existing bot users table; safe to run repeatedly.
create table if not exists public.gemini_checker_users (
  telegram_user_id bigint primary key,
  username text,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Queue used by v4 bridge.
create table if not exists public.gemini_checker_jobs (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint references public.gemini_checker_users(telegram_user_id)
    on delete set null,
  telegram_chat_id bigint,
  telegram_progress_message_id bigint,
  input_type text not null default 'text'
    check (input_type in ('text', 'txt')),
  input_payload text,
  link_count integer not null default 0,
  debug_mode boolean not null default false,

  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  worker_id text,
  locked_at timestamptz,
  last_error text,

  target_sent_message_id bigint,
  target_result_message_id bigint,
  result jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists gemini_checker_jobs_status_created_idx
  on public.gemini_checker_jobs(status, created_at);

create index if not exists gemini_checker_jobs_user_created_idx
  on public.gemini_checker_jobs(telegram_user_id, created_at desc);

-- Backward compatibility for web jobs: allow null telegram_chat_id
alter table if exists public.gemini_checker_jobs
  alter column telegram_chat_id drop not null;

-- Temporary, short-lived state used only to create TELEGRAM_USER_SESSION
-- through /setup-userbot.html. Successful sessions are deleted immediately.
create table if not exists public.gemini_checker_login_sessions (
  id uuid primary key,
  phone text not null,
  temp_session text not null,
  phone_code_hash text not null,
  is_code_via_app boolean not null default false,
  needs_2fa boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Only one GoChecker bridge job may be processing at a time.
-- Advisory transaction lock prevents two simultaneous Vercel invocations
-- from claiming different jobs at the same time.
create or replace function public.claim_gemini_checker_job(p_worker_id text)
returns setof public.gemini_checker_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(40420260820);

  -- Recover a worker that disappeared. Retry at most 3 times.
  update public.gemini_checker_jobs
     set status = case when attempts >= 3 then 'failed' else 'queued' end,
         worker_id = null,
         locked_at = null,
         last_error = case
           when attempts >= 3 then coalesce(last_error, '') || ' | stale worker exceeded retry limit'
           else coalesce(last_error, '') || ' | stale worker requeued'
         end,
         completed_at = case when attempts >= 3 then now() else null end,
         updated_at = now()
   where status = 'processing'
     and locked_at < now() - interval '5 minutes';

  -- Serialize access to the single Telegram checker account.
  if exists (
    select 1 from public.gemini_checker_jobs where status = 'processing'
  ) then
    return;
  end if;

  select id
    into v_id
    from public.gemini_checker_jobs
   where status = 'queued'
   order by created_at asc
   for update skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.gemini_checker_jobs
     set status = 'processing',
         attempts = attempts + 1,
         worker_id = p_worker_id,
         locked_at = now(),
         updated_at = now()
   where id = v_id
   returning *;
end;
$$;

alter table public.gemini_checker_users enable row level security;
alter table public.gemini_checker_jobs enable row level security;
alter table public.gemini_checker_login_sessions enable row level security;

-- Extension for user warranty and store features
alter table if exists public.gemini_checker_users
  add column if not exists credits numeric not null default 0,
  add column if not exists warranty_package_id text,
  add column if not exists warranty_package_name text,
  add column if not exists warranty_expires_at timestamptz,
  add column if not exists warranty_lifetime boolean not null default false,
  add column if not exists warranty_daily_limit int not null default 5,
  add column if not exists warranty_claims_today int not null default 0,
  add column if not exists warranty_last_claim_date date default current_date,
  add column if not exists is_banned boolean not null default false;

create index if not exists gemini_checker_users_warranty_idx
  on public.gemini_checker_users(warranty_expires_at desc, warranty_lifetime);

create index if not exists gemini_checker_users_username_idx
  on public.gemini_checker_users(username);

-- Packages table
create table if not exists public.packages (
  id text primary key,
  name text not null,
  duration_days int not null default 0,
  duration_hours int not null default 0,
  lifetime boolean not null default false,
  daily_limit int not null default 5,
  price numeric not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table if exists public.packages
  add column if not exists enabled boolean not null default true;

-- Seed default packages
insert into public.packages (id, name, duration_days, duration_hours, lifetime, daily_limit, price, enabled)
values
  ('1_hari', '1 Hari', 1, 0, false, 5, 5000, true),
  ('7_hari', '7 Hari', 7, 0, false, 5, 15000, true),
  ('30_hari', '1 Bulan (30 Hari)', 30, 0, false, 10, 35000, true),
  ('lifetime', 'Lifetime (Selamanya)', 0, 0, true, 20, 100000, true)
on conflict (id) do update set
  name = excluded.name,
  duration_days = excluded.duration_days,
  lifetime = excluded.lifetime,
  daily_limit = excluded.daily_limit,
  price = excluded.price,
  enabled = excluded.enabled;

-- Vouchers table for /redeem
create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code_hash text unique not null,
  raw_code text not null,
  package_id text references public.packages(id) on delete set null,
  custom_package_name text,
  custom_duration_days int,
  custom_duration_hours int,
  custom_lifetime boolean not null default false,
  custom_daily_limit int not null default 5,
  credits numeric not null default 0,
  is_redeemed boolean not null default false,
  redeemed_by bigint references public.gemini_checker_users(telegram_user_id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table if exists public.vouchers
  add column if not exists custom_package_name text,
  add column if not exists custom_duration_days int,
  add column if not exists custom_duration_hours int,
  add column if not exists custom_lifetime boolean not null default false,
  add column if not exists custom_daily_limit int not null default 5;

create index if not exists vouchers_code_hash_idx on public.vouchers(code_hash);
create index if not exists vouchers_redeemed_by_idx on public.vouchers(redeemed_by);

-- Bot global settings
create table if not exists public.bot_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.bot_settings (key, value)
values
  ('country_priority', '["ID", "MY", "SG"]'::jsonb),
  ('target_bot', '"SSNetflixBot"'::jsonb),
  ('target_bot_login', '"SSNetflixBot"'::jsonb),
  ('target_bot_cookie', '"cookiesnetflixskystorebot"'::jsonb),
  ('support_username', '"iLinkinStore"'::jsonb),
  ('require_warranty', 'true'::jsonb),
  ('daily_limit_default', '5'::jsonb),
  ('workflow_photos', '[]'::jsonb)
on conflict (key) do nothing;

-- Disable RLS for bot internal tables so that PostgREST schema cache exposes them cleanly
alter table if exists public.packages disable row level security;
alter table if exists public.vouchers disable row level security;
alter table if exists public.bot_settings disable row level security;

-- Grant full access to all roles so neither service_role nor anon causes PGRST205
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on table public.gemini_checker_users to postgres, anon, authenticated, service_role;
grant all on table public.gemini_checker_jobs to postgres, anon, authenticated, service_role;
grant all on table public.gemini_checker_login_sessions to postgres, anon, authenticated, service_role;
grant all on table public.packages to postgres, anon, authenticated, service_role;
grant all on table public.vouchers to postgres, anon, authenticated, service_role;
grant all on table public.bot_settings to postgres, anon, authenticated, service_role;

revoke all on function public.claim_gemini_checker_job(text) from public;
grant execute on function public.claim_gemini_checker_job(text) to service_role, postgres;

-- Force PostgREST to immediately refresh its schema cache
NOTIFY pgrst, 'reload schema';

