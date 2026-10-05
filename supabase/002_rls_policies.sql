-- =====================================================================
-- 002_rls_policies.sql
-- K-Padel Arena Manager — Row Level Security
--
-- HOW TO RUN: after 001_schema.sql has been run successfully, paste
-- this whole file into the SQL Editor and Run. Safe to re-run — it
-- drops and recreates only the POLICIES it defines, never any table
-- or data.
--
-- Design summary:
--   - Anyone (including logged-out visitors) can READ club info,
--     courts, matches, bookings — this keeps the booking calendar
--     browsable without login, as originally requested.
--   - Only a signed-in user can WRITE anything, and only within the
--     scope that's theirs: their own profile, clubs they belong to,
--     bookings they created or joined.
--   - Only a club's owner/admin can rename the club, change its
--     format/court count/amenities, add/rename courts, or generate a
--     new round of matches.
--   - Any signed-in club member can enter a MATCH SCORE (this matches
--     today's behavior, where any logged-in player records results)
--     and can join/leave a booking slot.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: is the current user an owner/admin of a given club?
-- SECURITY DEFINER so this check itself isn't blocked by the very RLS
-- policy on club_members that uses it (avoids policy recursion).
-- ---------------------------------------------------------------------
create or replace function public.is_club_admin(target_club_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.club_members
    where club_id = target_club_id
      and profile_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_club_member(target_club_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.club_members
    where club_id = target_club_id
      and profile_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No delete policy: deleting your account is an admin action for now,
-- not exposed to end users. (Add one later if you need self-deletion.)

-- ---------------------------------------------------------------------
-- clubs
-- ---------------------------------------------------------------------
alter table public.clubs enable row level security;

drop policy if exists "clubs_select_public" on public.clubs;
create policy "clubs_select_public"
  on public.clubs for select
  to anon, authenticated
  using (true);

drop policy if exists "clubs_insert_owner" on public.clubs;
create policy "clubs_insert_owner"
  on public.clubs for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "clubs_update_admin" on public.clubs;
create policy "clubs_update_admin"
  on public.clubs for update
  to authenticated
  using (public.is_club_admin(id))
  with check (public.is_club_admin(id));

drop policy if exists "clubs_delete_owner" on public.clubs;
create policy "clubs_delete_owner"
  on public.clubs for delete
  to authenticated
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------
-- club_members
-- ---------------------------------------------------------------------
alter table public.club_members enable row level security;

drop policy if exists "club_members_select_public" on public.club_members;
create policy "club_members_select_public"
  on public.club_members for select
  to anon, authenticated
  using (true);

-- Anyone signed in can join a club as a plain player themselves.
drop policy if exists "club_members_insert_self_as_player" on public.club_members;
create policy "club_members_insert_self_as_player"
  on public.club_members for insert
  to authenticated
  with check (profile_id = auth.uid() and role = 'player');

-- The club creator is inserted as 'owner' in the same transaction as
-- the club row, by an owner/admin action — this policy allows an
-- existing admin/owner to add or promote OTHER members too.
drop policy if exists "club_members_insert_by_admin" on public.club_members;
create policy "club_members_insert_by_admin"
  on public.club_members for insert
  to authenticated
  with check (public.is_club_admin(club_id));

drop policy if exists "club_members_update_admin" on public.club_members;
create policy "club_members_update_admin"
  on public.club_members for update
  to authenticated
  using (public.is_club_admin(club_id))
  with check (public.is_club_admin(club_id));

drop policy if exists "club_members_delete_self_or_admin" on public.club_members;
create policy "club_members_delete_self_or_admin"
  on public.club_members for delete
  to authenticated
  using (profile_id = auth.uid() or public.is_club_admin(club_id));

-- ---------------------------------------------------------------------
-- courts
-- ---------------------------------------------------------------------
alter table public.courts enable row level security;

drop policy if exists "courts_select_public" on public.courts;
create policy "courts_select_public"
  on public.courts for select
  to anon, authenticated
  using (true);

drop policy if exists "courts_write_admin" on public.courts;
create policy "courts_write_admin"
  on public.courts for all
  to authenticated
  using (public.is_club_admin(club_id))
  with check (public.is_club_admin(club_id));

-- ---------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------
alter table public.matches enable row level security;

drop policy if exists "matches_select_public" on public.matches;
create policy "matches_select_public"
  on public.matches for select
  to anon, authenticated
  using (true);

-- Generating a new round (insert) is a club-management action.
drop policy if exists "matches_insert_admin" on public.matches;
create policy "matches_insert_admin"
  on public.matches for insert
  to authenticated
  with check (public.is_club_admin(club_id));

-- Entering/editing a score is allowed for any signed-in club member —
-- this matches today's app behavior (any logged-in player records
-- results), while still blocking non-members entirely.
drop policy if exists "matches_update_members" on public.matches;
create policy "matches_update_members"
  on public.matches for update
  to authenticated
  using (public.is_club_member(club_id))
  with check (public.is_club_member(club_id));

drop policy if exists "matches_delete_admin" on public.matches;
create policy "matches_delete_admin"
  on public.matches for delete
  to authenticated
  using (public.is_club_admin(club_id));

-- ---------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------
alter table public.bookings enable row level security;

drop policy if exists "bookings_select_public" on public.bookings;
create policy "bookings_select_public"
  on public.bookings for select
  to anon, authenticated
  using (true);

-- Any signed-in club member can open a new booking slot.
drop policy if exists "bookings_insert_members" on public.bookings;
create policy "bookings_insert_members"
  on public.bookings for insert
  to authenticated
  with check (public.is_club_member(club_id));

drop policy if exists "bookings_delete_admin" on public.bookings;
create policy "bookings_delete_admin"
  on public.bookings for delete
  to authenticated
  using (public.is_club_admin(club_id));

-- ---------------------------------------------------------------------
-- booking_participants
-- ---------------------------------------------------------------------
alter table public.booking_participants enable row level security;

drop policy if exists "booking_participants_select_public" on public.booking_participants;
create policy "booking_participants_select_public"
  on public.booking_participants for select
  to anon, authenticated
  using (true);

-- Joining a slot (as yourself, or adding a guest name) requires being
-- signed in and a member of that booking's club.
drop policy if exists "booking_participants_insert_members" on public.booking_participants;
create policy "booking_participants_insert_members"
  on public.booking_participants for insert
  to authenticated
  with check (
    exists (
      select 1 from public.bookings b
      where b.id = booking_id and public.is_club_member(b.club_id)
    )
  );

-- You can remove yourself; a club admin can remove anyone (e.g. to fix
-- a mistaken guest entry).
drop policy if exists "booking_participants_delete_self_or_admin" on public.booking_participants;
create policy "booking_participants_delete_self_or_admin"
  on public.booking_participants for delete
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.bookings b
      where b.id = booking_id and public.is_club_admin(b.club_id)
    )
  );
