-- Run once in the Supabase SQL editor (project cihuwuiyziarnghethbi).
-- Also requires: Auth > Providers > Google enabled with a real Client
-- ID/Secret (done by the user directly in the Supabase dashboard — this
-- migration only creates the app-side tables, it cannot configure OAuth).
--
-- Comptes/profils/appareils/marketplace d'extensions — le premier vrai
-- système de comptes de ce projet (jusqu'ici entièrement anonyme, anon
-- key partout). Demandé explicitement : login Google, profil (photo +
-- pseudo public unique), plusieurs appareils nommables par compte,
-- bascule "compte développeur", et une marketplace d'extensions avec
-- examen de sécurité par IA avant publication (safe/unsafe), badge
-- officiel/non-officiel, compteur d'installations, versions.
--
-- Le modèle d'exécution des extensions elles-même (ce qu'une extension
-- "fait" réellement) reste volontairement déclaratif dans cette version
-- — pas de code arbitraire exécuté (aucun bac à sable n'existe encore
-- dans ce projet, voir CLAUDE.md pour le raisonnement complet) —
-- `extension_versions.manifest` est un JSON décrivant des ajouts de
-- prompt système / définitions d'outils dans le même esprit que les
-- skills existants, pas un binaire ou un script.

-- ---------------------------------------------------------------------
-- profiles : un par utilisateur Auth. Le pseudo est public et unique
-- (affiché comme auteur d'une extension) ; la photo de profil pointe
-- vers le bucket Storage "avatars" (public, un fichier par utilisateur).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  avatar_url text,
  is_developer boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Format volontairement strict (minuscules/chiffres/underscore, 3-24
-- caractères) : évite les usurpations visuelles (espaces, caractères
-- exotiques) sur un pseudo public affiché comme auteur d'extension.
alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$');

create policy "Public read access" on public.profiles
  for select to anon, authenticated using (true);

create policy "Own profile insert" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

create policy "Own profile update" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- is_developer is part of this same row-level policy — nothing stops a
-- user flipping it themselves via a normal update, which is the intended
-- behavior ("bascule compte développeur" is meant to be self-service, not
-- an admin-gated approval step).

-- ---------------------------------------------------------------------
-- devices : appareils appairés (le code de jumelage existant, voir
-- remote.rs, rattaché à un compte pour lister/renommer/changer entre
-- plusieurs appareils depuis le site). Privé — seul le propriétaire y a
-- accès, jamais listé publiquement.
--
-- owner_id référence profiles(id), PAS auth.users(id) directement : même
-- si profiles.id référence déjà auth.users(id) (donc les mêmes valeurs
-- au final), PostgREST a besoin d'une clé étrangère DIRECTE entre deux
-- tables pour pouvoir les joindre via la syntaxe d'imbrication
-- (`select("...,profiles(username)")` côté extensions, même raisonnement
-- ici même si devices ne l'utilise pas aujourd'hui — cohérence).
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Mon PC',
  pairing_code text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.devices enable row level security;

create policy "Own devices only" on public.devices
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------
-- extensions : métadonnées d'une extension publiée. is_official n'est
-- JAMAIS modifiable par son propriétaire (colonne protégée ci-dessous via
-- GRANT explicite plutôt que RLS seule, RLS ne pouvant pas restreindre
-- colonne par colonne) — seule la clé service_role peut le faire, à la
-- main, après revue manuelle. Reste "non officiel" (orange côté app) par
-- défaut pour toujours, sauf décision explicite du propriétaire du
-- projet.
-- owner_id references profiles(id), not auth.users(id) directly — see the
-- comment on devices.owner_id above for why (PostgREST needs a direct FK
-- to embed profiles(username) in extensions.html's marketplace query).
create table if not exists public.extensions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  is_official boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

alter table public.extensions enable row level security;

create policy "Public read access" on public.extensions
  for select to anon, authenticated using (true);

-- Publier une extension exige le statut développeur — vérifié via une
-- sous-requête sur profiles plutôt que dupliqué côté app (une seule
-- source de vérité, imposée même si un appel direct à l'API REST
-- contournait l'interface).
create policy "Developers can publish" on public.extensions
  for insert to authenticated
  with check (
    auth.uid() = owner_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_developer)
  );

create policy "Owner can edit name/description" on public.extensions
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Column-level privilege: even though the row-level policy above allows
-- an UPDATE on rows the user owns, REVOKE + a narrower GRANT stops
-- is_official from ever being part of that update — the only way RLS can
-- be made to respect "this one column is admin-only" (RLS itself only
-- restricts rows, never columns).
revoke update on public.extensions from authenticated;
grant update (name, description) on public.extensions to authenticated;

-- ---------------------------------------------------------------------
-- extension_versions : contenu versionné, immuable une fois publié
-- (même posture que app_releases/controlme_knowledge_shares — pas de
-- policy update/delete pour authenticated). safety_verdict/reasoning
-- viennent de l'examen Gemini fait côté app avant l'insertion — la ligne
-- n'est créée qu'après un verdict "safe" (un verdict "unsafe" n'insère
-- jamais rien, la publication est simplement refusée côté app).
create table if not exists public.extension_versions (
  id uuid primary key default gen_random_uuid(),
  extension_id uuid not null references public.extensions(id) on delete cascade,
  version text not null,
  manifest jsonb not null,
  safety_verdict text not null default 'safe' check (safety_verdict in ('safe', 'unsafe')),
  safety_reasoning text,
  created_at timestamptz not null default now(),
  unique (extension_id, version)
);

alter table public.extension_versions enable row level security;

create policy "Public read access" on public.extension_versions
  for select to anon, authenticated using (true);

create policy "Extension owner can publish versions" on public.extension_versions
  for insert to authenticated
  with check (
    exists (select 1 from public.extensions e where e.id = extension_id and e.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- extension_installs : une ligne par (extension, appareil) — upsert côté
-- app pour éviter qu'un même appareil ne gonfle artificiellement le
-- compteur en désinstallant/réinstallant. Le compte public affiché est
-- calculé à la demande (count distinct device_id), pas stocké comme un
-- entier à part qui pourrait diverger.
create table if not exists public.extension_installs (
  extension_id uuid not null references public.extensions(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  installed_at timestamptz not null default now(),
  primary key (extension_id, device_id)
);

alter table public.extension_installs enable row level security;

create policy "Device owner can record installs" on public.extension_installs
  for insert to authenticated
  with check (
    exists (select 1 from public.devices d where d.id = device_id and d.owner_id = auth.uid())
  );

create policy "Device owner can remove their install record" on public.extension_installs
  for delete to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id and d.owner_id = auth.uid()));

-- Public, anonymous-callable count — avoids needing a broad SELECT policy
-- on extension_installs (which would let anyone enumerate exactly which
-- devices installed what).
create or replace function public.extension_install_count(p_extension_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.extension_installs where extension_id = p_extension_id;
$$;

grant execute on function public.extension_install_count(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket "avatars", public read, un fichier par utilisateur
-- (chemin conventionnel {user_id}.jpg côté app) — créer le bucket
-- manuellement dans Storage si ce n'est pas déjà fait (public activé),
-- les policies ci-dessous supposent qu'il existe déjà sous le nom
-- "avatars".
create policy "Public avatar read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'avatars');

create policy "Own avatar upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Own avatar update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
