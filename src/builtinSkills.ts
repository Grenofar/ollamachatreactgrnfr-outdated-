// Skills shipped with the app, installable in one click from the Skills
// space. "Navigation Basique" exists because almost every Control Me
// request starts the same way — open something, find a field, click a
// result — and re-teaching that from scratch in every session wastes the
// user's time and the model's turns.
//
// Written as instructions the model can follow, not as prose about
// browsers: each line says what to do and how to tell it worked, which is
// what makes a note usable in a later session.

export interface BuiltinSkill {
  name: string;
  description: string;
  content: string;
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "Navigation Basique",
    description: "Se déplacer dans Windows et dans un navigateur (Chrome, Opera, Brave, Edge…).",
    content: `# Navigation de base sous Windows

## Avant tout
- Lis l'interface avant d'agir : les libellés exacts et les positions valent mieux qu'une supposition.
- Après chaque action, vérifie que l'écran a changé comme prévu avant d'enchaîner. Si rien n'a bougé, relis l'interface plutôt que de recliquer au même endroit.
- Une fenêtre qui s'ouvre par-dessus (mise à jour, cookies, notification) doit être traitée avant de continuer : elle prend le focus et fait échouer l'action suivante.

## Ouvrir une application
1. Appuie sur la touche Windows : le menu Démarrer s'ouvre et le curseur est déjà dans la recherche.
2. Tape le nom de l'application.
3. Attends une seconde que la liste se mette à jour, puis appuie sur Entrée.
4. Vérifie que la fenêtre attendue est au premier plan avant de continuer. Une application qui démarre à froid peut prendre plusieurs secondes.

## Gérer les fenêtres
- Alt+Tab bascule entre les fenêtres ouvertes.
- Windows+Flèche gauche / droite colle la fenêtre à une moitié d'écran.
- Windows+Haut agrandit, Windows+Bas réduit.
- Windows+D affiche le bureau.
- Alt+F4 ferme la fenêtre active. Ne l'utilise jamais sans y avoir été invité : un travail non enregistré serait perdu.

## Explorateur de fichiers
- Windows+E l'ouvre.
- Ctrl+L place le curseur dans la barre d'adresse : tape un chemin puis Entrée pour y aller directement, c'est plus fiable que de cliquer dossier par dossier.
- F2 renomme l'élément sélectionné, Suppr le met à la corbeille.

# Navigateurs web

Ces étapes sont identiques dans Chrome, Opera, Brave, Edge, Vivaldi et tout navigateur basé sur Chromium : mêmes raccourcis, même disposition. Elles marchent aussi dans Firefox, à l'exception de détails d'apparence. N'apprends donc pas une procédure par navigateur — applique celle-ci et adapte-toi seulement si un élément n'est visiblement pas au même endroit.

## Aller sur un site
1. Ctrl+L met le curseur dans la barre d'adresse et sélectionne ce qu'elle contient.
2. Tape l'adresse (par exemple wikipedia.org). Pas besoin d'effacer d'abord : la sélection est remplacée.
3. Appuie sur Entrée.
4. Attends que la page ait fini de charger avant de cliquer quoi que ce soit : cliquer pendant le chargement rate souvent la cible, car la mise en page bouge encore.

## Chercher
- La même barre d'adresse fait office de moteur de recherche : Ctrl+L, tape la recherche, Entrée.
- Sur une page de résultats, le premier résultat n'est pas toujours le bon : lis les titres avant de cliquer.
- Ctrl+F cherche un mot dans la page affichée. Utile pour localiser un bouton avant de le cliquer.

## Onglets et navigation
- Ctrl+T ouvre un onglet, Ctrl+W ferme l'onglet courant.
- Ctrl+Tab passe à l'onglet suivant.
- Alt+Flèche gauche revient à la page précédente, Alt+Flèche droite avance.
- F5 recharge la page. À utiliser si une page semble bloquée.

## Bandeaux de cookies et pop-ups
Presque tous les sites en affichent un au premier chargement. Il bloque les clics tant qu'il est là. Cherche un bouton du type « Tout accepter », « Accepter », « J'accepte » ou une croix de fermeture, et traite-le avant de faire quoi que ce soit d'autre. Si le choix engage la personne (paiement, création de compte, acceptation de conditions), demande-lui plutôt que de décider seul.

## Formulaires
- Tab passe au champ suivant, Maj+Tab au précédent.
- Clique le champ, vérifie qu'il a bien le focus, puis tape.
- Entrée valide la plupart des formulaires sans avoir à viser le bouton.
- Ne remplis jamais un mot de passe, un moyen de paiement ou une donnée personnelle de ta propre initiative.

## Quand ça ne marche pas
- L'élément a bougé : relis l'interface, ne réessaie pas au hasard à la même position.
- La page a l'air figée : attends, puis F5.
- Le clic n'a pas d'effet : vérifie que la bonne fenêtre est au premier plan, un clic va toujours à la fenêtre active.
`,
  },
  {
    name: "Farm de jeu",
    description: "Répéter une action dans un jeu : maintenir une touche, enchaîner des appuis, viser.",
    content: `# Farmer dans un jeu

## Ce que tu dois comprendre avant tout

Un jeu ne se pilote pas comme une fenêtre normale. Trois différences qui changent tout :

- **L'interface n'expose rien à l'accessibilité.** La lecture de l'interface ne renverra rien d'utile : un jeu dessine ses propres pixels. Tu dois travailler à partir de l'écran, pas de la liste des contrôles.
- **La durée compte.** Avancer, charger une attaque, tenir une direction : ce sont des actions qui durent. Utiliser « appuyer » puis « relâcher » en deux fois ne marche pas, parce qu'il s'écoule plusieurs secondes entre les deux appels, impossibles à doser. Il faut une action qui maintient pendant une durée précise.
- **Beaucoup de jeux capturent le curseur.** Déplacer la souris à une position absolue n'a alors aucun effet : seul un déplacement relatif fonctionne pour viser.

## Maintenir une touche

C'est l'action centrale du farm.

- maintiens_pendant("z", 3) avance pendant 3 secondes.
- Même principe pour q, s, d, ou n'importe quelle lettre selon les commandes du jeu.
- maintiens_pendant("shift", 2) pour courir, si le jeu utilise Maj.
- Durée maximale : 10 secondes par appel. Pour tenir plus longtemps, enchaîne plusieurs appels.

Demande à la personne quelles touches son jeu utilise avant de supposer. ZQSD et WASD sont les deux dispositions courantes, et se tromper fait partir le personnage dans la mauvaise direction.

## Répéter un appui

- appuie_plusieurs_fois("espace", 10) pour sauter ou valider dix fois.
- Utile pour passer des dialogues, ramasser en boucle, relancer une action rapide.
- Maximum 50 appuis par appel.

## Maintenir un clic

- maintiens_clic(x, y, 4) garde le bouton enfoncé 4 secondes à cette position : tir continu, minage, pêche, charge d'attaque.
- Précise "right" pour le clic droit si le jeu s'en sert pour viser.

## Viser

- deplace_relatif(dx, dy) tourne la caméra. Valeurs négatives vers la gauche et le haut.
- Commence par de petits décalages (50 à 100 pixels) et regarde le résultat avant d'aller plus loin : la sensibilité varie énormément d'un jeu à l'autre.
- N'utilise jamais une position absolue pour viser dans un jeu en vue première personne.

## Une boucle de farm qui tient

1. Demande d'abord ce qu'il faut répéter, et comment savoir qu'un cycle est réussi.
2. Fais **un seul cycle complet** et regarde l'écran.
3. Si le résultat est bon, répète. Sinon, dis ce qui ne colle pas plutôt que de continuer à l'aveugle.
4. Vérifie l'écran régulièrement, pas seulement à la fin : un jeu peut afficher une mort, une déconnexion ou une fenêtre de mise à jour au milieu de la boucle.
5. Si l'écran ne change plus du tout entre deux cycles, arrête-toi et signale-le. Continuer à appuyer dans le vide ne sert à rien.

## Ce que tu ne fais pas de toi-même

- N'accepte aucune condition, ne crée aucun compte, ne valide aucun achat.
- Ne touche pas aux paramètres du jeu sans qu'on te le demande.
- Si une fenêtre inattendue apparaît, décris-la et demande, plutôt que de cliquer pour la faire disparaître.

## Honnêteté sur les limites

Beaucoup de jeux en ligne interdisent l'automatisation dans leurs conditions d'utilisation, et certains la détectent. Préviens la personne de ce risque si le jeu est en ligne — c'est sa décision, mais elle doit la prendre en connaissance de cause.
`,
  },
  {
    name: "Roblox Kayak and Surf",
    description: "But du jeu, boucle de progression et farm pour Kayak and Surf sur Roblox.",
    content: `# Kayak and Surf (Roblox)

## À lire avant d'utiliser ces informations

Ce jeu reçoit des mises à jour fréquentes : les prix, les paliers et les mondes changent. Les **mécaniques** décrites ici sont stables, les **chiffres** peuvent être périmés. Si un montant affiché à l'écran ne correspond pas à ce qui est écrit ici, c'est l'écran qui a raison — dis-le à la personne plutôt que d'insister.

## Le but du jeu

C'est un jeu de grind, pas un jeu d'adresse. La boucle est toujours la même :

1. Tu rames pour **remonter un cours d'eau** et grimper le plus haut possible vers un sommet.
2. Tu **redescends** en kayak depuis le point atteint.
3. Pendant la descente tu **ramasses des pièces**.
4. Tu dépenses ces pièces en améliorations, qui te permettent de remonter plus haut au cycle suivant.

Plus tu montes haut, plus la descente rapporte. Toute la progression consiste à repousser ce point haut.

## Les deux monnaies

- **Coins (pièces)** — ramassées pendant les descentes. C'est ce qui paie les améliorations et les kayaks.
- **Wins (victoires)** — gagnées en atteignant des sommets. C'est ce qui débloque les mondes. Les deux ne sont pas interchangeables : accumuler des pièces ne débloquera jamais un monde.

## Ce qu'on améliore

- **Les statistiques** : à monter en continu, c'est la base. Elles déterminent jusqu'où tu peux remonter le courant.
- **Les kayaks** : par paliers, chacun avec une statistique de vitesse. Les prix montent de façon exponentielle — à titre d'exemple, un kayak de haut niveau se chiffrait en centaines de milliers de milliards de pièces. N'achète pas un palier intermédiaire juste parce qu'il est accessible : vise le meilleur que tu peux réellement atteindre.
- **Les pets** : obtenus en éclosion ou via les spins, ils donnent des bonus passifs permanents.
- **Les boosts** : potion de pièces (augmente le gain) et boost de vitesse. À utiliser au bon moment, pas dès qu'on les a.

## Ordre de priorité pour progresser

1. Monte tes statistiques avant tout le reste : sans elles, un meilleur kayak ne sert à rien.
2. Change de kayak seulement quand tu plafonnes malgré des statistiques améliorées.
3. Active une **potion de pièces avant une grosse session de farm**, jamais après : elle augmente ce que tu ramasses, donc elle ne vaut rien une fois les pièces déjà gagnées.
4. Active un **boost de vitesse sur une session longue**, pas pour une seule descente.
5. Garde les Wins pour débloquer le monde suivant plutôt que de les dépenser ailleurs.

## Les mondes

Le jeu compte plusieurs mondes, débloqués via un **téléporteur situé au bout de la carte**. Le quatrième, Inferno Valley, demandait 100 000 Wins — un objectif de fin de jeu, à n'envisager qu'avec le meilleur équipement du monde précédent. Ne dirige pas la personne vers un monde supérieur tant qu'elle plafonne dans le sien.

## Les codes

Le jeu distribue régulièrement des codes qui donnent des pièces, des spins ou des boosts. Ils expirent. Si la personne veut en profiter, propose-lui d'aller en chercher une liste à jour — ne lui en invente jamais un, un code faux ne fait que perdre du temps.

## Comment farmer ce jeu

Applique le skill « Farm de jeu » pour les actions elles-mêmes (maintenir une touche pour ramer, enchaîner les appuis, viser). Spécifiquement ici :

- Ramer, c'est **maintenir une direction**, pas appuyer une fois. Utilise une action à durée.
- Fais **un cycle complet** (montée, descente, gain) et regarde le résultat avant de boucler.
- Vérifie le compteur de pièces entre deux cycles : s'il ne bouge plus, quelque chose bloque — mort, déconnexion, fenêtre de mise à jour, ou personnage coincé contre un décor.
- Entre deux descentes, repasse par la boutique pour dépenser : laisser les pièces s'accumuler sans les investir ne fait pas progresser.

## Honnêteté

Roblox interdit l'automatisation dans ses conditions d'utilisation, et certains jeux la détectent — un compte peut être sanctionné. Préviens-en la personne avant de lancer une session de farm automatique. C'est sa décision, mais elle doit la prendre en connaissance de cause.
`,
  },
];
