create extension if not exists "pgcrypto";

create type public.profile_role as enum ('artist', 'venue');

create type public.gig_status as enum ('open', 'pending', 'booked', 'settled');

create type public.offer_status as enum ('pending', 'rejected', 'accepted');

create type public.payment_status as enum ('pending', 'processing', 'paid', 'failed');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.profile_role not null,
  full_name text,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  venue_name text not null,
  location_text text,
  location_geo jsonb,
  max_capacity integer,
  stripe_account_id text,
  is_draft boolean not null default true,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stage_name text not null,
  primary_genres text[] not null default '{}',
  base_rate numeric(10, 2),
  performance_radius_km integer,
  draw_score numeric(8, 2) not null default 0,
  cancellation_rate numeric(6, 3) not null default 0,
  is_draft boolean not null default true,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gigs (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  starts_at timestamptz not null,
  budget numeric(10, 2) not null,
  status public.gig_status not null default 'open',
  genre text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  proposed_fee numeric(10, 2) not null,
  status public.offer_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gig_id, artist_id)
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null unique references public.gigs(id) on delete cascade,
  final_payout numeric(10, 2) not null,
  actual_draw integer not null,
  payment_status public.payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.track_records (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  gig_id uuid not null references public.gigs(id) on delete cascade,
  verified_draw integer not null,
  cancellation_flag boolean not null default false,
  venue_rating numeric(3, 2),
  created_at timestamptz not null default now(),
  unique (artist_id, gig_id)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  author_venue_id uuid not null references public.venues(id) on delete cascade,
  target_artist_id uuid not null references public.artists(id) on delete cascade,
  gig_id uuid not null references public.gigs(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (author_venue_id, target_artist_id, gig_id)
);

create index if not exists idx_artists_draw_score on public.artists(draw_score desc);

create index if not exists idx_artists_base_rate on public.artists(base_rate);

create index if not exists idx_gigs_starts_at on public.gigs(starts_at);

create index if not exists idx_offers_gig_id on public.offers(gig_id);

create index if not exists idx_offers_artist_id on public.offers(artist_id);

create index if not exists idx_track_records_artist_id on public.track_records(artist_id);

alter table public.profiles enable row level security;

alter table public.venues enable row level security;

alter table public.artists enable row level security;

alter table public.gigs enable row level security;

alter table public.offers enable row level security;

alter table public.settlements enable row level security;

alter table public.track_records enable row level security;

alter table public.reviews enable row level security;

create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "venues_select_own"
on public.venues for select
using (auth.uid() = user_id);

create policy "venues_insert_own"
on public.venues for insert
with check (auth.uid() = user_id);

create policy "venues_update_own"
on public.venues for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "artists_select_public_or_own"
on public.artists for select
using (is_draft = false or auth.uid() = user_id);

create policy "artists_insert_own"
on public.artists for insert
with check (auth.uid() = user_id);

create policy "artists_update_own"
on public.artists for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
