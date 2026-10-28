-- ==============================================================================
-- FIX CEPAT: Tabel bot_settings, packages, vouchers & Reload Schema Cache
-- Copy dan Paste seluruh script ini ke Supabase Dashboard -> SQL Editor -> Klik "Run"
-- ==============================================================================

-- 1. Tabel Bot Settings
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

-- 2. Tabel Packages
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

-- 3. Tabel Vouchers
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

-- 4. Kolom Tambahan User untuk Garansi
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

-- 5. Tabel Login Sesi Telegram Userbot
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

-- 6. Nonaktifkan RLS agar bot serverless tidak terhalang permission
alter table if exists public.packages disable row level security;
alter table if exists public.vouchers disable row level security;
alter table if exists public.bot_settings disable row level security;
alter table if exists public.gemini_checker_login_sessions disable row level security;

-- 7. Beri hak akses ke semua role (postgres, anon, authenticated, service_role)
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on table public.bot_settings to postgres, anon, authenticated, service_role;
grant all on table public.packages to postgres, anon, authenticated, service_role;
grant all on table public.vouchers to postgres, anon, authenticated, service_role;
grant all on table public.gemini_checker_users to postgres, anon, authenticated, service_role;
grant all on table public.gemini_checker_login_sessions to postgres, anon, authenticated, service_role;

-- 8. Muat ulang Schema Cache PostgREST
NOTIFY pgrst, 'reload schema';
