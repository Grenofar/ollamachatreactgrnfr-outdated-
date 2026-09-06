-- Skills publics identifies par leur NOM, plus par un code (v1.0.2).
-- A EXECUTER UNE FOIS dans l'editeur SQL Supabase. Re-executable sans erreur.
--
-- Le code de partage obligeait a transmettre une suite de caracteres a la
-- main pour installer un skill. On installe desormais par nom, choisi dans
-- la liste — d'ou l'unicite, sans laquelle deux skills homonymes rendraient
-- l'installation ambigue.
--
-- L'unicite est posee ICI et pas seulement dans l'app : une verification
-- cote client n'empeche rien (deux publications simultanees passeraient
-- toutes les deux), seule une contrainte de base garantit la regle.

-- Insensible a la casse et aux espaces de bord : "Navigation Basique" et
-- "navigation basique " sont le meme nom pour un humain, et laisser passer
-- les deux recreerait exactement l'ambiguite qu'on supprime.
create unique index if not exists controlme_knowledge_shares_name_unique
  on public.controlme_knowledge_shares (lower(btrim(name)));

-- share_code devient facultatif : les lignes deja publiees le gardent, les
-- nouvelles n'en ont plus. Supprimer la colonne casserait les installations
-- faites avant cette version, qui referencent encore leur code.
do $$
begin
  alter table public.controlme_knowledge_shares alter column share_code drop not null;
exception
  when others then null; -- deja nullable, ou colonne absente
end $$;

-- Republier son propre skill doit pouvoir ecraser la version publiee, sinon
-- la contrainte d'unicite bloque toute mise a jour et le seul recours est de
-- republier sous un autre nom. Pas de notion de proprietaire sur cette table
-- (elle est anterieure aux comptes), donc l'ecriture reste ouverte a anon —
-- limite reelle, deja documentee depuis l'introduction de la table : qui
-- connait le nom peut ecraser le contenu publie sous ce nom.
drop policy if exists "shares updatable by anon" on public.controlme_knowledge_shares;
create policy "shares updatable by anon"
  on public.controlme_knowledge_shares for update
  to anon, authenticated
  using (true)
  with check (true);
