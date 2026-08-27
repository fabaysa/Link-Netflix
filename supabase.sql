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
  telegram_chat_id bigint not null,
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

grant usage on schema public to service_role;
grant select, insert, update, delete
  on public.gemini_checker_users,
     public.gemini_checker_jobs,
     public.gemini_checker_login_sessions
  to service_role;

revoke all on function public.claim_gemini_checker_job(text) from public;
grant execute on function public.claim_gemini_checker_job(text) to service_role;

NOTIFY pgrst, 'reload schema';
