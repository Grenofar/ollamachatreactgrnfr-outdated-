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
];
