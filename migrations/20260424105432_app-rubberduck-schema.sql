create extension if not exists pgcrypto;

create table if not exists app_rubberduck.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  subscription_status text not null default 'free' check (subscription_status in ('active', 'trialing', 'past_due', 'canceled', 'free')),
  stripe_customer_id text unique,
  credits_used int not null default 0,
  last_reset_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_rubberduck.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_rubberduck.profiles(id) on delete cascade,
  title text not null default 'Untitled Project',
  description text,
  content jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_rubberduck.chat_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references app_rubberduck.projects(id) on delete set null,
  user_id uuid not null references app_rubberduck.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  message text not null,
  context_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function app_rubberduck.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = app_rubberduck
as $$
begin
  insert into app_rubberduck.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure app_rubberduck.handle_new_user();

create or replace function app_rubberduck.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on app_rubberduck.profiles;

create trigger set_profiles_updated_at
  before update on app_rubberduck.profiles
  for each row execute procedure app_rubberduck.handle_updated_at();

drop trigger if exists set_projects_updated_at on app_rubberduck.projects;

create trigger set_projects_updated_at
  before update on app_rubberduck.projects
  for each row execute procedure app_rubberduck.handle_updated_at();

create or replace function app_rubberduck.protect_profile_system_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.id then
    if new.subscription_status is distinct from old.subscription_status
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.credits_used is distinct from old.credits_used
       or new.last_reset_at is distinct from old.last_reset_at then
      raise exception 'Only backend services can update billing and credits fields.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_fields on app_rubberduck.profiles;

create trigger protect_profile_fields
  before update on app_rubberduck.profiles
  for each row execute procedure app_rubberduck.protect_profile_system_fields();

alter table app_rubberduck.profiles enable row level security;

alter table app_rubberduck.projects enable row level security;

alter table app_rubberduck.chat_logs enable row level security;

drop policy if exists profiles_select_own on app_rubberduck.profiles;

create policy profiles_select_own
  on app_rubberduck.profiles for select
  using (auth.uid() = id);

drop policy if exists profiles_update_own on app_rubberduck.profiles;

create policy profiles_update_own
  on app_rubberduck.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists projects_select on app_rubberduck.projects;

create policy projects_select
  on app_rubberduck.projects for select
  using (auth.uid() = user_id or is_public = true);

drop policy if exists projects_insert_own on app_rubberduck.projects;

create policy projects_insert_own
  on app_rubberduck.projects for insert
  with check (auth.uid() = user_id);

drop policy if exists projects_update_own on app_rubberduck.projects;

create policy projects_update_own
  on app_rubberduck.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists projects_delete_own on app_rubberduck.projects;

create policy projects_delete_own
  on app_rubberduck.projects for delete
  using (auth.uid() = user_id);

drop policy if exists chat_logs_select_own on app_rubberduck.chat_logs;

create policy chat_logs_select_own
  on app_rubberduck.chat_logs for select
  using (auth.uid() = user_id);

drop policy if exists chat_logs_insert_own on app_rubberduck.chat_logs;

create policy chat_logs_insert_own
  on app_rubberduck.chat_logs for insert
  with check (auth.uid() = user_id);

drop policy if exists chat_logs_update_own on app_rubberduck.chat_logs;

create policy chat_logs_update_own
  on app_rubberduck.chat_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists chat_logs_delete_own on app_rubberduck.chat_logs;

create policy chat_logs_delete_own
  on app_rubberduck.chat_logs for delete
  using (auth.uid() = user_id);
