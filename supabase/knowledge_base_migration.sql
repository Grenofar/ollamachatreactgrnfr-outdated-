-- Run once in the Supabase SQL editor (project cihuwuiyziarnghethbi).
--
-- "DB ready for Control Me" — the public-sharing half of the feature.
-- The local knowledge base (a hidden folder of .txt/.json/.sql files the
-- user fills in themselves) can optionally be published here for others to
-- import by its share_code. See CLAUDE.md > "Base de connaissances Control
-- Me" for the full write-up.
--
-- IMPORTANT, stated plainly (not glossed over): this is the FIRST table in
-- this project that grants anon INSERT. Every other table so far
-- (app_releases) is anon-read-only by deliberate choice — publishing here
-- means anyone holding the anon key (already public, already committed in
-- this repo and in site/index.html) can insert a row, and every row is
-- world-readable, forever — there is no update/delete policy for anon, so
-- there is no "unpublish" from the app in this version. This is a real,
-- documented departure from the project's usual read-only Supabase
-- posture, made deliberately for this one feature, not a mistake.

create table if not exists public.controlme_knowledge_shares (
  id bigint generated always as identity primary key,
  share_code text not null unique,
  title text,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.controlme_knowledge_shares enable row level security;

create policy "Public read access" on public.controlme_knowledge_shares
  for select
  to anon
  using (true);

-- No size limit enforced here at the database level — the app caps what it
-- sends before publishing (see MAX_TOTAL_BYTES in knowledge_base.rs), but
-- that's an application-level courtesy, not a server-side guarantee.
create policy "Public insert (anon can publish)" on public.controlme_knowledge_shares
  for insert
  to anon
  with check (true);

-- Deliberately no update/delete policy for anon — once published, a row
-- stays public and immutable from the app's own UI. Revisit only if a
-- real "unpublish" flow is asked for later (would need some notion of
-- ownership, which this project has none of today — no accounts, no auth).
