-- Run once in the Supabase SQL editor (project cihuwuiyziarnghethbi), after
-- accounts_marketplace_migration.sql (already run and verified). Extends the
-- marketplace for v0.7 : page GitHub-like par extension (résumé court,
-- photo d'impression, galerie photos/vidéos), grille de recherche, et deux
-- compteurs distincts pour le tableau de bord développeur — combien de
-- personnes ont OUVERT la page (page_view_count) vs combien ont CLIQUÉ sur
-- "Ajouter" (install_click_count), séparés de extension_install_count
-- (installations confirmées, déjà existant) qui reste la seule mesure fiable
-- côté app puisqu'elle est dédupliquée par appareil.
--
-- Compteurs implémentés comme de simples colonnes + fonctions RPC
-- `security definer` qui incrémentent, pas comme des tables d'événements —
-- suffisant pour un compteur affiché, plus simple, pas de croissance non
-- bornée. Callable par `anon` : un visiteur du site qui n'est pas connecté
-- doit quand même compter comme une vue/un clic. Assumé comme non protégé
-- contre le spam (quelqu'un pourrait boucler l'appel RPC pour gonfler ses
-- propres chiffres) — même posture que les autres compromis de sécurité déjà
-- documentés dans ce projet (code de jumelage à distance, dossier caché de
-- la base de connaissances) : un frein normal, pas une garantie contre un
-- attaquant motivé, à durcir seulement si ça devient un vrai problème.

-- ---------------------------------------------------------------------
-- extensions : nouvelles colonnes pour la page façon GitHub. summary est
-- volontairement limité en base ET côté app (même défense en profondeur que
-- profiles.username) pour rester un vrai "résumé de 3 lignes", pas une
-- description complète (qui existe déjà dans `description`).
alter table public.extensions
  add column if not exists summary text not null default '',
  add column if not exists thumbnail_url text,
  add column if not exists page_view_count bigint not null default 0,
  add column if not exists install_click_count bigint not null default 0;

alter table public.extensions
  add constraint extensions_summary_length check (char_length(summary) <= 220);

-- summary/thumbnail_url sont éditables par le propriétaire au même titre que
-- name/description (déjà limité à ces deux colonnes par
-- accounts_marketplace_migration.sql — is_official reste protégée) : la
-- grant précédente doit être réémise avec la liste complète, pas juste
-- étendue (grant est additif par nature mais autant être explicite).
grant update (name, description, summary, thumbnail_url) on public.extensions to authenticated;

create or replace function public.record_extension_page_view(p_extension_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.extensions set page_view_count = page_view_count + 1 where id = p_extension_id;
$$;

grant execute on function public.record_extension_page_view(uuid) to anon, authenticated;

create or replace function public.record_extension_install_click(p_extension_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.extensions set install_click_count = install_click_count + 1 where id = p_extension_id;
$$;

grant execute on function public.record_extension_install_click(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- extension_media : galerie photos/vidéos d'une page d'extension (en plus
-- de thumbnail_url, qui est LA photo de première vue affichée dans les
-- cartes de la grille de recherche). position sert d'ordre d'affichage
-- explicite (pas juste created_at) pour que l'auteur puisse réordonner plus
-- tard sans dépendre de l'ordre d'upload.
create table if not exists public.extension_media (
  id uuid primary key default gen_random_uuid(),
  extension_id uuid not null references public.extensions(id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.extension_media enable row level security;

create policy "Public read access" on public.extension_media
  for select to anon, authenticated using (true);

create policy "Extension owner can add media" on public.extension_media
  for insert to authenticated
  with check (
    exists (select 1 from public.extensions e where e.id = extension_id and e.owner_id = auth.uid())
  );

create policy "Extension owner can remove media" on public.extension_media
  for delete to authenticated
  using (
    exists (select 1 from public.extensions e where e.id = extension_id and e.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- Storage : bucket "extension-media", lecture publique, écriture limitée au
-- propriétaire de l'extension ciblée par le chemin ({extension_id}/xxx),
-- vérifié via une sous-requête sur public.extensions (les policies Storage
-- de Supabase sont de la RLS Postgres normale sur storage.objects — rien
-- n'empêche de joindre une autre table dans le USING/WITH CHECK). Limite de
-- taille et types acceptés posés directement sur le bucket : 10 Mo, images
-- courantes + mp4/webm — correspond à la demande explicite d'une "limite de
-- taille" sur les photos/vidéos de démonstration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'extension-media',
  'extension-media',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Public extension media read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'extension-media');

create policy "Extension owner media upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'extension-media'
    and exists (
      select 1 from public.extensions e
      where e.id::text = (storage.foldername(name))[1] and e.owner_id = auth.uid()
    )
  );

create policy "Extension owner media delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'extension-media'
    and exists (
      select 1 from public.extensions e
      where e.id::text = (storage.foldername(name))[1] and e.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- Statistiques publiques pour le compteur temps réel de la landing page
-- (nombre de comptes, nombre d'extensions publiées) — une seule fonction
-- plutôt que deux SELECT count(*) séparés côté client, et security definer
-- pour ne pas avoir à ouvrir une policy SELECT large juste pour compter des
-- lignes (même raisonnement que extension_install_count).
create or replace function public.site_stats()
returns table (user_count bigint, extension_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.profiles),
    (select count(*) from public.extensions);
$$;

grant execute on function public.site_stats() to anon, authenticated;

-- "Temps réel" côté landing page : le site s'abonne aux INSERT sur
-- profiles/extensions via Supabase Realtime (postgres_changes) plutôt que de
-- re-fetcher site_stats() en boucle — nécessite que ces deux tables soient
-- dans la publication Realtime. Sans effet si déjà présentes (le `add table`
-- échoue silencieusement... en fait non, il échoue bruyamment si déjà membre
-- — d'où le bloc DO ci-dessous qui l'ignore proprement pour que ce fichier
-- reste ré-exécutable sans erreur, comme les migrations précédentes de ce
-- projet).
do $$
begin
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.extensions;
  exception when duplicate_object then null;
  end;
end $$;
