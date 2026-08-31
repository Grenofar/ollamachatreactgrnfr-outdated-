-- Run once in the Supabase SQL editor, after supabase/updater_migration.sql.
-- Adds a `product` column to app_releases so a second standalone product
-- (Control Me, installed separately from the main ollama-chat-react app)
-- can publish its own release channel through the same table, without
-- touching any row already published for the main app.

alter table public.app_releases
  add column if not exists product text not null default 'ollamachat';

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
-- The second call returns null until a Control Me release is actually published.
