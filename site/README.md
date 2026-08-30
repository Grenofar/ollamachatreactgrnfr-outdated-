# Site (landing page)

Page statique (HTML/CSS/JS pur, sans dépendance, sans étape de build)
présentant le projet et permettant d'installer l'application — pas une
version web de l'app elle-même, juste la présentation + le lien
d'installation.

Le bouton "Installer" est piloté par Supabase (lecture seule, clé anon en
clair dans `index.html` — voir CLAUDE.md à la racine, section Décisions
techniques, sur pourquoi c'est correct pour une clé anon). Tant que la table
`app_releases` est vide ou n'existe pas encore (voir `../supabase/schema.sql`),
le bouton affiche "Bientôt disponible" ; dès qu'une ligne existe, il devient
un vrai lien de téléchargement vers `download_url`. Aucune action manuelle
n'est nécessaire ici quand une nouvelle version est publiée : ajouter la
ligne dans Supabase suffit, le site (et l'app) se mettent à jour tout seuls.

## Déployer sur Vercel

1. Sur [vercel.com](https://vercel.com), "Add New… → Project".
2. Importer le repo GitHub `Grenofar/ollamachatreactgrnfr` (repo privé : Vercel
   demandera l'autorisation d'accès via GitHub, ça fonctionne aussi sur un
   repo privé — le site déployé, lui, sera public à son URL `*.vercel.app`).
3. Root Directory : `site`
4. Framework Preset : `Other` (aucune commande de build nécessaire)
5. Déployer. Pas de variables d'environnement à configurer (voir plus haut).

## Point encore ouvert : où héberger le fichier d'installeur

Le dépôt GitHub est privé, donc un asset de GitHub Release n'y serait pas
téléchargeable anonymement. Avant de publier une première version dans
`app_releases`, `download_url` doit pointer vers un fichier réellement
accessible publiquement (ex. Supabase Storage, ou rendre le dépôt public au
moment de la release) — voir CLAUDE.md, étape 4 du roadmap.
