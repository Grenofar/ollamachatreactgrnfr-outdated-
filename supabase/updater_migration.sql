-- Run once in the Supabase SQL editor, after supabase/schema.sql.
-- Adds what tauri-plugin-updater needs: a signature column on the existing
-- app_releases table, and an RPC endpoint that reshapes the latest row into
-- the exact JSON format the updater expects (a plain SELECT over the table
-- can't produce this nested shape).

alter table public.app_releases add column if not exists signature text;

create or replace function public.latest_release_manifest()
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
  where signature is not null
  order by published_at desc
  limit 1;
$$;

grant execute on function public.latest_release_manifest() to anon;

-- Sanity check once this is applied:
-- curl "https://cihuwuiyziarnghethbi.supabase.co/rest/v1/rpc/latest_release_manifest" \
--   -H "apikey: <anon key>"
-- should return the manifest JSON (or `null` if no release has a signature
-- yet — expected until the first release built with signing is published).
