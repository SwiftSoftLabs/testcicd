alter table if exists app_voxaura.auth_users
  add column if not exists app_origin text not null default 'app_voxaura';

alter table if exists app_voxaura.auth_users
  add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;

update app_voxaura.auth_users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('app_origin', 'app_voxaura')
where coalesce(raw_user_meta_data->>'app_origin', '') = '';

create table if not exists app_voxaura.token_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_voxaura.auth_users(id) on delete cascade,
  checkout_session_id text not null unique,
  token_amount integer not null check (token_amount > 0),
  payment_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_token_purchases_user_id on app_voxaura.token_purchases(user_id);

alter table app_voxaura.token_purchases enable row level security;

drop policy if exists token_purchases_self_select on app_voxaura.token_purchases;

create policy token_purchases_self_select
on app_voxaura.token_purchases
for select
using (user_id::text = public.jwt_sub());

drop policy if exists token_purchases_no_client_write on app_voxaura.token_purchases;

create policy token_purchases_no_client_write
on app_voxaura.token_purchases
for all
using (false)
with check (false);

drop trigger if exists trg_token_purchases_updated_at on app_voxaura.token_purchases;

create trigger trg_token_purchases_updated_at
before update on app_voxaura.token_purchases
for each row execute function public.handle_updated_at();
