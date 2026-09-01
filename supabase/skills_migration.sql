-- Run once in the Supabase SQL editor (project cihuwuiyziarnghethbi).
--
-- "DB skill for Control Me" (v0.5.8) — replaces the flat "DB ready"
-- knowledge base with named+described skills. Publishing still uses the
-- same table (controlme_knowledge_shares, created by
-- knowledge_base_migration.sql) — this migration just reshapes it:
-- `title` (nullable) becomes `name` (kept nullable at the DB level for
-- simplicity, but the app itself refuses to publish a skill without both
-- a name AND a description — see skills.rs's validate()), and a new
-- `description` column is added.
--
-- Safe to run even if no rows exist yet (very likely true — the knowledge
-- base feature this replaces only shipped a few hours before this
-- migration was written, unlikely anyone published anything yet). If rows
-- somehow do exist already, they keep their content/share_code, `name`
-- inherits the old `title` value, and `description` starts empty for them
-- — the app will just show an empty description for those older rows,
-- nothing breaks.

alter table public.controlme_knowledge_shares
  rename column title to name;

alter table public.controlme_knowledge_shares
  add column if not exists description text not null default '';

-- No RLS change needed: the existing "Public read access" (select, anon)
-- and "Public insert (anon can publish)" (insert, anon) policies already
-- apply to every column on the table, name/description included. Still no
-- update/delete policy for anon — a published skill stays public and
-- immutable forever from this app, exactly as before (see skills.rs's
-- module doc comment for what unpublish_skill can and can't do about
-- that).
