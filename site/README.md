# Site (landing page)

Page statique (HTML/CSS pur, sans dépendance) présentant le projet. Pas
encore de bouton de téléchargement actif : aucun installeur n'est publié
pour l'instant (voir CLAUDE.md à la racine, étape 4 du roadmap).

## Déployer sur Vercel

1. Sur [vercel.com](https://vercel.com), "Add New… → Project".
2. Importer le repo GitHub `Grenofar/ollamachatreactgrnfr` (repo privé : Vercel
   demandera l'autorisation d'accès via GitHub, ça fonctionne aussi sur un
   repo privé — le site déployé, lui, sera public à son URL `*.vercel.app`).
3. Root Directory : `site`
4. Framework Preset : `Other` (aucune commande de build nécessaire)
5. Déployer.

## À faire quand l'installeur existera (étape 4 du roadmap)

Remplacer le bloc "Téléchargement bientôt disponible" dans `index.html` par
un vrai lien vers l'asset de la dernière GitHub Release. Comme le repo est
privé, l'API GitHub publique ne fonctionnera pas depuis le navigateur du
visiteur (elle 404 pour un repo privé sans authentification) — soit le repo
sera rendu public à ce moment-là, soit le lien de téléchargement sera codé en
dur à chaque nouvelle version plutôt que résolu dynamiquement côté client.
