# Control Me

Une IA (Google Gemini) qui contrôle directement ta souris et ton clavier à
partir de captures d'écran de ton PC, pour automatiser des tâches — ouvrir
une appli, remplir un formulaire, cliquer à travers une suite d'étapes —
sans que tu aies à le faire toi-même.

Ce document couvre la version **installable séparément** de Control Me.
Control Me existe aussi comme un espace à l'intérieur de l'application de
chat Ollama plus large de ce dépôt (`CLAUDE.md`) ; les deux partagent
exactement le même code, seule l'interface autour change.

## Comment ça marche

1. Tu donnes une instruction en langage naturel ("ouvre le Bloc-notes et
   écris bonjour").
2. L'app prend une capture de ton écran et l'envoie à Gemini avec ton
   instruction.
3. Gemini répond avec une action précise (cliquer à telles coordonnées,
   taper du texte, appuyer sur une touche, faire défiler...).
4. L'app exécute réellement cette action sur ton PC.
5. Nouvelle capture d'écran, et ça recommence, jusqu'à ce que Gemini estime
   avoir terminé.

## Ce qu'il faut savoir avant d'installer

- **Contrôle autonome, sans confirmation par action.** Contrairement à un
  outil qui demanderait ton accord avant chaque clic, Control Me agit
  directement. Le seul frein est le bouton **Stop**, toujours visible
  pendant qu'une instruction s'exécute — plus un garde-fou intégré à
  Gemini lui-même : s'il juge une action particulièrement sensible
  (transaction financière, création de compte, modification de données
  importantes...), il s'arrête et te le signale au lieu de continuer.
- **Des captures d'écran partent vers les serveurs de Google, à chaque
  étape.** Tout ce qui est visible à l'écran pendant une session — pas
  seulement l'application que tu contrôles — est envoyé, pas seulement du
  texte. Si tu as des informations sensibles à l'écran, ferme-les ou
  déplace-les hors champ avant de lancer une instruction.
- **Une IA qui contrôle ton clavier/souris peut faire n'importe quoi que tu
  pourrais faire toi-même sur ce PC**, y compris dans des comptes déjà
  connectés. Commence toujours par une instruction simple et sans
  conséquence pour voir comment ça se comporte avant de lui confier
  quelque chose d'important.

## Installation

Tu as besoin de ta propre clé API Gemini (obtenue sur Google AI Studio) —
l'app n'en fournit aucune. Une fois l'app installée et lancée, un bouton
"Clé API Gemini" en haut te permet de la renseigner.

## Mises à jour

Comme l'application de chat Ollama de ce même dépôt, Control Me se met à
jour tout seul (`tauri-plugin-updater`) — pas besoin de retélécharger
l'installeur à chaque nouvelle version, sauf pour la toute première
installation.

## Modèle Gemini utilisé

Choix dans le menu déroulant en haut de l'app : Gemini 3.5 Flash-Lite, 3.5
Flash, 3.6 Flash, ou 3.7 Flash (recommandé — c'est le seul explicitement
optimisé par Google pour le contrôle d'ordinateur). 3.6 Flash n'est pas
documenté par Google comme compatible avec cette fonctionnalité ; il reste
sélectionnable, mais une session pourrait échouer avec ce modèle.
