-- =====================================================================
-- 001_schema.sql
-- K-Padel Arena Manager — table definitions
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → New query → paste this
-- entire file → Run. Safe to run on a fresh project. This file only
-- CREATEs objects (no DROP, no DELETE) — see the top-level guide for
-- why that matters if you're migrating from an existing setup.
-- =====================================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---------------------------------------------------------------------
-- profiles — one row per app user, keyed to Supabase Auth's auth.users.
-- Created by the app (not a trigger) right after auth.signUp() succeeds,
-- so every field from the current sign-up form has a home here.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  phone text,
  email text,                         -- real recovery email (separate from the synthetic auth email)
  gender text,
  region text,                        -- 서울/인천/경기도 등
  level numeric(2,1) not null default 3.0 check (level >= 0 and level <= 7),
  photo_url text,
  needs_password_reset boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column public.profiles.needs_password_reset is
  'Set true for accounts migrated from the old SHA-256 system, whose real password we never stored and therefore cannot carry over.';

-- ---------------------------------------------------------------------
-- clubs — one row per club/venue setup (what the app internally calls
-- a "league": name, venue, format, court count, amenities).
-- ---------------------------------------------------------------------
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null default '새 리그',
  venue text not null,
  format text not null default 'americano' check (format in ('americano', 'mexicano', 'round_robin')),
  court_count int not null default 2 check (court_count between 1 and 8),
  amenities jsonb not null default '{}'::jsonb,
  photo_url text,
  result_photo_url text,
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- club_members — who belongs to a club, and with what permission level.
-- The club creator is inserted as 'owner' by the app immediately after
-- the club is created.
--
-- profile_id is nullable on purpose: the existing app lets an admin add
-- a same-day "quick" player by name only (no account), same as it
-- already does for booking guests. Such a row has guest_name set and
-- profile_id null, and can only ever be a 'player' (never own/admin a
-- club, since it isn't a real login).
-- ---------------------------------------------------------------------
create table if not exists public.club_members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  guest_name text,
  role text not null default 'player' check (role in ('owner', 'admin', 'player')),
  joined_at timestamptz not null default now(),
  constraint club_member_identity check (profile_id is not null or guest_name is not null),
  constraint club_member_guest_is_player check (profile_id is not null or role = 'player'),
  unique (club_id, profile_id)
);

-- ---------------------------------------------------------------------
-- courts — individual courts within a club (name + photo). The current
-- app only tracked a court COUNT; this table is new, so that "코트
-- 등록" and per-court photos have a real home going forward.
-- ---------------------------------------------------------------------
create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  court_number int not null,
  name text,
  photo_url text,
  created_at timestamptz not null default now(),
  unique (club_id, court_number)
);

-- ---------------------------------------------------------------------
-- matches — one row per court-match within a generated round (Americano/
-- Mexicano/round-robin). side_a_ids / side_b_ids hold profile ids (or,
-- for round-robin, the two-player pairing already lives in club_members
-- via a synthetic "team" — see the migration guide's note on teams).
-- ---------------------------------------------------------------------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  round_number int not null,
  court_number int not null,
  side_a_ids uuid[] not null,
  side_b_ids uuid[] not null,
  score_a int,
  score_b int,
  sit_out_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists matches_club_round_idx on public.matches (club_id, round_number);

-- ---------------------------------------------------------------------
-- bookings — one row per booked hour-slot. Multi-hour reservations share
-- a group_id (one row per hour, same group_id), matching the existing
-- in-app booking model.
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  court_number int not null,
  booking_date date not null,
  booking_time time not null,
  category text not null default 'match' check (category in ('rental', 'match', 'league', 'lesson')),
  group_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (club_id, court_number, booking_date, booking_time)
);

create index if not exists bookings_club_date_idx on public.bookings (club_id, booking_date);

-- ---------------------------------------------------------------------
-- booking_participants — who's in a booking slot. Either a real member
-- (profile_id) or a typed-in guest name, matching current behavior.
-- ---------------------------------------------------------------------
create table if not exists public.booking_participants (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  guest_name text,
  created_at timestamptz not null default now(),
  constraint booking_participant_identity check (profile_id is not null or guest_name is not null)
);

create index if not exists booking_participants_booking_idx on public.booking_participants (booking_id);
