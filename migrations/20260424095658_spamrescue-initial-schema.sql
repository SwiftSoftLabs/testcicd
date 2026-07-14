create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  phone_number text,
  sms_enabled boolean not null default false,
  subscription_tier text not null default 'starter' check (subscription_tier in ('starter', 'pro')),
  subscription_status text not null default 'inactive',
  subscription_end_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sensitivity integer not null default 50 check (sensitivity >= 0 and sensitivity <= 100),
  keywords text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  email_address text not null,
  refresh_token text,
  access_token text,
  last_scan_timestamp timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (user_id, email_address)
);

create table if not exists public.rescued_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  external_email_id text,
  sender_address text not null,
  subject text not null,
  snippet text,
  received_at timestamptz not null default now(),
  rescued_at timestamptz,
  ai_confidence numeric(5,4),
  ai_reasoning text,
  status text not null default 'pending' check (status in ('pending', 'confirmed_lead', 'false_positive')),
  estimated_value numeric(12,2),
  urgency text,
  suggested_reply text,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists rescued_emails_user_status_idx
  on public.rescued_emails (user_id, status, received_at desc);

alter table public.profiles enable row level security;

alter table public.user_settings enable row level security;

alter table public.connected_accounts enable row level security;

alter table public.rescued_emails enable row level security;

alter table public.contact_messages enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;

create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;

create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "settings_select_own" on public.user_settings;

create policy "settings_select_own"
on public.user_settings for select
using (auth.uid() = user_id);

drop policy if exists "settings_insert_own" on public.user_settings;

create policy "settings_insert_own"
on public.user_settings for insert
with check (auth.uid() = user_id);

drop policy if exists "settings_update_own" on public.user_settings;

create policy "settings_update_own"
on public.user_settings for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "accounts_select_own" on public.connected_accounts;

create policy "accounts_select_own"
on public.connected_accounts for select
using (auth.uid() = user_id);

drop policy if exists "accounts_insert_own" on public.connected_accounts;

create policy "accounts_insert_own"
on public.connected_accounts for insert
with check (auth.uid() = user_id);

drop policy if exists "accounts_update_own" on public.connected_accounts;

create policy "accounts_update_own"
on public.connected_accounts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "accounts_delete_own" on public.connected_accounts;

create policy "accounts_delete_own"
on public.connected_accounts for delete
using (auth.uid() = user_id);

drop policy if exists "emails_select_own" on public.rescued_emails;

create policy "emails_select_own"
on public.rescued_emails for select
using (auth.uid() = user_id);

drop policy if exists "emails_insert_own" on public.rescued_emails;

create policy "emails_insert_own"
on public.rescued_emails for insert
with check (auth.uid() = user_id);

drop policy if exists "emails_update_own" on public.rescued_emails;

create policy "emails_update_own"
on public.rescued_emails for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "emails_delete_own" on public.rescued_emails;

create policy "emails_delete_own"
on public.rescued_emails for delete
using (auth.uid() = user_id);

drop policy if exists "contact_insert_public" on public.contact_messages;

create policy "contact_insert_public"
on public.contact_messages for insert
with check (true);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
