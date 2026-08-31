-- Run once in the Supabase SQL editor, after supabase/updater_migration.sql.
-- Adds a `product` column to app_releases so a second standalone product
-- (Control Me, installed separately from the main ollama-chat-react app)
-- can publish its own release channel through the same table, without
-- touching any row already published for the main app.

alter table public.app_releases
  add column if not exists product text not null default 'ollamachat';

-- IMPORTANT: `create or replace function` only replaces a function with the
-- EXACT SAME parameter list. Since the old latest_release_manifest() had no
-- parameters and this one takes p_product, Postgres kept BOTH as separate
-- overloads instead of replacing — which breaks PostgREST for a no-argument
-- call (it can't decide between them: "Could not choose the best candidate
-- function... latest_release_manifest(), latest_release_manifest(p_product
-- => text)", error PGRST203). The old zero-argument overload must be
-- dropped explicitly. If you already ran an earlier version of this file
-- without the DROP FUNCTION line below, run this file again — it's safe to
-- re-run.
drop function if exists public.latest_release_manifest();

-- Replaces latest_release_manifest() with a parameterized version.
-- Backward compatible by construction: existing rows default to
-- product = 'ollamachat', and p_product defaults to 'ollamachat' too, so
-- the main app's existing updater endpoint (which calls this with no
-- parameter) keeps behaving exactly as before. Control Me's own endpoint
-- calls it as .../rpc/latest_release_manifest?p_product=controlme.
create or replace function public.latest_release_manifest(p_product text default 'ollamachat')
returns json
language sql
stable
as $$
  select json_build_object(
    'version', version,
    'notes', notes,
    'pub_date', to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'platforms', json_build_object(
      'windows-x86_64', json_build_object(
        'signature', signature,
        'url', download_url
      )
    )
  )
  from public.app_releases
  where signature is not null and product = p_product
  order by published_at desc
  limit 1;
$$;

grant execute on function public.latest_release_manifest(text) to anon;

-- Sanity check once this is applied (both should keep working):
-- curl "https://cihuwuiyziarnghethbi.supabase.co/rest/v1/rpc/latest_release_manifest" \
--   -H "apikey: <anon key>"
-- curl "https://cihuwuiyziarnghethbi.supabase.co/rest/v1/rpc/latest_release_manifest?p_product=controlme" \
--   -H "apikey: <anon key>"
-- Both should return valid manifest JSON, not a PGRST203 error.
