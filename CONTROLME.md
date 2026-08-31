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

Gemini dispose aussi d'un second outil, `read_ui_elements` : il peut lire la
liste des boutons/champs/textes visibles dans la fenêtre au premier plan
(sans capture d'écran) quand il a besoin d'un libellé exact ou d'une
position précise — plus rapide qu'une capture pour ce genre de vérification.
C'est lui qui décide quand s'en servir, ce n'est pas systématique. Entre
chaque action, l'app attend que l'écran ait fini de bouger avant de
recapturer (au lieu d'un délai fixe) — plus rapide quand l'interface a déjà
réagi, plus fiable quand elle met plus de temps.

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

## Quand Gemini demande une confirmation

Sur une action qu'il juge particulièrement sensible (transaction
financière, création de compte, modification de données importantes...),
Gemini fait une pause et affiche directement dans la conversation ce qu'il
veut faire et pourquoi. Deux boutons : **Confirmer** (l'action s'exécute,
la session continue normalement) ou **Refuser** (l'action est annulée, la
session continue quand même — Gemini s'adapte à ton refus au lieu de
s'arrêter).

## Mémoire

Control Me peut retenir des faits durables sur toi (ton rôle, les
logiciels que tu utilises, tes habitudes) d'une session à l'autre, quand
il juge que c'est utile sur le long terme — pas de contrôle de ta part
fait par fait, c'est lui qui décide quoi retenir. Le bouton **Mémoire** en
haut de l'app te montre tout ce qui a été enregistré, avec un bouton pour
tout effacer d'un coup. Ces faits restent uniquement sur ton PC (fichier
local) ; ils sont réinjectés dans le contexte au début de chaque nouvelle
instruction pour que Gemini en tienne compte.

## Historique des sessions

Tes sessions (tes instructions et ce que l'IA a fait) sont sauvegardées
automatiquement sur ton PC — elles ne disparaissent plus en fermant l'app.
Le bouton **Historique** en haut te permet de relire une ancienne session
ou de la supprimer. Le bouton **Nouvelle session** démarre une conversation
vide sans perdre celle en cours (elle reste dans l'historique). Un champ de
recherche dans le panneau Historique filtre par titre ou par contenu, et un
double-clic sur le titre d'une session permet de la renommer.

## Lancement au démarrage de Windows

Une case à cocher en haut de l'app active/désactive le lancement
automatique au démarrage de Windows — pratique pour un outil censé être
disponible à tout moment.

## Contrôle à distance depuis le site

Tu peux aussi piloter Control Me depuis un navigateur, sur la page
`/controlremote` du site (lien depuis la page d'accueil) — pratique pour
lancer une instruction depuis ton téléphone pendant que ton PC tourne.
Dans Réglages → Control Me, génère un **code à 12 chiffres**,
saisis-le une fois sur le site : il se reconnecte automatiquement à chaque
visite ensuite (bouton **Se déconnecter** pour jumeler un autre code). Une
fois connecté, le site affiche ton écran en direct, une zone de chat pour
donner des instructions, et un bouton **Arrêter**. Le bouton **Mémoire**
montre aussi, depuis le site, ce que l'IA a retenu sur toi — la même
mémoire que dans l'app, avec un bouton pour tout effacer.

**Traite ce code comme un mot de passe** : toute personne qui le connaît
peut voir ton écran et contrôler ton PC depuis n'importe où. Le site
bloque un navigateur après 5 codes invalides essayés (protection
locale au navigateur, pas infaillible — voir `CLAUDE.md` pour le détail).
Régénère le code si tu penses qu'il a pu fuiter.

**Limite actuelle** : le bouton pour générer un code vit dans les Réglages
de l'**application de chat principale** (page pleine, section Control Me) —
pas encore exposé dans la barre du haut minimale du build Control Me
**standalone**, même si le fonctionnement à distance lui-même marche pour
les deux (même code Rust). Si tu utilises uniquement Control Me standalone,
génère le code une fois depuis l'app de chat principale si tu l'as aussi
installée ; sinon cette fonctionnalité n'est pas encore accessible pour toi.

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

Choix dans le menu déroulant en haut de l'app : Gemini 3.5 Flash-Lite
(recommandé par défaut ici), 3.7 Flash, 3.5 Flash, ou 3.6 Flash. À noter :
Google documente 3.7 Flash comme "le modèle recommandé pour le contrôle
d'ordinateur" spécifiquement — le choix de 3.5 Flash-Lite comme
recommandation par défaut dans cette app est une préférence assumée
(rapidité/coût), pas la recommandation de Google. 3.6 Flash n'est pas
documenté par Google comme compatible avec cette fonctionnalité ; il reste
sélectionnable, mais une session pourrait échouer avec ce modèle.
