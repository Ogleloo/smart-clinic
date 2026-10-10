-- NEGATIVE CONTROL (not part of the proposal). Applies the proposal plus the ORIGINAL design's
-- owner-folder upload policy, i.e. a direct Storage API write path that skips re-encoding.
-- run.sh must report FAIL on "user cannot upload into their own folder" with this file:
--   PROPOSAL_SQL=supabase/tests/avatar_proposal/nc_insert_policy.sql bash supabase/tests/avatar_proposal/run.sh
\ir ../../../docs/proposals/avatar_storage.sql

create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
