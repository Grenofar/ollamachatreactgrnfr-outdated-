-- Proprietaire sur les skills publics (v1.0.2).
-- A EXECUTER UNE FOIS dans l'editeur SQL Supabase, APRES
-- skill_name_unique_migration.sql. Re-executable sans erreur.
--
-- Pourquoi maintenant : cette table est nee avant le systeme de comptes,
-- donc sans notion de proprietaire, et l'ecriture y etait ouverte au role
-- anon. La migration precedente y a ajoute l'update (necessaire pour que
-- republier son propre skill mette a jour la copie publiee au lieu d'etre
-- rejete par l'index unique) — ce qui rendait le trou plus large : qui
-- connaissait un nom pouvait ecraser le contenu publie sous ce nom.
-- Les comptes existent depuis la v1.0.1, on peut enfin refermer.

alter table public.controlme_knowledge_shares
  add column if not exists owner_id uuid references public.profiles(id) on delete set null;

-- Publier exige desormais d'etre connecte et de s'attribuer la ligne.
-- L'ancienne policy d'insertion anon est retiree : sans ca, elle resterait
-- une porte ouverte a cote de la nouvelle (les policies s'additionnent, la
-- plus permissive gagne).
drop policy if exists "Public insert (anon can publish)" on public.controlme_knowledge_shares;
drop policy if exists "shares insert by owner" on public.controlme_knowledge_shares;
create policy "shares insert by owner"
  on public.controlme_knowledge_shares for insert
  to authenticated
  with check (auth.uid() = owner_id);

-- Mise a jour reservee au proprietaire. Les lignes publiees avant cette
-- migration ont owner_id a null : elles ne correspondent donc a aucun
-- auth.uid() et deviennent VERROUILLEES — personne ne peut plus les
-- modifier, y compris leur auteur d'origine, qu'aucune donnee ne permet
-- d'identifier. C'est volontaire : les laisser modifiables par n'importe
-- qui serait exactement le trou qu'on ferme. Pour reprendre la main sur un
-- ancien skill, le republier depuis l'app sous un nouveau nom.
drop policy if exists "shares updatable by anon" on public.controlme_knowledge_shares;
drop policy if exists "shares update by owner" on public.controlme_knowledge_shares;
create policy "shares update by owner"
  on public.controlme_knowledge_shares for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Depublier reellement devient possible, pour son propre skill uniquement.
-- Jusqu'ici "rendre prive" n'agissait qu'en local et laissait la copie
-- publique en ligne pour toujours — limite documentee depuis la v0.6.0,
-- levee ici pour les skills qui ont un proprietaire.
drop policy if exists "shares delete by owner" on public.controlme_knowledge_shares;
create policy "shares delete by owner"
  on public.controlme_knowledge_shares for delete
  to authenticated
  using (auth.uid() = owner_id);

-- La lecture reste publique : c'est ce qui permet de parcourir et
-- d'installer un skill sans compte.
