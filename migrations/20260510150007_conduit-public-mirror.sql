create table if not exists public.conduit_workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists idx_pub_conduit_workspaces_owner on public.conduit_workspaces(owner_id);

create table if not exists public.conduit_workspace_members (
  workspace_id  uuid not null references public.conduit_workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          app_conduit.role not null default 'Editor',
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists idx_pub_conduit_members_user on public.conduit_workspace_members(user_id);

create table if not exists public.conduit_channels (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.conduit_workspaces(id) on delete cascade,
  youtube_channel_id       text not null,
  title                    text not null,
  handle                   text,
  avatar_emoji             text not null default '🎬',
  niche                    text,
  accent_color             text not null default '#FF0000',
  subscribers              bigint not null default 0,
  status                   app_conduit.channel_status not null default 'active',
  encrypted_refresh_token  text,
  token_iv                 text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (workspace_id, youtube_channel_id)
);

create index if not exists idx_pub_conduit_channels_workspace on public.conduit_channels(workspace_id);

create table if not exists public.conduit_assets (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.conduit_workspaces(id) on delete cascade,
  base_title         text not null,
  base_description   text,
  base_tags          text[] not null default '{}',
  thumbnail_url      text,
  cloud_storage_url  text,
  duration_sec       integer,
  file_size_mb       integer,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists idx_pub_conduit_assets_workspace on public.conduit_assets(workspace_id);

create table if not exists public.conduit_jobs (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.conduit_workspaces(id) on delete cascade,
  asset_id            uuid not null references public.conduit_assets(id) on delete cascade,
  channel_id          uuid not null references public.conduit_channels(id) on delete cascade,
  status              app_conduit.job_status not null default 'pending',
  scheduled_time      timestamptz,
  youtube_video_id    text,
  title_override      text,
  description_override text,
  tags_override       text[],
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_pub_conduit_jobs_workspace  on public.conduit_jobs(workspace_id);

create index if not exists idx_pub_conduit_jobs_asset      on public.conduit_jobs(asset_id);

create index if not exists idx_pub_conduit_jobs_channel    on public.conduit_jobs(channel_id);

create index if not exists idx_pub_conduit_jobs_scheduled  on public.conduit_jobs(scheduled_time);

create table if not exists public.conduit_activity (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.conduit_workspaces(id) on delete cascade,
  channel_id    uuid references public.conduit_channels(id) on delete set null,
  level         text not null check (level in ('info','success','warn','error')),
  message       text not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_pub_conduit_activity_workspace on public.conduit_activity(workspace_id, created_at desc);

create or replace function public.conduit_is_member(ws uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conduit_workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create or replace function public.conduit_has_role(ws uuid, min_role app_conduit.role)
returns boolean language sql stable security definer
set search_path = public, app_conduit
as $$
  with rank as (
    select case role
      when 'Owner' then 4
      when 'Admin' then 3
      when 'Editor' then 2
      when 'Analyst' then 1
    end as r
    from public.conduit_workspace_members
    where workspace_id = ws and user_id = auth.uid()
  ),
  needed as (
    select case min_role
      when 'Owner' then 4
      when 'Admin' then 3
      when 'Editor' then 2
      when 'Analyst' then 1
    end as r
  )
  select coalesce((select r from rank), 0) >= (select r from needed);
$$;

create or replace function public.conduit_workspaces_after_insert()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.conduit_workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'Owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_conduit_workspaces_owner on public.conduit_workspaces;

create trigger trg_conduit_workspaces_owner
after insert on public.conduit_workspaces
for each row execute function public.conduit_workspaces_after_insert();

alter table public.conduit_workspaces        enable row level security;

alter table public.conduit_workspace_members enable row level security;

alter table public.conduit_channels          enable row level security;

alter table public.conduit_assets            enable row level security;

alter table public.conduit_jobs              enable row level security;

alter table public.conduit_activity          enable row level security;

create policy "conduit_workspaces_select"
on public.conduit_workspaces for select to public
using (public.conduit_is_member(id));

create policy "conduit_workspaces_insert"
on public.conduit_workspaces for insert to public
with check (auth.uid() = owner_id);

create policy "conduit_workspaces_update_owner"
on public.conduit_workspaces for update to public
using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "conduit_workspaces_delete_owner"
on public.conduit_workspaces for delete to public
using (auth.uid() = owner_id);

create policy "conduit_members_select"
on public.conduit_workspace_members for select to public
using (public.conduit_is_member(workspace_id));

create policy "conduit_members_insert_admin"
on public.conduit_workspace_members for insert to public
with check (public.conduit_has_role(workspace_id, 'Admin'));

create policy "conduit_members_update_admin"
on public.conduit_workspace_members for update to public
using (public.conduit_has_role(workspace_id, 'Admin'))
with check (public.conduit_has_role(workspace_id, 'Admin'));

create policy "conduit_members_delete_admin"
on public.conduit_workspace_members for delete to public
using (public.conduit_has_role(workspace_id, 'Admin'));

create policy "conduit_channels_select_members"
on public.conduit_channels for select to public
using (public.conduit_is_member(workspace_id));

create policy "conduit_channels_insert_editor"
on public.conduit_channels for insert to public
with check (public.conduit_has_role(workspace_id, 'Editor'));

create policy "conduit_channels_update_editor"
on public.conduit_channels for update to public
using (public.conduit_has_role(workspace_id, 'Editor'))
with check (public.conduit_has_role(workspace_id, 'Editor'));

create policy "conduit_channels_delete_admin"
on public.conduit_channels for delete to public
using (public.conduit_has_role(workspace_id, 'Admin'));

create policy "conduit_assets_select"
on public.conduit_assets for select to public
using (public.conduit_is_member(workspace_id));

create policy "conduit_assets_insert_editor"
on public.conduit_assets for insert to public
with check (public.conduit_has_role(workspace_id, 'Editor'));

create policy "conduit_assets_update_editor"
on public.conduit_assets for update to public
using (public.conduit_has_role(workspace_id, 'Editor'))
with check (public.conduit_has_role(workspace_id, 'Editor'));

create policy "conduit_assets_delete_admin"
on public.conduit_assets for delete to public
using (public.conduit_has_role(workspace_id, 'Admin'));

create policy "conduit_jobs_select"
on public.conduit_jobs for select to public
using (public.conduit_is_member(workspace_id));

create policy "conduit_jobs_insert_editor"
on public.conduit_jobs for insert to public
with check (
  public.conduit_has_role(workspace_id, 'Editor')
  and (status <> 'published' or public.conduit_has_role(workspace_id, 'Admin'))
);

create policy "conduit_jobs_update_editor"
on public.conduit_jobs for update to public
using (public.conduit_has_role(workspace_id, 'Editor'))
with check (
  public.conduit_has_role(workspace_id, 'Editor')
  and (status <> 'published' or public.conduit_has_role(workspace_id, 'Admin'))
);

create policy "conduit_jobs_delete_admin"
on public.conduit_jobs for delete to public
using (public.conduit_has_role(workspace_id, 'Admin'));

create policy "conduit_activity_select"
on public.conduit_activity for select to public
using (public.conduit_is_member(workspace_id));

create policy "conduit_activity_insert"
on public.conduit_activity for insert to public
with check (public.conduit_is_member(workspace_id));
