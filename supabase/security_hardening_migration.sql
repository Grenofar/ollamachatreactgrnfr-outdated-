-- À exécuter une fois dans l'éditeur SQL Supabase (projet cihuwuiyziarnghethbi),
-- après les migrations précédentes. Ré-exécutable sans erreur (contraintes
-- supprimées avant d'être recréées, policies dans des blocs DO qui ignorent
-- les doublons).
--
-- Passe de durcissement demandée explicitement. Ce que ça corrige réellement,
-- par ordre de gravité — chaque point était une vraie faille ouverte, pas une
-- précaution théorique :
--
--   1. Aucune limite de taille nulle part. `controlme_knowledge_shares.content`
--      est insérable par le rôle `anon` (seule écriture anon de ce projet,
--      choix documenté) sans le moindre plafond : un seul INSERT de plusieurs
--      centaines de Mo était possible, autant de fois que voulu. Même problème
--      sur description/manifest côté extensions (là au moins il faut un compte
--      développeur, donc moins exposé, mais toujours non borné).
--   2. Compteurs de vues/clics gonflables à l'infini. record_extension_page_view
--      et record_extension_install_click sont `security definer` et appelables
--      par `anon` sans aucune déduplication — n'importe qui pouvait boucler
--      l'appel RPC pour gonfler les statistiques de sa propre extension.
--   3. Champs d'URL non contraints. avatar_url / thumbnail_url / media_url sont
--      réinjectés dans des attributs src ; le XSS stocké a déjà été corrigé
--      côté site (escapeHtml), ceci ferme la même classe de problème côté
--      base, en défense en profondeur : seules des URL https sont acceptées.
--   4. Bucket "avatars" sans limite de taille ni de type MIME (contrairement
--      à "extension-media", déjà limité en v0.7).

-- ---------------------------------------------------------------------
-- 1. Plafonds de taille
-- ---------------------------------------------------------------------

alter table public.controlme_knowledge_shares
  drop constraint if exists knowledge_shares_content_length;
alter table public.controlme_knowledge_shares
  add constraint knowledge_shares_content_length check (char_length(content) <= 200000);

alter table public.controlme_knowledge_shares
  drop constraint if exists knowledge_shares_name_length;
alter table public.controlme_knowledge_shares
  add constraint knowledge_shares_name_length check (char_length(name) <= 200);

alter table public.controlme_knowledge_shares
  drop constraint if exists knowledge_shares_description_length;
alter table public.controlme_knowledge_shares
  add constraint knowledge_shares_description_length check (char_length(description) <= 2000);

alter table public.extensions drop constraint if exists extensions_name_length;
alter table public.extensions
  add constraint extensions_name_length check (char_length(name) <= 120);

alter table public.extensions drop constraint if exists extensions_description_length;
alter table public.extensions
  add constraint extensions_description_length check (char_length(description) <= 20000);

-- Le manifeste porte le contenu réel d'une extension (system_prompt_addition
-- + commandes personnalisées) — généreux mais borné.
alter table public.extension_versions drop constraint if exists extension_versions_manifest_size;
alter table public.extension_versions
  add constraint extension_versions_manifest_size check (length(manifest::text) <= 200000);

alter table public.extension_versions drop constraint if exists extension_versions_version_length;
alter table public.extension_versions
  add constraint extension_versions_version_length check (char_length(version) <= 40);

-- ---------------------------------------------------------------------
-- 2. URL : https uniquement
-- ---------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_avatar_url_https;
alter table public.profiles
  add constraint profiles_avatar_url_https
  check (avatar_url is null or avatar_url ~ '^https://');

alter table public.extensions drop constraint if exists extensions_thumbnail_url_https;
alter table public.extensions
  add constraint extensions_thumbnail_url_https
  check (thumbnail_url is null or thumbnail_url ~ '^https://');

alter table public.extension_media drop constraint if exists extension_media_url_https;
alter table public.extension_media
  add constraint extension_media_url_https check (media_url ~ '^https://');

-- ---------------------------------------------------------------------
-- 3. Compteurs : déduplication par appelant et par jour
--
-- PostgREST expose les en-têtes de la requête au SQL via le GUC
-- `request.headers`, ce qui permet de dédupliquer par IP côté serveur alors
-- même que l'appelant n'est pas authentifié — la seule façon de rendre ces
-- compteurs non gonflables sans exiger un compte. L'IP n'est jamais stockée
-- en clair : seul son md5 (avec un sel constant) sert de clé de
-- déduplication, ce qui suffit pour "cette même personne a-t-elle déjà été
-- comptée aujourd'hui" sans conserver de donnée personnelle exploitable.
--
-- Repli délibéré : si l'en-tête est absent (appel direct hors PostgREST,
-- configuration inattendue), on incrémente sans déduplication plutôt que de
-- ne plus rien compter du tout — dégrader vers l'ancien comportement vaut
-- mieux que casser la fonctionnalité.
-- ---------------------------------------------------------------------

create table if not exists public.extension_counter_dedupe (
  extension_id uuid not null references public.extensions(id) on delete cascade,
  kind text not null check (kind in ('view', 'install_click')),
  viewer_hash text not null,
  day date not null default current_date,
  primary key (extension_id, kind, viewer_hash, day)
);

alter table public.extension_counter_dedupe enable row level security;
-- Aucune policy : la table n'est jamais lue ni écrite directement par
-- `anon`/`authenticated`, uniquement par les fonctions `security definer`
-- ci-dessous (qui contournent la RLS par définition). RLS activée quand même
-- pour que l'absence de policy fasse office de refus explicite.

create or replace function public.caller_hash()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw text;
begin
  begin
    raw := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  exception when others then
    raw := null;
  end;
  if raw is null or raw = '' then
    return null;
  end if;
  return md5('ollamachat-counter-salt|' || raw);
end;
$$;

create or replace function public.record_extension_page_view(p_extension_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hash text := public.caller_hash();
begin
  if hash is null then
    update public.extensions
      set page_view_count = page_view_count + 1
      where id = p_extension_id;
    return;
  end if;

  insert into public.extension_counter_dedupe (extension_id, kind, viewer_hash)
    values (p_extension_id, 'view', hash)
    on conflict do nothing;

  if found then
    update public.extensions
      set page_view_count = page_view_count + 1
      where id = p_extension_id;
  end if;
end;
$$;

create or replace function public.record_extension_install_click(p_extension_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hash text := public.caller_hash();
begin
  if hash is null then
    update public.extensions
      set install_click_count = install_click_count + 1
      where id = p_extension_id;
    return;
  end if;

  insert into public.extension_counter_dedupe (extension_id, kind, viewer_hash)
    values (p_extension_id, 'install_click', hash)
    on conflict do nothing;

  if found then
    update public.extensions
      set install_click_count = install_click_count + 1
      where id = p_extension_id;
  end if;
end;
$$;

grant execute on function public.record_extension_page_view(uuid) to anon, authenticated;
grant execute on function public.record_extension_install_click(uuid) to anon, authenticated;
-- caller_hash est un détail interne des deux fonctions ci-dessus : jamais
-- appelable directement, pour ne pas offrir un oracle de hash sur l'IP.
-- `from public` est indispensable en plus des deux rôles : Postgres accorde
-- EXECUTE à PUBLIC par défaut sur toute nouvelle fonction, donc ne révoquer
-- que anon/authenticated laisserait le droit hérité de PUBLIC intact.
revoke execute on function public.caller_hash() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Bucket "avatars" : mêmes garde-fous que "extension-media"
-- ---------------------------------------------------------------------

update storage.buckets
  set file_size_limit = 2097152,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
  where id = 'avatars';
