-- =====================================================================
-- 003_storage_buckets.sql
-- K-Padel Arena Manager — Storage buckets + policies
--
-- HOW TO RUN: after 001 and 002 have been run, paste this whole file
-- into the SQL Editor and Run.
--
-- Folder convention (this is what the policies below check against):
--   avatars/{auth.uid()}/<file>            — a user's own profile photo
--   club-photos/{club_id}/<file>           — a club's venue banner photo
--   court-photos/{club_id}/<file>          — a court's photo
--   result-photos/{club_id}/<file>         — a match/tournament result photo
--
-- All four buckets are PUBLIC for reading (so <img> tags can just use
-- the public URL directly, same as the app does today with data URLs) —
-- only WRITE access is restricted by the policies below.
-- =====================================================================

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('club-photos', 'club-photos', true),
  ('court-photos', 'court-photos', true),
  ('result-photos', 'result-photos', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- avatars — a user may only write inside their own uid-named folder.
-- ---------------------------------------------------------------------
drop policy if exists "avatars_write_own_folder" on storage.objects;
create policy "avatars_write_own_folder"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- club-photos — only that club's owner/admin may write.
-- ---------------------------------------------------------------------
drop policy if exists "club_photos_write_admin" on storage.objects;
create policy "club_photos_write_admin"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'club-photos' and public.is_club_admin(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'club-photos' and public.is_club_admin(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- court-photos — only that club's owner/admin may write.
-- ---------------------------------------------------------------------
drop policy if exists "court_photos_write_admin" on storage.objects;
create policy "court_photos_write_admin"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'court-photos' and public.is_club_admin(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'court-photos' and public.is_club_admin(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- result-photos — any signed-in member of that club may write (matches
-- today's behavior, where any logged-in player can attach a result photo).
-- ---------------------------------------------------------------------
drop policy if exists "result_photos_write_members" on storage.objects;
create policy "result_photos_write_members"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'result-photos' and public.is_club_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'result-photos' and public.is_club_member(((storage.foldername(name))[1])::uuid));
