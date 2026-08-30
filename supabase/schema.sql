-- Run once in the Supabase SQL editor (project cihuwuiyziarnghethbi).
-- Read-only table: the app and the download site both read it with the
-- anon key. There is deliberately no INSERT/UPDATE/DELETE policy for
-- anon, so publishing a new version means adding a row here yourself
-- (SQL editor or Table editor), never from the app or the site.

create table if not exists public.app_releases (
  id bigint generated always as identity primary key,
  version text not null,
  download_url text,
  notes text,
  published_at timestamptz not null default now()
);

alter table public.app_releases enable row level security;

create policy "Public read access" on public.app_releases
  for select
  to anon
  using (true);

-- Once a Windows installer is built and uploaded somewhere public, publish
-- a version by inserting a row, e.g.:
--
-- insert into public.app_releases (version, download_url, notes)
-- values ('0.2.0', 'https://.../OllamaChatReact_0.2.0_x64.msi', 'Première version installable.');
