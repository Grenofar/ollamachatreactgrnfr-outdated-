-- Avis sur les extensions de la marketplace (v1.0.1).
-- A EXECUTER UNE FOIS dans l'editeur SQL Supabase, comme les migrations
-- precedentes. Re-executable sans erreur.
--
-- Rappel de posture, coherent avec le reste du projet : RLS controle QUI
-- peut ecrire une ligne, pas ce qu'elle contient — d'ou les contraintes de
-- taille et de plage directement sur les colonnes, en plus des policies.

create table if not exists public.extension_reviews (
  id uuid primary key default gen_random_uuid(),
  extension_id uuid not null references public.extensions(id) on delete cascade,
  -- Reference vers profiles et non auth.users : PostgREST a besoin d'une cle
  -- etrangere DIRECTE pour joindre les deux (meme lecon qu'en v0.6.3, ou la
  -- jointure extensions -> profiles echouait sans elle).
  author_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  -- Un seul avis par personne et par extension : sans ca, une meme personne
  -- peut noter en boucle et fausser la moyenne.
  unique (extension_id, author_id)
);

create index if not exists extension_reviews_extension_idx
  on public.extension_reviews (extension_id, created_at desc);

alter table public.extension_reviews enable row level security;

-- Lecture publique : les avis servent a decider avant d'installer.
drop policy if exists "reviews readable by everyone" on public.extension_reviews;
create policy "reviews readable by everyone"
  on public.extension_reviews for select
  to anon, authenticated
  using (true);

-- Ecriture reservee a son propre avis. Contrairement a app_releases et aux
-- versions d'extension (immuables par choix), un avis DOIT pouvoir etre
-- corrige ou retire par son auteur : c'est son opinion, pas un artefact
-- publie.
drop policy if exists "own review insert" on public.extension_reviews;
create policy "own review insert"
  on public.extension_reviews for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "own review update" on public.extension_reviews;
create policy "own review update"
  on public.extension_reviews for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "own review delete" on public.extension_reviews;
create policy "own review delete"
  on public.extension_reviews for delete
  to authenticated
  using (auth.uid() = author_id);

-- Moyenne et nombre d'avis, exposes sans ouvrir une lecture large sur la
-- table elle-meme cote agregation. security definer pour la meme raison que
-- extension_install_count en v0.6.3.
create or replace function public.extension_rating(p_extension_id uuid)
returns table (average numeric, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(avg(rating), 0)::numeric(3,2), count(*)
  from public.extension_reviews
  where extension_id = p_extension_id;
$$;

revoke execute on function public.extension_rating(uuid) from public;
grant execute on function public.extension_rating(uuid) to anon, authenticated;
