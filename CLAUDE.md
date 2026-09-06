# ollama-chat-react — feuille de route vivante

Client de chat pour Ollama (local), en Tauri v2 + React 19 + TypeScript, étendu
avec une fonctionnalité **Codex** : un éditeur de code façon VS Code où un
modèle Ollama agit en agent (façon Claude Code) sur le PC de l'utilisateur.

Ce fichier est un document vivant : mets-le à jour à chaque changement notable
(nouvelle fonctionnalité, décision technique, risque découvert). Ne le laisse
pas devenir obsolète.

## Statut actuel

- [FAIT] Chat Ollama de base (conversations, réglages, installation de modèles, recherche Hugging Face)
- [FAIT] Éditeur Codex : agent outillé (6 outils), Monaco, bascule Auto/Approbation
- [FAIT] `npm run build` (tsc + vite) et `cargo check` passent à 0 erreur
- [FAIT] Dépôt git initialisé et poussé sur GitHub (`Grenofar/ollamachatreactgrnfr`, dépôt **privé**)
- [FAIT] Landing page statique dans `site/` — présentation minimale + comment ça marche + note SmartScreen + bouton de téléchargement (conseil de modèle retiré du site, déplacé dans l'app, voir plus bas)
- [FAIT] Création de fichier inline dans Codex (toolbar + par dossier), génération annulable (chat et Codex) avec bouton animé
- [FAIT] Menu de modèle repensé (`ModelSelect`, recherche + taille/quantization affichées) dans le chat et Codex, à la place du `<select>` HTML brut
- [FAIT] Navigateur de modèles Hugging Face branché dans l'app (il existait mais n'était appelé nulle part) : parcours élargi par défaut, recommandation par RAM système détectée
- [À FAIRE] Connecter `site/` à Vercel (étape manuelle côté utilisateur, voir `site/README.md`)
- [FAIT] Supabase en lecture seule branché ET table `app_releases` créée + peuplée (site : fetch client-side ; app : voir auto-update ci-dessous)
- [FAIT] Premier installeur construit (`npm run tauri build`, NSIS+MSI) et publié : v0.1.0 hébergée sur Supabase Storage (bucket public `releases`), lien de téléchargement fonctionnel de bout en bout
- [FAIT] **Auto-update en continu** (`tauri-plugin-updater`) — depuis v0.3.0, "Vérifier les mises à jour" télécharge, installe et redémarre l'app toute seule, sans navigateur ni Supabase ouvert manuellement. Voir section dédiée plus bas pour le détail (signature cryptographique, endpoint RPC Supabase, `.env`).
- [FAIT] v0.3.1 : correctif du bug d'en-têtes Supabase (v0.3.0 était cassée pour l'auto-update, voir "Bug corrigé en v0.3.1" plus bas) + notification automatique (toast, coin bas-droit) quand une mise à jour est disponible, sans avoir besoin d'ouvrir Réglages — publiée et vérifiée de bout en bout via la clé anon (fichier + endpoint RPC).
- [À FAIRE] Signature de code (SmartScreen affiche "Éditeur inconnu" tant que ce n'est pas fait — décision explicite de l'utilisateur le 2026-08-30 de ne rien faire pour l'instant, voir Décisions techniques)
- [FAIT] Rendu Markdown réel dans le chat (`marked` + `DOMPurify`), avec coloration/copie de bloc de code préservées
- [FAIT] Éditer un message envoyé (tronque et renvoie) et régénérer la dernière réponse
- [FAIT] Renommer (double-clic) et rechercher une conversation dans la Sidebar
- [FAIT] Désinstaller un modèle installé, depuis les Réglages
- [FAIT] Taille/position de la fenêtre persistées entre les lancements (`tauri-plugin-window-state`)
- [FAIT] Compteurs de tokens : par conversation, budget de contexte ("mémoire") utilisé vs `max_context_tokens`, total toutes conversations confondues
- [FAIT] Site : avertissement "app de bureau, consommateur de ressources" + calculateur de config (RAM saisie manuellement, calcul déterministe côté client, pas d'appel réseau)
- [FAIT] Site élargi (560px → 820px), calculateur enrichi (menu GPU NVIDIA/AMD avec VRAM connue, niveau de processeur)
- [FAIT] Bug corrigé : `reqwest` sans backend TLS cassait tout appel HTTPS (`check_for_update`, `search_hf_models`) — voir Limites connues
- [FAIT] Bug corrigé : `ModelSelect` s'ouvrait hors écran dans Codex (panneau pensé pour un déclencheur en bas de page, réutilisé dans l'en-tête en haut) — nouvelle prop `direction`
- [FAIT] RAM système détectée une seule fois au démarrage (au lieu de respawn PowerShell à chaque ouverture du navigateur Hugging Face) + timeout ajouté sur la recherche HF, contre le ralentissement perçu signalé par l'utilisateur
- [FAIT] Système anti-gel — couvre maintenant le chat de base ET Codex (`agent_chat` a été converti pour streamer en interne, voir Architecture > Codex), scopé pour ne jamais se déclencher pendant une écriture de fichier
- [FAIT] Recherche de conversation par contenu (pas juste le titre), `search_conversations` côté Rust
- [FAIT] Brouillon de message par conversation (au lieu d'un seul brouillon global partagé)
- [FAIT] Régénérer une réponse avec un modèle différent (utilise le modèle actuellement sélectionné dans le menu, pas forcément celui de la conversation)
- [FAIT] Icône dans la zone de notification (system tray) : fermer la fenêtre (X) minimise au lieu de quitter ; quitter réellement se fait depuis le menu de l'icône
- [FAIT] v0.3.2 : correctif du freeze de ~5s au démarrage (timeout manquant sur la vérif de mise à jour + `get_system_ram_gb` synchrone/bloquant, voir "Freeze au démarrage" plus bas) + refonte de l'affichage Codex façon Claude Code dans VS Code (texte en direct, statut d'outil visible, sortie de commande live, approbation inline au lieu d'une modale plein écran qui masquait le chat, fichier édité auto-ouvert) — voir "Streaming visuel dans Codex" dans Architecture
- [FAIT] v0.3.3 : correctif "l'IA ne sait pas/ne peut pas lancer de commande" dans Codex — system prompt renforcé (accès réel explicite, interdiction de répondre "je ne peux pas" au lieu d'appeler l'outil) + race condition réelle corrigée dans `runCommandAndCollect` (listeners d'événements shell pas attendus avant le lancement de la commande, pouvait bloquer indéfiniment) — voir "L'IA ne sait pas/ne peut pas lancer de commande" dans Architecture
- [FAIT] v0.3.4 : fallback markdown pour l'exécution de commande (le modèle écrit parfois la commande dans un bloc ```powershell au lieu d'un vrai tool_call — maintenant détecté et exécuté comme un vrai outil, boucle continue automatiquement) + system prompt généralisé à tous les outils (pas juste les commandes) + Ctrl+S corrigé (WebView2 interceptait le raccourci nativement avant que la page ne le reçoive, rien n'était jamais sauvegardé) — voir "Toujours un souci l'IA ne peut pas + Ctrl+S cassé" dans Architecture
- [FAIT, première version] **Control Me** : nouvel espace dans l'app (bouton Sidebar, comme Codex) où une IA (Gemini, modèle choisi par l'utilisateur — 3.5 Flash-Lite/3.5 Flash/3.6 Flash/3.7 Flash, voir v0.4.2 — via l'Interactions API de Google + son outil intégré `computer_use`) contrôle **de façon autonome** la souris et le clavier de l'utilisateur à partir de captures d'écran, avec un bouton Stop comme seul garde-fou (+ le `safety_decision` de Gemini lui-même, respecté). Rompt délibérément "rien ne sort de l'app" (captures d'écran envoyées à Google) — voir "Control Me" dans Architecture et la section Confidentialité réseau mise à jour. Clé API Gemini propre à l'utilisateur (Réglages), jamais fournie par l'app. Pas encore testé en conditions réelles (nécessite la clé de l'utilisateur) ; l'overlay séparé + raccourci global F5 du plan initial n'est pas encore construit, cette version vit dans la fenêtre principale comme Codex.
- [FAIT] v0.4.1 : Control Me signalé "trop long" par l'utilisateur après premier test (captures d'écran + réflexion Gemini) — captures redimensionnées et compressées en JPEG (au lieu de PNG pleine résolution), `thinking_level: "low"`, délai de stabilisation réduit — voir "Optimisation vitesse (v0.4.1)" dans Architecture > Control Me.
- [FAIT] v0.4.2 : sélecteur de modèle Gemini dans Control Me (3.5 Flash-Lite/3.5 Flash/3.6 Flash/3.7 Flash), persisté dans les réglages — voir "Sélecteur de modèle (v0.4.2)" dans Architecture > Control Me. Note : 3.6 Flash n'est pas documenté par Google comme compatible avec `computer_use`, laissé sélectionnable quand même (demandé explicitement) mais signalé dans le menu.
- [FAIT] v0.5.0 : Control Me installable **séparément** de l'app de chat, même mécanisme de mise à jour/setup, bouton dédié sur le site, doc autonome `CONTROLME.md` — voir "Control Me : produit installable séparément (v0.5.0)" dans Architecture > Control Me pour le détail complet (config Tauri alternative fusionnée par-dessus la config de base, pas de duplication de code, colonne `product` sur `app_releases`). **Migration SQL à exécuter par l'utilisateur avant de considérer le site à jour** — sans elle, le bouton de téléchargement existant de l'app de chat casse aussi.
- [FAIT] v0.5.1 : Control Me — confirmation `require_confirmation` désormais inline (reprend la session en place au lieu de tout arrêter), mémoire IA type RAG simplifiée où **l'IA décide elle-même** quoi retenir sur l'utilisateur via un outil `remember_fact` (panneau "Mémoire" pour voir/tout effacer), lancement au démarrage de Windows (build standalone) — voir "Confirmation inline, mémoire IA, lancement au démarrage" dans Architecture > Control Me.
- [FAIT] v0.5.2 : correctif critique Supabase (`latest_release_manifest` ambigu après la migration `product`, cassait l'auto-update de l'app de chat pour de vrai — `drop function` manquant, voir journal 2026-08-31) + modèle Gemini recommandé par défaut changé vers `gemini-3.5-flash-lite` (contredit la recommandation de Google, assumé et documenté).
- [FAIT] v0.5.3 : historique des sessions Control Me — les conversations ne disparaissent plus à la fermeture, sauvegardées automatiquement (même pattern que les conversations du chat), boutons "Nouvelle session"/"Historique" pour relire ou supprimer une ancienne session — voir "Historique des sessions Control Me (v0.5.3)" dans Architecture > Control Me.
- [FAIT] v0.5.4 : recherche dans l'historique Control Me (titre + contenu, `search_control_me_sessions`), renommage d'une session (double-clic, comme la Sidebar du chat), et navigation simplifiée — plus de bouton dédié "← Chat" dans Codex/Control Me, cliquer un élément de la Sidebar (nouvelle conversation ou conversation existante) y ramène directement — voir "Recherche/renommage de session, retrait du bouton retour (v0.5.4)" dans Architecture > Control Me.
- [FAIT] v0.5.5 : passe d'animations sur toute l'app (CSS uniquement, aucune dépendance ajoutée) — micro-interactions de boutons, halo de focus sur les champs, entrée en fondu/décalage des bulles de chat et cartes d'outils avec effet cascade, indicateur de frappe animé + curseur clignotant pendant le streaming, transition de vue chat/Codex/Control Me, ouverture animée des modales/dropdowns/panneaux, toast de mise à jour avec rebond, accent visuel sur la conversation/section active dans la Sidebar, scrollbar personnalisée — respecte `prefers-reduced-motion`. Voir "Animations et micro-interactions (v0.5.5)" dans Architecture.
- [FAIT] v0.5.6 : Control Me plus rapide et plus fiable — attente adaptative après chaque action (remplace le délai fixe de 120ms par une détection locale de stabilisation de l'écran) et nouvel outil `read_ui_elements` (Gemini peut lire l'arbre d'accessibilité Windows de la fenêtre au premier plan — type/libellé/état/position des contrôles — sans capture d'écran, en complément de `computer_use`) — voir "Attente adaptative et lecture de l'arbre d'accessibilité (v0.5.6)" dans Architecture > Control Me.
- [FAIT] v0.5.7 : Control Me pilotable **à distance depuis le site** (`site/controlremote.html`, lien depuis la landing) — code de jumelage à 12 chiffres généré dans l'app, écran live + chat + mémoire + bouton Arrêter côté navigateur, tout via Supabase **Realtime** (Broadcast + Presence, aucune table Postgres, client WebSocket écrit à la main côté Rust) — voir "Control Me à distance depuis le site (v0.5.7)" et "Mémoire visible depuis le site distant (v0.5.7)" dans Architecture > Control Me, y compris le modèle de sécurité (code = mot de passe partagé, protection anti-brute-force côté navigateur assumée comme non absolue). Réglages **entièrement refaits en page pleine** à sections (Général/Modèles + Installer un modèle/Control Me/Mises à jour), `SettingsModal.tsx` supprimé au profit de `SettingsView.tsx`, bouton "Installer un modèle" déplacé de la Sidebar vers Réglages — voir "Réglages en page pleine (v0.5.7)". Deux correctifs Control Me au passage : `key_down` qui ne faisait rien (bug réel d'enigo, `release_keys_when_dropped`) et `read_ui_elements` qui n'apportait plus son gain de vitesse (capturait quand même un screenshot inutile) — voir "Correctifs de vitesse et de fiabilité (v0.5.7)". Nouveau **mode de perception "Windows UI"** (toggle Réglages > Control Me, `capture` vs `windows_ui`) : `computer_use` entièrement retiré et remplacé par des outils `function` personnalisés reproduisant le même jeu d'actions — plus aucune capture d'écran envoyée, juste du texte d'accessibilité, mais perte du garde-fou `require_confirmation` (propre au protocole `computer_use`) — voir "Mode de perception Windows UI (v0.5.7)". Nouvelle **extension "DB ready for Control Me"** (espace Extensions dédié, Sidebar) : dossier local caché (`.txt`/`.json`/`.sql` uniquement, validation qui refuse le dossier en bloc si un seul fichier a un autre type) que Control Me peut lire comme base de connaissances via un nouvel outil `read_knowledge_base`, plus un flux de **publication publique via Supabase** (première écriture `anon` de tout ce projet, jusqu'ici strictement lecture seule — RLS et implications documentées explicitement) — voir "Base de connaissances Control Me (v0.5.7)".
- [FAIT] v0.5.8 : correctif critique — générer un code de jumelage à distance (ou simplement relancer l'app avec un code déjà enregistré) faisait planter l'app **définitivement**, à chaque lancement, signalé par l'utilisateur juste après la publication de la v0.5.7. `remote.rs` appelait `tokio::spawn` directement au lieu de `tauri::async_runtime::spawn` ; appelé depuis le thread principal (hook `setup()`, via `resume_remote_on_startup`), `tokio::spawn` panique faute de runtime "entré" sur ce thread — panic sur le thread principal = tout le processus meurt, et comme le code reste dans `settings.json`, ça se reproduisait à chaque démarrage — voir "Panic de démarrage sur le thread principal (v0.5.8)" dans Architecture > Control Me. Extensions restructuré en hub léger : Codex et Control Me apparaissent maintenant comme des cartes dans l'espace Extensions (bouton "Ouvrir", en plus de leur bouton Sidebar dédié qui reste) avec un interrupteur Activer/Désactiver réversible (masque juste l'entrée Sidebar, rien n'est réellement désinstallé — un seul binaire, pas de vrais modules indépendants), plus un bouton unique "Tout mettre à jour" (pas de fausse mise à jour par extension, une seule vraie mise à jour existe : l'app entière) — voir "Extensions : hub léger (v0.5.8)" dans Architecture. Correctif CSS global : plusieurs boutons ajoutés au fil des dernières versions (approbation inline Codex, en-tête/confirmation Control Me, tout l'espace Extensions) n'étaient couverts par aucun sélecteur et s'affichaient avec le chrome brut du navigateur — corrigé par un style de base sur l'élément `button` global (`:where()` pour les variantes `:hover`/`:disabled`/`:active`, afin de ne jamais l'emporter sur un sélecteur de classe plus spécifique déjà existant) — voir "Correctif CSS boutons non stylés (v0.5.8)" dans Architecture.
- [FAIT] v0.6.0 : session de travail autonome de nuit (l'utilisateur a donné une longue liste de demandes puis est allé se coucher, en demandant explicitement de poser toute question tout de suite ou de continuer seul sinon — aucune ambiguïté bloquante identifiée, tout implémenté avec des décisions de scope documentées ci-dessous plutôt que deviné en silence). Contenu, dans l'ordre de priorité suivi : (1) site distant en 404 — lien `/controlremote` sans extension, `cleanUrls` manquant dans `vercel.json`, corrigé ; (2) **vrai bug Ctrl+S dans Codex** trouvé (closure figée dans `EditorPane.tsx`, pas juste le souci WebView2 déjà corrigé en v0.3.4 — voir "Ctrl+S enregistrait du contenu périmé (v0.6.0)") ; (3) le petit cmd qui flashait au démarrage — `get_system_ram_gb` (et les autres process PowerShell) sans `CREATE_NO_WINDOW`, corrigé ; (4) **Réglages/Extensions restructurés** : Control Me n'a plus sa propre section Réglages, ses réglages (modèle/clé API/mode de perception) sont maintenant sous une icône ⚙ sur sa carte dans Réglages > Extensions, qui gagne aussi le bouton "Tout mettre à jour" (déplacé depuis l'espace Extensions, qui gagne à la place une recherche) et une case pour désactiver le popup de mise à jour — voir "Réglages/Extensions restructurés (v0.6.0)" ; (5) **refonte complète de "DB ready" en "DB skill for Control Me"** : skills multiples nommés+décrits (plus un seul tas de fichiers), sélection de quel(s) skill(s) fournir avant une session Control Me, bouton "Extraire les informations" (l'IA résume une session passée en mise à jour du skill), navigateur de skills publics en plus du code, "Désinstaller" qui supprime réellement le fichier local (contrairement à Codex/Control Me) — voir "DB skill for Control Me (v0.6.0)" ; (6) **refonte complète du contrôle à distance** : un seul code de jumelage (Réglages > Appareils connectés, plus de section dédiée à Control Me) donne accès à un chat avec le modèle Ollama du PC **et** à Control Me (si activé) depuis le même onglet du site, relayés sur le même canal Realtime — voir "Chat distant unifié avec Control Me (v0.6.0)" ; (7) mode Windows UI branché automatiquement pour toute session Control Me déclenchée à distance, avec vérification explicite qu'aucun appel LLM n'a lieu pour la simple lecture de l'interface — voir la même section ; (8) markdown rendu dans les entrées "étape" de Control Me (texte brut avant, astérisques/backticks affichés tels quels). **Scope volontairement pas couvert, documenté plutôt que deviné** : pas de vrai système générique d'espace Sidebar par extension installée (juste l'espace Skills existant, bien organisé) ; pas de système de skills pour Codex (uniquement Control Me, comme nommé) ; passe d'animations générale limitée aux nouveaux panneaux (réutilisation de `panel-open` existant), pas une repasse complète de l'app.
- [FAIT] v0.6.1 : **le contrôle à distance depuis le site n'avait, en réalité,
  jamais fonctionné depuis son introduction en v0.5.7** — signalé par
  l'utilisateur ("même si je mets le bon code, ça dit que le code est
  incorrect"), corrigé et **vérifié empiriquement pour de vrai cette
  fois** (pas juste par lecture de code) en connectant un client
  `@supabase/supabase-js` réel à côté d'une reproduction du client Rust
  et en diffant ce que chacun envoie réellement sur le fil. Trois bugs
  distincts dans `remote.rs`, tous corrigés : mauvaise version de
  protocole (`vsn=1.0.0` au lieu de `2.0.0`, le join n'obtenait jamais la
  moindre réponse) ; payload de join incomplet (`postgres_changes`/
  `private` manquants, silencieusement rejeté) ; **aucun message de
  présence "track" explicite envoyé** après le join (l'app rejoignait le
  canal mais n'apparaissait jamais dans la présence, donc "hôte" restait
  invisible pour le site) ; et **les broadcasts utilisent un format
  binaire propriétaire**, pas du JSON texte comme tout le reste du
  protocole — ni l'envoi ni la réception ne géraient ce format, donc même
  une fois la connexion établie, rien (écran, chat, étapes Control Me)
  n'aurait pu passer. Voir "Le vrai bug du contrôle à distance : protocole
  Realtime jamais fonctionnel (v0.6.1)" dans Architecture pour le détail
  technique complet, la méthode de découverte, et la portée de ce que ça
  implique pour les versions précédentes. Deux demandes complémentaires
  traitées dans la même passe : "DB skill for Control Me" a maintenant son
  propre espace dédié dans la Sidebar (`SkillsView.tsx`, extrait de
  `ExtensionsView.tsx` qui ne garde plus que les cartes Codex/Control Me)
  plutôt que d'être une carte parmi d'autres ; et la sélection de skill(s)
  avant une session Control Me, jusque-là seulement disponible dans l'app
  locale, fonctionne maintenant aussi depuis l'onglet Control Me du site
  (nouveau broadcast `list_skills`/`skills`, case à cocher par skill,
  inclus dans le broadcast `instruction`).
- [FAIT] v0.6.2 : lot de correctifs après premier vrai test du site distant
  et de Codex. **Vrai bug de Codex trouvé et corrigé** — testé pour de vrai
  contre le serveur Ollama réellement installé (`qwen2.5-coder:3b`) plutôt
  que supposé réparé par les correctifs précédents (v0.3.3/v0.3.4) : le
  modèle n'utilise jamais le champ `tool_calls` structuré, il écrit
  l'appel d'outil en JSON texte brut dans sa réponse, sans bloc de code —
  ni le tool-calling normal ni le filet de secours markdown existant ne
  l'attrapaient. Nouveau second filet de secours (`extractFallbackJsonToolCall`)
  qui reconnaît ce JSON, y compris mal formé (valeur imbriquée un niveau
  trop profond, observé tel quel) — voir "Deuxième bug réel de Codex :
  tool_calls jamais structuré (v0.6.2)" dans Architecture. Corrections
  groupées : texte illisible (noir sur noir) dans le chat du site ; écran
  distant à 10 img/s au lieu d'1 (60 demandé mais irréaliste en bande
  passante, expliqué) ; bouton Envoyer bleu/rouge clean (au lieu de gris/
  gris) partout où il apparaît (chat, Codex, Control Me, site) ; Windows UI
  choisi par défaut pour Control Me (au lieu de capture d'écran) ; flash
  de petite fenêtre au démarrage corrigé (fenêtre cachée jusqu'à être
  prête, avec un filet de sécurité pour ne jamais rester invisible en cas
  d'erreur) ; Codex légèrement plus "VS Code" (badges de couleur par type
  de fichier, barre de statut bleue en bas) ; page d'accueil du site
  remplace le simple lien texte par une vraie section "Interface pour
  appareil connecté" expliquant ce qu'on peut y faire ; Skills réordonné
  au-dessus d'Extensions dans la Sidebar.
- [FAIT, v1 volontairement scopée] v0.6.3 : premier vrai système de
  comptes de ce projet (Google OAuth via Supabase Auth, configuré par
  l'utilisateur lui-même côté dashboard Supabase) — profils (pseudo public
  unique, photo recadrée automatiquement), appareils multiples nommables/
  changeables depuis le site, bascule "compte développeur" (interrupteur
  animé), espace développeur (`/dev`) pour publier des extensions avec
  examen de sécurité automatique par Gemini 3.7 avant publication
  (refusée si jugée dangereuse), marketplace publique (`/extensions`,
  recherche, badge officiel/non-officiel, compteur d'installations), et
  côté app une commande pour installer une extension Control Me depuis la
  marketplace avec double confirmation (confiance au créateur + à tes
  risques et périls, app non responsable). Voir "Comptes et marketplace
  d'extensions (v0.6.3)" dans Architecture pour le détail complet,
  notamment **la décision assumée de ne PAS exécuter de code arbitraire**
  dans cette version — un vrai bac à sable (WASM) serait un chantier de
  plusieurs semaines à lui seul, pas construit ce soir ; une extension est
  pour l'instant un ajout déclaratif au prompt système, dans le même
  esprit que les skills existants, avec la même revue Gemini. Deux vrais
  bugs trouvés et corrigés en relisant le code avant publication (pas
  après) : la jointure PostgREST `extensions → profiles` aurait échoué (clé
  étrangère manquante, corrigée dans la migration avant qu'elle ne soit
  jamais exécutée) et l'upload d'avatar aurait été systématiquement
  rejeté par une policy Storage mal alignée avec le chemin de fichier
  utilisé. `cargo check`/`npx tsc --noEmit` passés à 0 erreur. **Aucune
  vérification de bout en bout possible dans cet environnement**
  (connexion Google réelle, upload Storage, appel Gemini de revue —
  aucun testable sans navigateur) — à tester explicitement par
  l'utilisateur après exécution de la migration SQL.
- **[FAIT] v0.7 : refonte du site façon GitHub + installation d'extension
  en un clic depuis le navigateur.** Page dédiée par extension
  (`/extension.html?id=...` — résumé court, photo d'impression, galerie
  photos/vidéos, compteurs vues/clics/installations séparés), grille de
  recherche à deux colonnes (`/extensions`), bouton "Ajouter" qui installe
  automatiquement dans l'app via un lien `ollamachat://` (deep link OS,
  `tauri-plugin-deep-link` + `tauri-plugin-single-instance`), landing page
  refaite avec compteur temps réel (comptes/extensions, Supabase Realtime)
  et explication du système d'extensions — RAM calculator, téléchargement
  Control Me seul et "Interface pour appareil connecté" retirés de la
  landing (repliés dans le menu du compte). Menu du compte restructuré :
  avatar Google réel par défaut (plus de dicebear tant qu'aucune photo
  n'est uploadée), panneau "Notre compte" partagé par toutes les pages,
  bascule développeur directement dans le menu, déconnexion en rouge.
  Nouvelle documentation extensive (`/docs`) avec une bibliothèque de
  fonctions nommées (`clique()`, `tape()`, `raccourci()`...) pour décrire
  précisément une action Control Me dans le texte d'une extension. Voir
  "Marketplace v0.7" dans Architecture pour le détail technique complet.
- **[FAIT] v0.7.1 : passe UI/sécurité sur le site + nouvelles commandes
  clavier Control Me.** Vrai bug XSS stocké trouvé et corrigé (nom/
  description/résumé/photo d'une extension, pseudo/avatar d'un auteur —
  injectés sans échappement dans `innerHTML` sur les pages marketplace,
  n'importe quel compte développeur pouvait y placer du HTML/JS actif) ;
  nouvel export `escapeHtml()` dans `account.js`, appliqué partout où du
  contenu venant d'un autre compte est affiché. Formulaire de publication
  (`/dev`) enrichi : champs fichier restylés (le natif ne se stylait pas),
  contenu importable depuis un `.txt`/`.md` en plus de la saisie directe,
  nouveau champ **commandes personnalisées** (`manifest.custom_commands`)
  pour qu'une extension définisse son propre vocabulaire au-delà de la
  bibliothèque commune, clé API Gemini mémorisée dans le navigateur
  (`localStorage`, plus besoin de la retaper), et repli automatique et
  silencieux vers `gemini-3.6-flash` si `gemini-3.7-flash` échoue à
  l'examen de sécurité (3.7 visiblement sujet à des limites de débit en
  usage réel). `docs.html` retravaillée : les annotations révélant les
  noms d'outils internes exacts (`click`, `read_ui_elements`...) sont
  retirées (demande explicite de ne pas exposer comment le chat/Control
  Me sont construits en interne), nouvelle section sur les commandes
  personnalisées, et un prompt copiable prêt à coller dans une IA
  (Claude, ChatGPT...) pour qu'elle génère une extension valide. Passe
  UI générale via `account.js` (chargé par toutes les pages) : fond en
  dégradé au lieu d'une couleur plate, transitions/hover sur tous les
  boutons et liens (`.link-btn` pour les liens texte qui agissaient
  comme actions principales), animations d'entrée, et un vrai menu
  mobile (`mountMobileNav`) qui remplace la nav du header par un bouton
  compact plutôt que de la laisser se tasser — repéré au passage le même
  bug de cascade CSS `[hidden]`/`display` que le correctif précédent sur
  `.account-menu`, corrigé préventivement sur le nouveau menu mobile
  avant publication. Control Me gagne des noms de touche manquants
  (`capslock`, `insert`, `f1`-`f12` — `windows`/`ctrl`/`shift`/`alt`
  existaient déjà, vérifié dans le code avant de conclure qu'ils
  manquaient) et des descriptions d'outils plus explicites sur les
  combinaisons de touches et le texte/emoji (déjà supporté par enigo côté
  Windows via de vrais surrogate pairs UTF-16, vérifié dans son code
  source — aucun changement Rust nécessaire pour ça, seulement la
  documentation). `cargo check`/`npx tsc --noEmit` à 0 erreur, JS de
  chaque page vérifié avec `node --check`. Voir "Passe UI/sécurité et
  commandes clavier (v0.7.1)" dans Architecture pour le détail complet.
- **[FAIT] v0.7.2 : deuxième passe UI, uniquement présentation** — bascule
  jour/nuit sur les 6 pages du site (animation en cercle via la View
  Transitions API, recherche web faite avant d'implémenter), fond en
  dégradé animé façon mesh-gradient (site **et** app), écran de démarrage
  animé dans l'app, chargement à effet shimmer sur les pages qui
  attendent Supabase, compteurs de la landing qui comptent en montant,
  entrée en cascade des cartes d'extension, révélation au scroll
  (au lieu d'une animation groupée au chargement). Un vrai bug de
  contraste trouvé et corrigé avant publication (pas après) : plusieurs
  badges avaient un fond sombre fixe pairé à un texte thémé — correct en
  thème sombre, illisible (texte sombre sur fond sombre) une fois le
  thème clair ajouté. Voir "Bascule jour/nuit et fond animé (v0.7.2)"
  dans Architecture pour le détail complet.
- **[FAIT] v0.7.3** : correctif de l'écran de démarrage qui pouvait rester
  bloqué (minuteur de disparition découplé du chargement des données —
  voir "Écran de démarrage découplé du chargement (v0.7.3)" dans
  Architecture), sélecteur de version sur le bouton Installer du site,
  plusieurs correctifs de superposition CSS.
- **[FAIT] v0.7.4 : sécurité** — recherche/installation de modèles
  Hugging Face désactivée temporairement (flag `HF_DISABLED`) suite à un
  incident de sécurité signalé chez Hugging Face, et retrait de
  l'ouverture automatique du navigateur de modèles au premier lancement
  sans modèle installé (elle contactait Hugging Face sans la moindre
  action de l'utilisateur). Voir "Désactivation temporaire de Hugging
  Face (v0.7.4)" dans Architecture.
- **[FAIT] v0.7.5 : entrée/sortie vocale (chat et Control Me) + raccourci
  clavier global** — bouton micro (dictée, Web Speech API du navigateur,
  aucune dépendance ajoutée) dans le chat et Control Me, bouton "lire à
  voix haute" sur les réponses de l'assistant, et un raccourci global
  (Ctrl+Alt+O) qui ramène la fenêtre au premier plan depuis n'importe où
  (crate `global-hotkey`, pas le plugin officiel — sa partie JS
  demanderait un `npm install`, explicitement exclu cette session suite
  à une inquiétude de sécurité de la chaîne d'approvisionnement npm
  signalée par l'utilisateur). Voir "Voix et raccourci clavier global
  (v0.7.5)" dans Architecture pour le détail complet.
- **[FAIT] v0.8.0 : Control Me peut regrouper plusieurs actions Gemini par
  tour, en bascule explicite (pas le seul comportement)** — une première
  version forcée pour tout le monde (publiée en interne sous le nom
  v0.7.6, jamais diffusée) a été annulée (`git revert`) et refaite en
  vrai réglage après retour explicite de l'utilisateur : nouveau réglage
  `control_me_action_mode` ("live", par défaut, une action à la fois —
  ou "predefined", plusieurs actions par tour), même famille que le
  bascule `control_me_perception_mode` déjà existant (capture/Windows
  UI). Voir "Actions Control Me groupées par tour, en bascule (v0.8.0)"
  dans Architecture pour le détail complet. **Note importante : le build
  de la v0.8.0 n'a jamais abouti** (processus figé plusieurs heures,
  aucun installeur produit, nettoyé ensuite) — ce bascule n'a donc été
  réellement livré à l'utilisateur qu'avec la v0.9.0.
- **[FAIT] v0.9.0 : mode conversation vocale, passe de sécurité, et
  mesure réelle du goulot de Control Me** — (1) un vrai mode mains libres
  qui remplace le fil de discussion par une conversation entre deux
  participants, avec tour de parole automatique, dans le chat comme dans
  Control Me ; (2) durcissement du site (en-têtes/CSP), de l'app (CSP du
  webview, qui était désactivée depuis toujours) et de la base (plafonds
  de taille, compteurs dédupliqués, URL contraintes) ; (3) le "c'est la
  latence Gemini" enfin **mesuré** au lieu d'être supposé, avec un banc
  d'essai gardé dans le dépôt — et une "optimisation" manuel-de-l'art
  écartée parce qu'elle mesurait 20× pire que l'existant. Voir les trois
  sections dédiées dans Architecture.
- **[FAIT] v0.9.1 : micro qui n'entendait rien, skills gérés depuis
  Control Me, actions à durée** — (1) cause racine réelle du bug micro
  trouvée côté Rust, pas côté JS : WebView2 conditionne l'accès au micro
  à sa propre invite de permission, et une fois celle-ci refusée/ignorée
  **la page ne peut plus jamais la redemander** ; (2) le bouton
  haut-parleur par message est retiré (la lecture à voix haute passe
  désormais uniquement par le mode conversation vocale) ; (3) le mode
  vocal ne devient plus muet quand le micro échoue — l'IA annonce à voix
  haute pourquoi elle n'entend plus, et une saisie clavier de secours
  garde la conversation vivante avec les réponses toujours dites à voix
  haute ; (4) les skills se créent/renomment/enrichissent/suppriment
  directement depuis le panneau Skills de Control Me, dont la création
  « depuis cette conversation » où l'IA relit la session et note ce
  qu'elle a appris ; (5) cinq nouvelles actions à durée (`hold_key`,
  `hold_mouse`, `press_key_repeat`, `move_relative`, `scroll_at`),
  disponibles dans les **deux** modes de perception. Voir "Micro, skills
  dans Control Me et actions à durée (v0.9.1)" dans Architecture.
- **[FAIT] v0.9.2 : enregistrement dans un skill pendant la conversation,
  panneau Audio, et troisième passe mesurée sur Codex** — (1) on arme un
  skill depuis Control Me, **y compris avant d'avoir parlé**, et l'IA y
  écrit ce qu'elle juge important au fil de la conversation (outil
  `add_to_skill`), avec Arrêter (conserve) et Annuler (supprime ou
  restaure) ; (2) nouveau panneau Réglages > Audio : autorisation micro,
  appareils d'entrée, **niveau sonore en direct**, test de reconnaissance
  et test de voix — c'est le diagnostic qui manquait pour distinguer les
  trois causes possibles de "le micro ne m'entend pas" ; (3) Codex sondé
  contre le vrai Ollama pour la troisième fois, trois défauts réels
  corrigés (JSON brut affiché comme un message, formes d'appel manquées,
  dépliage absent sur les appels structurés) — et une conclusion trop
  hâtive rectifiée dans la même session, documentation comprise. Voir
  "Enregistrement dans un skill (v0.9.2)" et "Troisieme passe sur Codex,
  mesuree (v0.9.2)" dans Architecture.
- **[FAIT] v1.0.0 : mode apprentissage, skills par conversation, Codex connaît son dossier, choix du micro** — (1) **« Apprendre un nouveau skill »** : une séance où la personne *explique* une procédure (aller sur un site, s'en servir, enchaîner des étapes) et où l'IA écoute, pose des questions et consigne chaque étape au lieu d'exécuter — distinct de l'enregistrement de la v0.9.2, qui notait ce qu'elle faisait pendant qu'elle agissait ; (2) Réglages > Extensions > Control Me liste les **skills utilisés par conversation**, avec un bouton pour enrichir un skill à partir de la conversation qui l'a exercé ; (3) Codex reçoit enfin le dossier ouvert ; (4) choix du micro dans Réglages > Audio ; (5) cinq correctifs d'audit. Voir "Mode apprentissage (v1.0.0)" dans Architecture.

## Architecture

### Animations et micro-interactions (v0.5.5)

Demandé explicitement : "il faut qu'il y ai des animations, dans l'app, il
faut que ca soit impressionant en terme d'interface". Avant ce travail,
`App.css` (1600 lignes) ne contenait quasiment aucune transition/animation
(2 `transition` isolées + 1 seul `@keyframes`) — tous les changements d'état
(hover, ouverture de modale, nouveau message) étaient instantanés. Passe
**CSS uniquement, aucune dépendance ajoutée** (pas de framer-motion) —
cohérent avec la préférence du projet d'éviter les dépendances superflues
(même logique de sobriété que la leçon `image`/AVIF de Control Me), et une
lib d'animation React est inutile pour des transitions d'état/entrée
déclaratives comme celles-ci.

- **Système global** (`:root`, en haut d'`App.css`) : deux variables
  d'easing (`--ease-out`, `--ease-spring`), un bloc
  `@media (prefers-reduced-motion: reduce)` qui écrase toute durée
  d'animation/transition à quasi zéro (accessibilité — non négociable dès
  qu'on ajoute des animations, pas une finition optionnelle).
- **Boutons, partout, en une seule règle** : `button { transition:
  background/color/border-color/opacity/box-shadow/transform; }` (élément
  brut, spécificité volontairement basse) + `button:active:not(:disabled)
  { transform: scale(0.96); }`. Comme aucun bouton du projet sauf
  `.send-btn` ne déclarait déjà sa propre `transition` (vérifié par grep
  avant d'écrire la règle — un raccourci CSS `transition` ne fusionne
  jamais avec un autre, la règle la plus spécifique gagne entièrement),
  cette seule règle globale lisse instantanément des dizaines de boutons
  dans toute l'app (Sidebar, modales, Codex, Control Me, FileTree...) sans
  avoir à toucher chacun individuellement. `.send-btn` a son `transform`
  explicitement ajouté à sa propre liste `transition` pour ne pas le
  perdre (sa règle plus spécifique l'aurait sinon totalement remplacée).
- **Champs de saisie** : halo de focus bleu générique (`input:focus,
  textarea:focus:not(.inputarea), select:focus`) — le `:not(.inputarea)`
  évite d'affecter le textarea caché de Monaco. `.input-pill` (barre de
  saisie du chat/Control Me) a son propre halo `:focus-within` sur le
  conteneur arrondi plutôt que sur le textarea interne sans bordure
  (visuellement plus cohérent avec la forme en pilule).
- **Entrée des bulles de chat avec effet cascade** : `.bubble-row {
  animation: bubble-in ...; animation-delay: calc(min(var(--i,0),12) *
  30ms); }` — `--i` est une custom property CSS posée sur le conteneur
  parent (`style={{"--i": i}}`, `.message-row` dans App.tsx, le div par
  message dans `AgentTranscript.tsx`, chaque entrée dans
  `ControlMeView.tsx`) et **hérite** naturellement vers l'enfant
  `.bubble-row` (comportement standard des custom properties CSS,
  contrairement aux propriétés normales). Plafonné à 12 pour qu'une
  conversation de 200 messages ne cascade pas sur plusieurs secondes.
  `App.tsx` : la liste de messages est enveloppée dans un
  `<div key={currentConv?.id} className="chat-messages">`
  (`display: contents` — invisible pour le layout flex, sert uniquement de
  frontière de remount) pour que changer de conversation **rejoue tout le
  cascade** au lieu de ne réanimer que les messages au-delà de la longueur
  de l'ancienne conversation (React réutilise les nœuds DOM à clé `i`
  identique sinon).
- **Indicateur de frappe et curseur de streaming**
  (`MessageBubble.tsx`, nouvelle prop `streaming?: boolean`) : le
  placeholder `"· · ·"` n'est plus injecté tel quel dans le HTML markdown
  (impossible à animer proprement, ce n'est que du texte) — quand
  `streaming && content === "· · ·"`, un vrai indicateur `.typing-dots` à
  3 points rebondissants est rendu à la place. Une fois que du texte
  réel commence à arriver, `.bubble-streaming::after` ajoute un curseur
  clignotant en fin de bulle. Branché aux trois bulles "live" existantes
  (chat de base, `AgentTranscript.tsx` de Codex) ; Control Me n'a pas
  d'équivalent streaming token-par-token (ses événements sont des étapes
  discrètes, pas des chunks), donc pas de prop `streaming` là — seul le
  cascade `--i` s'applique à ses entrées.
- **Transition de vue** : `.main`/`.codex`/`.controlme` (les trois racines
  alternées dans `App.tsx` selon `view`) ont chacune `animation: view-in`
  (fondu simple) — se déclenche naturellement puisque changer de vue
  démonte/remonte un arbre de composants entièrement différent, aucun
  changement JS nécessaire.
- **Ouverture animée** : modales (`.modal-overlay`/`.modal`, couvre
  Réglages/HuggingFaceBrowser/AskQuestion/l'avertissement anti-gel — une
  seule paire de classes partagée par tous), toast de mise à jour
  (`.update-toast`, rebond via `--ease-spring`), dropdown de modèle
  (`.model-select-panel`, `transform-origin` différent selon qu'il s'ouvre
  vers le haut ou le bas), panneaux Mémoire/Historique de Control Me
  (`.controlme-memory-panel`), approbation inline et confirmation Control
  Me (`.tool-approval-inline`/`.controlme-confirm` — cette dernière avec en
  plus un halo ambré `confirm-glow` qui pulse en continu tant qu'elle est
  affichée, pour attirer l'œil sur une décision qui attend une réponse).
- **Détails Codex** : chevron de dossier dans `FileTree.tsx` (glyphe fixe
  "▸" qui tourne à 90° via `transform` au lieu de swapper vers "▾" — même
  traitement pour le chevron de `ModelSelect.tsx`, rotation 180°) ; cartes
  d'outil (`.tool-card`) avec la même entrée en cascade que les bulles,
  plus une transition de `border-color` pour que le passage
  running→terminé ne soit plus un changement de couleur instantané ;
  onglets d'éditeur (`.editor-tab`) avec hover ajouté (n'en avait aucun) et
  bouton de fermeture avec feedback de clic.
- **Accent de navigation** : `Sidebar.tsx` reçoit maintenant une prop
  `view` (déjà présente dans `App.tsx`, jamais transmise avant) pour
  surligner les boutons "Codex"/"Control Me" quand cette vue est active —
  ils n'avaient jusque-là aucun état actif visible, contrairement aux
  conversations. La conversation active a aussi gagné une barre d'accent
  bleue (`box-shadow: inset`) en plus de son fond déjà existant.
- **Scrollbar personnalisée** (`::-webkit-scrollbar` global) — la
  scrollbar Windows par défaut de WebView2 tranchait visuellement avec le
  reste de l'interface sombre.
- Vérifié via `npx tsc --noEmit`, `cargo check` et `npm run build` (tsc +
  vite, 0 erreur) — **pas de vérification visuelle possible dans cet
  environnement** (pas d'accès GUI, voir les limitations déjà notées pour
  le freeze de démarrage v0.3.2) : à confirmer par l'utilisateur après
  installation que le rendu correspond à l'intention.

### Chat (base)
- `src/api.ts` : appels Tauri (`invoke`) vers les commandes Rust.
- `src-tauri/src/commands/chat.rs` : liste des modèles (nom + taille + parameter_size + quantization_level, pas juste le nom), envoi de message (streaming), annulation, installation **et désinstallation** de modèle (`delete_model`, `DELETE /api/delete`).
- `src/components/MessageBubble.tsx` : rendu Markdown réel via `marked` (renderer personnalisé pour les blocs de code, garde le bouton "Copier" existant) + `DOMPurify.sanitize` (avec `data-code` autorisé) avant `dangerouslySetInnerHTML` — nécessaire dès qu'on injecte du HTML généré, même localement.
- `App.tsx` : éditer un message utilisateur (tronque l'historique après lui, renvoie) et régénérer la dernière réponse assistant (retire ce message, renvoie la même requête) partagent une fonction `submitToOllama` commune avec `handleSend`.
- Compteurs de tokens (App.tsx) : par conversation (`messages.reduce` sur `tokens`), budget de contexte via `trimMessagesToBudget` (ce qui serait réellement envoyé au modèle), total global en sommant `ConversationMeta.total_tokens` (calculé côté Rust dans `list_conversations`, pas besoin de recharger chaque conversation).
- `tauri-plugin-window-state` : persistance automatique taille/position/maximisé de la fenêtre, aucune config front nécessaire (le plugin réagit aux événements de fenêtre côté Rust).
- `src/components/Sidebar.tsx` : renommage par double-clic sur le titre (input inline, Entrée valide/Échap ou blur annule — même pattern que la création de fichier dans `FileTree`), recherche **serveur** (debounce 200ms) via `search_conversations` — cherche dans le titre ET le contenu des messages, pas juste le titre affiché (les titres sont auto-générés depuis les ~40 premiers caractères du premier message, donc une recherche titre-seul ratait la plupart d'une vieille conversation).
- `App.tsx` : brouillon de message par conversation (`draftsRef`, une `Map<id, texte>` hors du state React — changer de conversation en cours de frappe sauvegarde/restaure le bon brouillon au lieu de partager un seul brouillon global). `handleRegenerate` utilise le modèle **actuellement sélectionné** dans `ModelSelect`, pas forcément celui de la conversation — change le modèle dans le menu puis clique "Régénérer" pour reformuler avec un autre modèle.
- System tray (`lib.rs`, feature Cargo `tray-icon`) : fermer la fenêtre (X) la cache au lieu de quitter (`WindowEvent::CloseRequested` → `api.prevent_close()` + `window.hide()`) ; l'icône dans la zone de notification a un menu "Afficher"/"Quitter", et un clic gauche dessus réaffiche aussi la fenêtre. Quitter réellement passe par `app.exit(0)` (menu tray, ou `close_app` du watchdog).
- `tauri-plugin-updater` + `tauri-plugin-process` : auto-update en continu, voir la section dédiée "Auto-update en continu" plus bas pour le détail complet (signature, endpoint RPC Supabase, en-têtes via le `Builder` Rust). État de vérif (`check()`/`downloadAndInstall()`/`relaunch()`) **lifté dans `App.tsx`**, pas dans `SettingsModal.tsx` — une seule source de vérité pour éviter deux `Update` indépendants qui se marcheraient dessus. Deux consommateurs de ce même état : (1) `SettingsModal` (bouton manuel "Vérifier les mises à jour", reçoit tout en props) et (2) un toast discret (`.update-toast`, coin bas-droit, pas une modale bloquante) déclenché par une vérif automatique au démarrage (`UPDATE_CHECK_DELAY_MS`, 5s après le lancement) puis périodique (`UPDATE_CHECK_INTERVAL_MS`, 4h — l'app peut maintenant vivre longtemps dans le tray). "Plus tard" sur le toast mémorise `dismissedUpdateVersion` (pas de nouvelle relance tant qu'aucune version plus récente n'est détectée, plutôt que de renaguer toutes les 4h pour la même version). Le toast se masque si Réglages est ouvert (évite le doublon d'UI).
- `src-tauri/src/commands/hardware.rs` : `get_system_ram_gb`, RAM totale via une commande PowerShell one-shot (pas de crate `sysinfo` ajoutée pour ça) — volontairement pas de détection GPU/VRAM, peu fiable sous Windows (drivers rapportent souvent des valeurs plafonnées/fausses). Commande **async** (`tokio::process::Command`, feature `process` ajoutée à `tokio`) depuis la v0.3.2, pas `std::process::Command` synchrone — voir "Bug corrigé en v0.3.2" plus bas.
- `src/components/ModelSelect.tsx` : menu déroulant de modèle (recherche, affiche parameter_size/quantization/taille), partagé entre le chat de base et Codex, remplace le `<select>` HTML natif. Prop `direction` (`"up"` par défaut pour la barre du bas du chat, `"down"` pour l'en-tête de Codex) — sans elle le panneau s'ouvre hors écran quand le déclencheur est en haut de page.
- `src-tauri/src/commands/watchdog.rs` : système anti-gel, voir section dédiée plus bas.
- `src-tauri/src/commands/conversations.rs` : persistance JSON locale des conversations.
- `src-tauri/src/commands/settings.rs` : réglages persistés en JSON local (`Settings` : host Ollama, contexte max, prompt système, modèle par défaut, mode Codex, dernier dossier Codex).
- `src-tauri/src/commands/huggingface.rs` : recherche publique sur le Hub Hugging Face (filtrée GGUF, 50 résultats, recherche vide acceptée → tendances par téléchargements) ; l'installation réutilise `install_model` avec la référence `hf.co/<repo>`.
- `src/components/codex/HuggingFaceBrowser.tsx` : modale "Installer un modèle" (bouton Sidebar) — charge les modèles tendance au montage, badge "Adapté à ta RAM"/"Volumineux pour ta RAM" par modèle (règle : paramètres max recommandés ≈ RAM(Go) × 1,75, cohérent avec l'ancien conseil par défaut d'`InstallPanel`), section repliable pour installer une référence exacte. Remplace `InstallPanel.tsx` (supprimé) qui n'offrait que la saisie manuelle.

### Codex (agent de codage local)
- `src/agentTools.ts` : schémas des 6 outils exposés au modèle + `CODEX_SYSTEM_PROMPT`.
- `src/hooks/useAgentLoop.ts` : boucle agentique — appelle le modèle, exécute les tool_calls un par un, rappelle le modèle avec les résultats, jusqu'à une réponse sans tool_calls (plafond `MAX_AGENT_ITERATIONS = 25`, avec une confirmation utilisateur pour continuer au-delà).
- `src-tauri/src/commands/agent.rs` : `agent_chat`, appel à `/api/chat` d'Ollama avec le paramètre `tools` (function calling façon OpenAI). Envoie `stream: true` à Ollama et lit la réponse chunk par chunk (NDJSON, même format que `send_chat`). Le contrat public (la commande ne résout qu'une fois, avec l'`AgentChatResponse` complet — content accumulé + tool_calls) **n'a pas changé**, mais depuis la v0.3.2 chaque chunk de contenu est **aussi** émis en direct via l'événement `agent-chat-chunk` (`{ content }`), purement additif — voir "Streaming visuel dans Codex" plus bas. Le contenu se concatène chunk par chunk ; pour `tool_calls`, Ollama envoie le tableau complet d'un coup (pas construit incrémentalement token par token), donc c'est "le dernier tableau non-vide vu gagne", pas une fusion. Async + annulable via `AgentCancelFlag`/`cancel_agent_chat` (voir Décisions techniques) — l'annulation est vérifiée à chaque chunk maintenant, pas juste avant le premier octet. Ollama n'assigne pas d'id aux tool_calls ; un id positionnel est synthétisé côté Rust uniquement pour corréler les promesses d'approbation côté front, jamais renvoyé à Ollama.
- `src-tauri/src/commands/fsops.rs` : `list_dir` (un niveau, paresseux), `read_file_text` (limite 5 Mo), `write_file_text`, `edit_file_text` (remplacement exact, unique sauf `replace_all`).
- `src-tauri/src/commands/shell.rs` : `run_powershell_command`, streaming live via événements Tauri (`shell-output`/`shell-done`/`shell-error`/`shell-timeout`), timeout 120 s par défaut, annulable via `cancel_shell_command`.
- `src/components/codex/` : `CodexView` (page principale), `FileTree`, `EditorPane` (Monaco), `AskQuestionModal`, `AgentTranscript`, `HuggingFaceBrowser`. `ToolApprovalModal` (overlay plein écran) a été supprimé en v0.3.2, remplacé par une approbation **inline** dans `AgentTranscript` — voir "Streaming visuel dans Codex" plus bas.
- `src/monacoSetup.ts` : configuration des web workers Monaco sans CDN.
- `FileTree` : création de fichier inline (bouton toolbar pour la racine, icône "+" au survol d'un dossier). Le nom est saisi *avant* la création (input inline) ; Entrée avec un nom vide, Échap ou perte de focus annule sans rien écrire sur disque.
- `src/components/SendButton.tsx` : bouton d'envoi partagé (chat de base + Codex) — l'icône flèche se transforme en carré (transition opacity/scale/border-radius) pendant que l'IA génère, et le clic devient alors "Arrêter".

### Streaming visuel dans Codex (v0.3.2)

Avant la v0.3.2, Codex n'affichait strictement rien pendant que l'agent
réfléchissait (texte final seulement, une fois la réponse complète) et
chaque outil mutant (write/edit/commande) ouvrait un `.modal-overlay` plein
écran qui masquait tout le reste de l'app (arborescence, éditeur ET le chat
lui-même) — signalé explicitement par l'utilisateur comme donnant
l'impression que l'IA "ne fait rien"/"n'apporte pas de modifications", et
"enlève le chat" à chaque commande. Refonte complète pour se rapprocher de
Claude Code dans VS Code :
- **Texte en direct** : `useAgentLoop.ts` écoute maintenant l'événement
  `agent-chat-chunk` (voir agent.rs ci-dessus) et expose `streamingText` ;
  `AgentTranscript` affiche une bulle assistant live pendant que
  `status === "waiting-llm"`, remplacée par le message final une fois la
  réponse complète (pas de doublon : le message définitif n'entre dans
  `messages` qu'une fois la promesse `agentChat(...)` résolue).
- **Statut d'outil visible** : nouveau statut `"running-tool"` (distinct de
  `"waiting-llm"`) pendant qu'un outil non-mutant ou déjà approuvé s'exécute
  réellement, avec un badge "En cours…" animé sur la tool-card correspondante
  (`runningToolId` dans `useAgentLoop.ts`, comparé à `tc.id`). Pour
  `run_powershell_command`, la sortie live (déjà streamée via
  `onShellOutput`, auparavant seulement accumulée en silence pour le résultat
  final) s'affiche maintenant ligne par ligne dans la tool-card pendant que
  la commande tourne (`runningOutput`).
- **Approbation inline, pas de modale plein écran** : `ToolApprovalModal.tsx`
  supprimé ; la demande d'approbation (diff Monaco pour write/edit, aperçu de
  commande texte) s'affiche directement **dans** la tool-card concernée au
  sein du transcript (`tool-approval-inline` dans `AgentTranscript.tsx`), à
  côté du fichier/de l'arborescence toujours visibles — corrige directement
  "quand il fait une commande ça enlève le chat". `AskQuestionModal` reste
  une vraie modale (pas concerné par ce retour, question ponctuelle et rare).
- **Fichier édité auto-ouvert** : `handleFileChanged` dans `CodexView.tsx`
  ouvrait avant un fichier modifié seulement s'il était déjà un onglet
  ouvert (sinon, silence total dans l'éditeur). Il ouvre maintenant
  systématiquement l'onglet et le rend actif après un `write_file`/`edit_file`
  réussi — preuve visuelle directe que la modification a eu lieu, plutôt que
  seulement une ligne de texte dans le panneau transcript de 380px.

### "L'IA ne sait pas/ne peut pas lancer de commande" (v0.3.3)

Retour utilisateur après v0.3.2, avec qwen2.5-coder sélectionné dans Codex.
Le backend (`shell.rs`) était déjà correct (thread dédié, pas de blocage du
runtime async — voir "Freeze au démarrage" pour le pattern à éviter). Deux
causes distinctes trouvées côté frontend/prompt :

1. **Le system prompt ne rassurait pas assez le modèle sur son accès réel**.
   `CODEX_SYSTEM_PROMPT` mentionnait bien `run_powershell_command`, mais un
   modèle peut rester hésitant/refuser d'agir ("je ne peux pas exécuter de
   commandes, voici ce que tu peux taper toi-même") si le prompt ne dit pas
   explicitement qu'il a un accès **réel et direct** (pas simulé) et qu'il
   **doit** appeler l'outil plutôt que le décrire. Renforcé dans
   `agentTools.ts` : accès réel explicite, approbation gérée automatiquement
   hors de la conversation (pas à demander lui-même), et interdiction
   explicite de répondre "je ne peux pas" au lieu d'appeler l'outil.
2. **Race condition réelle dans `runCommandAndCollect`** (`useAgentLoop.ts`) :
   les quatre `listen()` (`onShellOutput`/`onShellDone`/`onShellError`/
   `onShellTimeout`) sont eux-mêmes de l'IPC async (enregistrement
   asynchrone côté Rust), mais `runPowershellCommand(...)` était appelée
   juste après sans attendre que ces registrations soient confirmées. Une
   commande qui se termine très vite pouvait en théorie émettre
   `shell-done` avant que le listener ne soit effectivement attaché,
   laissant la promesse du tool call bloquée **indéfiniment** — l'agent
   restait planté sur "En cours…" sans jamais recevoir de résultat, ce qui
   du point de vue utilisateur ressemble exactement à "l'IA ne peut pas
   lancer de commande". Corrigé en `await Promise.all([...])` sur les
   quatre `listen()` avant d'invoquer la commande. Peu probable comme cause
   dominante en pratique (le démarrage de `powershell.exe` prend
   généralement plus longtemps que l'enregistrement d'un listener), mais
   un vrai bug latent éliminé par précaution plutôt que juste rendu moins
   probable.

### Toujours un souci "l'IA ne peut pas" + Ctrl+S cassé (v0.3.4)

Trois correctifs supplémentaires après retour utilisateur :

1. **Fallback markdown pour les commandes** (`useAgentLoop.ts`,
   `extractFallbackCommand`) : même avec le prompt renforcé (v0.3.3), un
   modèle peut encore écrire une commande dans un bloc de code markdown
   (```` ```powershell ... ``` ````) au lieu d'un vrai tool_call. Avant,
   ce texte s'affichait tel quel et rien ne s'exécutait — le tour se
   terminait, donnant l'impression que l'IA "ne fait rien". Maintenant,
   si `resp.tool_calls` est vide mais que la réponse contient un bloc
   ```` ```powershell/ps1/pwsh/cmd/bash/shell/sh ```` (liste stricte pour
   ne jamais confondre un exemple de code Python/JS illustratif avec une
   commande à lancer), un tool_call synthétique `run_powershell_command`
   est construit et exécuté **via le même chemin que les vrais tool_calls**
   — même approbation en mode Approbation, même carte d'outil, et la
   boucle continue automatiquement après (`await runTurn(msgs)`) au lieu
   de s'arrêter, pour que l'IA reçoive la sortie et poursuive.
2. **System prompt généralisé** à tous les outils (pas seulement les
   commandes) : "pour toute action possible avec un outil... appelle
   TOUJOURS l'outil correspondant" — corrige aussi le cas "lis X.txt et
   dis-moi son contenu" répondu sans avoir vraiment appelé `read_file`.
3. **Ctrl+S ne sauvegardait rien, pas même dans le fichier lui-même** — bug
   réel trouvé en lisant le code source de `wry` (le wrapper WebView2 de
   Tauri) : `browser_accelerator_keys: true` est le comportement **par
   défaut** de WebView2, qui intercepte Ctrl+S (et Ctrl+P/F/O/U, F5, F12,
   Alt+Flèches...) comme raccourcis natifs du navigateur **avant même que
   la page web ne reçoive l'événement clavier** — donc la commande Ctrl+S
   de Monaco (`EditorPane.tsx`) ne se déclenchait jamais. Pas de champ de
   config Tauri de premier niveau pour ça (vérifié dans `tauri-utils`) ; la
   seule solution passe par l'API bas niveau `window.with_webview(...)`
   (`lib.rs`) donnant un accès direct au COM `ICoreWebView2Controller` de
   WebView2, pour appeler `SetAreBrowserAcceleratorKeysEnabled(false)` —
   même pattern que `wry` utilise en interne (vérifié dans son code source
   avant d'écrire le nôtre). Nécessite les crates `webview2-com`/`windows`
   en dépendances directes, **aux mêmes versions exactes** que celles déjà
   résolues pour `wry` dans `Cargo.lock` (0.38/0.61) — sinon les types COM
   ne correspondraient pas entre les deux résolutions de crate. Sans
   rapport avec Ctrl+C/V/X/Z/A (copier/coller/annuler/tout sélectionner),
   qui restent gérés par le contrôle d'édition sous-jacent, pas par ce
   réglage WebView2.

### Control Me (contrôle autonome clavier/souris via Gemini)

Première version fonctionnelle (2026-08-30). Contrairement au plan initial
(overlay séparé, toujours au-dessus, invoqué par un raccourci global F5,
voir `C:\Users\userAsus\.claude\plans\memoized-jingling-platypus.md`), la
demande explicite qui a déclenché l'implémentation était plus simple :
**"qu'on peut la lancer dans l'app, un espace Control Me"** — donc cette
première version est une **troisième vue dans la fenêtre principale**
(`view: "chat" | "codex" | "controlme"` dans `App.tsx`), exactement le même
pattern que Codex (bouton Sidebar → `setView("controlme")` → composant
plein écran avec un bouton retour), pas une fenêtre séparée. Le
raccourci global F5 + fenêtre overlay indépendante du plan reste une
extension possible plus tard, pas encore construite.

**Installable séparément depuis la v0.5.0** — voir `CONTROLME.md` (racine
du dépôt) pour la doc destinée à quelqu'un qui n'installe QUE Control Me,
et "Control Me : produit installable séparément (v0.5.0)" plus bas dans
cette section pour le détail technique (même code, config Tauri alternative,
`product` sur `app_releases`).

- **API utilisée : Interactions API de Google (`/v1beta/interactions`),
  pas l'ancien `generateContent`.** Recherché en direct au moment de coder
  (le modèle et cette API sont sortis le 2026-08-13, après la coupure de
  connaissance de Claude) — la doc "What's new" de Gemini 3.7 Flash ne
  montre QUE cette nouvelle API, donc traitée comme le chemin recommandé
  plutôt que de deviner l'ancien format. Avantage direct pour ce cas
  d'usage : état de conversation géré **côté serveur** via
  `previous_interaction_id` — pas besoin de renvoyer tout l'historique ni
  toutes les captures d'écran précédentes à chaque étape.
- **Outil `computer_use` intégré par Google** (`environment: "desktop"`),
  pas des function_declarations faites main : action set complet (click,
  double_click, triple_click, middle_click, right_click, mouse_down,
  mouse_up, move, type, drag_and_drop, wait, press_key, key_down, key_up,
  hotkey, take_screenshot, scroll), coordonnées **normalisées 0-999**
  (dénormalisées dans `controlme.rs` avec la taille réelle de l'écran
  capturé par `xcap`), et **`enable_prompt_injection_detection: true`**
  activé — protection native contre un texte adversarial caché dans une
  page/capture d'écran qui tenterait de détourner l'agent. Toute cette
  forme d'API (schéma exact des requêtes/réponses, noms de champs) a été
  vérifiée par recherche web avant d'écrire le code Rust, pas supposée de
  mémoire.
- **`safety_decision: require_confirmation` respecté même en mode
  autonome** : Gemini peut lui-même flaguer une action comme sensible
  (catégories Google : transactions financières, création de compte,
  modification de données, consentement utilisateur, conditions légales...).
  Ce n'est PAS une porte d'approbation générale par action (l'utilisateur a
  explicitement demandé l'autonomie totale, seulement un bouton Stop) —
  c'est le jugement du modèle lui-même sur un sous-ensemble étroit
  d'actions à risque, respecté comme garde-fou supplémentaire gratuit.
  Implémentation actuelle (simple, à raffiner) : quand ce flag apparaît, la
  boucle s'arrête proprement et prévient l'utilisateur (`control-me-confirmation-required`)
  plutôt que de bloquer en plein milieu de la commande Rust en attendant une
  réponse — un vrai flux de confirmation inline (façon l'approbation
  inline de Codex) serait une amélioration future si demandée.
- `src-tauri/src/commands/controlme.rs` : `run_control_me` (commande async,
  boucle complète interne comme `agent_chat`/`run_powershell_command` —
  capture d'écran via `xcap`, appel Gemini, exécution de l'action via
  `enigo`, ré-capture, boucle) ; `cancel_control_me` (même pattern
  `Arc<AtomicBool>` + `tokio::select!`/`wait_for_cancel` que
  `AgentCancelFlag` dans `agent.rs`). Plafond `MAX_CONTROL_ME_ITERATIONS = 40`
  (même idée que `MAX_AGENT_ITERATIONS` de Codex, mais sans confirmation
  utilisateur pour continuer — s'arrête simplement, cohérent avec
  "autonome + bouton Stop" plutôt que "autonome + confirmations").
- `src/components/controlme/ControlMeView.tsx` : interface façon chat
  (réutilise `MessageBubble`/`SendButton`), affiche chaque étape en direct
  (intention + action, via l'événement `control-me-step`), bloque l'envoi
  et affiche un message clair si `settings.gemini_api_key` est vide plutôt
  que de tenter silencieusement un appel API sans clé.
- **Clé API Gemini propre à l'utilisateur, jamais fournie par l'app**
  (`Settings.gemini_api_key`, champ dans Réglages) — cohérent avec la
  demande explicite de l'utilisateur.
- **Rompt la garantie "rien ne sort de l'app" documentée dans
  Confidentialité réseau ci-dessous** : dès qu'une instruction Control Me
  tourne, une capture d'écran complète part vers Google à chaque étape —
  voir cette section pour le détail, mise à jour en même temps que ce
  paragraphe.

**Optimisation vitesse (v0.4.1)** : retour utilisateur "il est trop long,
il prend du temps à exécuter des choses et à analyser l'écran" après le
premier test. Trois leviers, dans `capture_screenshot_base64` et le corps
de requête de `controlme.rs` :
1. **Captures d'écran redimensionnées et en JPEG plutôt qu'en PNG pleine
   résolution.** Les coordonnées de `computer_use` sont normalisées 0-999
   — une fraction de l'image, peu importe sa résolution réelle — donc
   réduire l'image avant envoi (`SCREENSHOT_MAX_WIDTH = 1280`,
   `xcap::image::imageops::resize` avec un filtre `Triangle`) ne dégrade
   pas la précision des clics tout en réduisant nettement le temps
   d'encodage, la taille uploadée et le temps d'analyse côté Gemini.
   `denormalize()` continue d'utiliser les dimensions **réelles** de
   l'écran (capturées avant redimensionnement), pas celles de l'image
   réduite envoyée. Le JPEG n'a pas de canal alpha — conversion RGB8
   obligatoire avant encodage (`DynamicImage::ImageRgba8(...).to_rgb8()`).
   Nécessite la crate `image` en dépendance directe avec
   `default-features = false, features = ["jpeg"]` (sans ça, `xcap::image`
   n'active pas le codec JPEG — et **sans** `default-features = false`,
   `image` embarque par défaut son support AVIF, qui tire `ravif`/`rav1e`/
   `rayon`, un gonflement de temps de compilation totalement inutile ici,
   repéré et retiré immédiatement après un premier `cargo add`).
2. **`generation_config.thinking_level: "low"`** sur chaque appel à
   l'Interactions API — moins de raisonnement approfondi par étape, adapté
   à une boucle capture/action rapide plutôt qu'à un problème complexe
   résolu en un coup.
3. Délai de stabilisation après une action réduit de 300ms à 120ms (laisse
   quand même le temps à l'UI ciblée de refléter visuellement l'action
   avant la capture suivante, mais sans traîner).

**Sélecteur de modèle (v0.4.2)** : demandé explicitement — choix entre
Gemini 3.5 Flash-Lite, 3.5 Flash, 3.6 Flash et 3.7 Flash, `<select>` dans
l'en-tête de `ControlMeView.tsx`, persisté dans `Settings.gemini_model`
(même pattern que `codex_mode`/`codex_last_folder` : prop
`onPersistModel` → `handlePersistControlMeModel` dans `App.tsx` →
`saveSettings`). `run_control_me` accepte maintenant un paramètre `model`
côté Rust. **Point important vérifié par recherche web avant d'ajouter
l'option** : `gemini-3.6-flash` n'apparaît PAS dans la liste des modèles
compatibles avec l'outil `computer_use` documentée par Google
(contrairement aux trois autres) — laissé sélectionnable quand même
puisque demandé explicitement, mais avec un libellé "(compatibilité non
confirmée)" dans le menu pour que ça ne soit pas un mystère si une
session échoue avec ce modèle.

**Modèle recommandé par défaut (v0.5.1bis)** : demandé explicitement —
`gemini-3.5-flash-lite` plutôt que `gemini-3.7-flash`, dans les trois
endroits où un défaut existe (`GEMINI_MODELS` de `ControlMeView.tsx`,
son fallback `useState`, `GEMINI_MODEL` de `controlme.rs`, et
`default_gemini_model()` de `settings.rs`). **À noter, documenté dans
`CONTROLME.md`** : Google appelle explicitement `gemini-3.7-flash` "le
modèle recommandé pour le contrôle d'ordinateur" — ce choix de
recommandation par défaut dans l'app est une préférence assumée de
l'utilisateur (rapidité/coût), pas la recommandation de Google, signalé
comme tel plutôt que présenté comme si Google le recommandait.

### Control Me : produit installable séparément (v0.5.0)

Demandé explicitement : Control Me installable **tout seul**, avec le même
mécanisme de mise à jour/setup que l'app de chat, un bouton dédié sur le
site, et sa propre doc autonome (`CONTROLME.md`).

**Décision d'architecture : même code, config Tauri alternative — pas de
second projet Tauri ni de Cargo workspace.** `npx tauri build` supporte
`-c/--config <fichier>` (vérifié via `npx tauri build --help` avant
d'écrire le moindre fichier), qui fusionne un JSON par-dessus
`tauri.conf.json` — fusion **profonde** de type JSON Merge Patch (RFC 7396,
crate `json_patch`, vérifié dans le code source de `tauri-utils` avant de
s'appuyer dessus) : seules les clés présentes dans le fichier de
surcharge sont remplacées, tout le reste (dont `plugins.updater.pubkey`,
qu'on ne veut surtout pas dupliquer/désynchroniser) vient de la config de
base automatiquement.

- **`src-tauri/tauri.controlme.conf.json`** (nouveau) : `productName`
  "Control Me", `identifier` **différent** (`com.userasus.control-me` vs
  `com.userasus.ollama-chat-react` — sépare l'installation/le registre
  Windows des deux produits, sinon installer l'un écraserait l'autre),
  `build.beforeBuildCommand` pointé sur `npm run build:controlme`,
  `app.windows` remplacé par une seule fenêtre 480×700 sans Sidebar/Chat/
  Codex, `plugins.updater.endpoints` remplacé par la même URL RPC **avec
  `?p_product=controlme`** en plus (voir le `product` sur `app_releases`
  ci-dessous). Le `pubkey` de signature n'est PAS dupliqué ici — hérité de
  `tauri.conf.json` par la fusion profonde, même clé de confiance pour les
  deux produits (pas une frontière de sécurité entre eux, un secret de
  moins à gérer). Build : `npx tauri build --config
  src-tauri/tauri.controlme.conf.json`.
- **Un seul crate Rust, un seul frontend Vite** — zéro duplication de
  `controlme.rs` (logique Gemini/enigo/xcap). Le build standalone
  embarque quand même les commandes Chat/Codex inutilisées (coût binaire
  réel, accepté pour l'instant plutôt que de forker le code — piste
  d'optimisation notée dans "Prochaines étapes" si la taille de
  l'installeur devient un problème).
- **`src/main.tsx`** : au lieu d'un composant racine unique, choisit entre
  `<App/>` et un nouveau `<StandaloneApp/>` (`src/controlme-standalone/`)
  selon `import.meta.env.VITE_STANDALONE === "controlme"` — variable posée
  par **`.env.controlme`** (nouveau), chargée automatiquement par Vite
  via le script npm **`build:controlme`** (nouveau : `vite build --mode
  controlme`, convention standard Vite pour charger `.env.<mode>`).
  `StandaloneApp.tsx` charge les réglages (`loadSettings`), affiche un
  bouton "Clé API Gemini" minimal (pas la `SettingsModal` complète —
  aucun des autres réglages, host Ollama/prompt système/etc., ne
  s'applique ici) et rend `ControlMeView` directement — pas de Sidebar,
  pas de bouton retour (`onBack` rendu optionnel dans `ControlMeView` pour
  ça, `undefined` en mode standalone).
- **`app_releases` gagne une colonne `product`** (`supabase/
  controlme_product_migration.sql`, nouveau fichier de migration —
  **l'utilisateur doit l'exécuter une fois dans l'éditeur SQL Supabase**,
  même processus que chaque migration précédente de ce projet, jamais fait
  automatiquement par l'app). `latest_release_manifest()` prend maintenant
  un paramètre `p_product` avec la valeur par défaut `'ollamachat'` —
  rétrocompatible par construction : les lignes déjà publiées héritent de
  `product = 'ollamachat'` par défaut, et l'endpoint de l'app de chat
  (qui appelle la fonction sans paramètre) continue de se comporter
  exactement comme avant, sans le moindre changement à son
  `tauri.conf.json`. Publier une release Control Me = même flux "Publier
  une release" plus loin dans ce fichier, avec `"product": "controlme"`
  ajouté au JSON inséré.
  **Tant que cette migration SQL n'a pas été appliquée, le bouton de
  téléchargement existant du site casse aussi** (requête `product=eq...`
  sur une colonne qui n'existe pas encore → 400 → repli silencieux sur
  "bientôt disponible") — migration à appliquer avant de considérer le
  site à jour.
- **`site/index.html`** : deuxième section + bouton (`data-product`),
  `loadLatestRelease(product)` généralisée pour interroger `app_releases`
  filtré par produit au lieu d'une requête unique non filtrée.

### Confirmation inline, mémoire IA, lancement au démarrage

Trois demandes choisies par l'utilisateur dans une liste de pistes que
j'avais proposées. Recherche faite avant de coder (pas supposée de
mémoire) : la doc de référence de l'Interactions API pour les outils
`file_search`/`retrieval` (candidats naturels pour une "mémoire type
RAG") montre qu'ils sont **en lecture seule côté modèle** — pas de
mécanisme pour que le modèle y écrive lui-même, seulement une API Files
séparée qu'on remplit à l'avance. Ne convient pas à la demande explicite
("que l'IA lui-même y apporte des modifications, en fonction de ce qu'il
a appris") — d'où l'outil `function` personnalisé ci-dessous à la place.
Vérifié aussi que `computer_use` peut être combiné avec un outil
`function` personnalisé dans le même tableau `tools` (exemple documenté
par Google : un outil `yield_to_user` personnalisé aux côtés de
`computer_use` pour des scénarios humain-dans-la-boucle).

- **Confirmation qui reprend en place, pas un arrêt complet.** Avant :
  `require_confirmation` (voir plus haut) coupait toute la commande
  Rust et prévenait l'utilisateur, qui devait renvoyer un nouveau message
  pour continuer. Maintenant : un canal `tokio::sync::oneshot` (feature
  `sync` ajoutée à `tokio` dans `Cargo.toml`), stocké dans un nouvel état
  managé `ControlMeConfirmation` (`Arc<Mutex<Option<oneshot::Sender<bool>>>>`,
  même forme que `ControlMeCancelFlag` mais portant un `bool` au lieu
  d'être sondé) — `run_control_me` crée le canal, stocke l'émetteur,
  émet l'événement, puis `.await` le récepteur (dans un `tokio::select!`
  qui laisse Stop toujours fonctionner pendant l'attente). Nouvelle
  commande `resolve_control_me_confirmation(accept)` : récupère
  l'émetteur et y envoie la réponse, ce qui débloque la boucle **sans y
  mettre fin**. En cas d'acceptation, `"safety_acknowledgement": true` est
  ajouté aux arguments de l'action avant de l'exécuter (protocole exact
  documenté par Google pour ce flag) ; en cas de refus, la boucle
  continue quand même (résultat "Action refusée par l'utilisateur.",
  comme un refus d'approbation dans Codex) au lieu de s'arrêter, pour que
  Gemini puisse s'adapter. `ControlMeView.tsx` : le gestionnaire
  `onControlMeConfirmationRequired` ne coupe plus `running` — un état
  `pendingConfirmation` affiche un prompt inline dans le transcript
  (`.controlme-confirm`, même famille visuelle que l'approbation inline
  de Codex), avec `resolveControlMeConfirmation(accept)` sur les boutons.
- **Mémoire "type RAG" simplifiée délibérément — et assumée comme telle,
  pas cachée.** Un vrai RAG par embeddings demande un modèle
  d'embedding et un index vectoriel : de la vraie infrastructure pour ce
  qui reste, en pratique, une liste de la taille d'un profil personnel
  (dizaines de faits, pas des milliers). v1 : un outil `function`
  personnalisé `remember_fact` déclaré aux côtés de `computer_use` dans
  le tableau `tools` (paramètres `fact`/`category`) ; dans la boucle,
  `remember_fact` est traité comme `take_screenshot` — une branche AVANT
  `execute_action`, jamais passée à `enigo` (voir `dispatch_action`,
  factorisée pour être partagée entre le chemin direct et le chemin
  "après confirmation", qui exécutaient sinon un code quasi-identique en
  double) — qui ajoute le fait à `{data_dir}/controlme_memory.json`
  (même convention que `settings.json`) et renvoie une confirmation
  courte comme résultat de fonction. **"Retrieval" au sens où le fichier
  entier est chargé et préfixé à l'instruction initiale d'une nouvelle
  session** ("Ce que tu sais déjà sur cette personne : ...") avant chaque
  nouvel appel — retrieval-*augmenté* sans avoir besoin d'un vector
  store, tant que le nombre de faits reste raisonnable ; un vrai filtrage
  par mots-clés/embeddings resterait à envisager seulement si ça devait
  un jour grossir au point de peser sur le contexte/la latence. Nouvelles
  commandes `list_control_me_memory`/`clear_control_me_memory` — donner à
  l'utilisateur une vraie visibilité et un moyen simple de tout effacer
  n'est pas une option ici (des données sur lui s'accumulent sans
  confirmation par fait), c'est une partie non négociable de la
  fonctionnalité, pas une finition plus tard. Panneau "Mémoire" dans
  `ControlMeView.tsx` (bouton dans l'en-tête, liste + bouton "Tout
  effacer" avec confirmation `window.confirm`).
- **Lancement au démarrage de Windows** : `tauri-plugin-autostart`
  (officiel, rien de personnalisé) — `tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None)`
  dans `lib.rs` (le paramètre `macos_launcher` doit être fourni même sur
  ce projet Windows-only, la signature de la fonction `init` est commune
  à toutes les plateformes ; vérifié dans le code source du plugin avant
  d'écrire l'appel — la struct `Builder` interne, elle, n'a ce champ que
  sous `#[cfg(target_os = "macos")]`). Capacité `autostart:default`
  ajoutée à `capabilities/default.json` (vérifié que le plugin en a bien
  une, comme les autres). Case à cocher "Lancer au démarrage de Windows"
  dans `StandaloneApp.tsx` uniquement (`@tauri-apps/plugin-autostart`,
  `enable`/`disable`/`isEnabled`) — scopé au build standalone comme
  demandé ; l'app de chat principale n'a pas ce contrôle dans son
  interface, même si le plugin est enregistré pour les deux (même crate).

### Historique des sessions Control Me (v0.5.3)

Demandé explicitement : "les conversations Control Me disparaissent à la
fermeture ; les sauvegarder comme le fait déjà l'app de chat permettrait
de les relire." Implémentation qui **calque exactement** le pattern déjà
établi pour les conversations de chat plutôt que d'inventer autre chose :

- `src-tauri/src/commands/controlme_sessions.rs` (nouveau) — même forme
  que `conversations.rs` trait pour trait : `ControlMeSession`
  (id/title/created_at/entries) pour le contenu complet,
  `ControlMeSessionMeta` (sans `entries`) pour la liste, un fichier JSON
  par session dans `{data_dir}/controlme_sessions/` (nouveau helper
  `control_me_sessions_dir` dans `mod.rs`, copie de `conversations_dir`).
  `list_control_me_sessions`/`load_control_me_session`/
  `save_control_me_session`/`delete_control_me_session` — pas de
  recherche par contenu comme `search_conversations`, pas demandé pour
  l'instant.
- **Sauvegarde automatique**, même déclencheur que le chat (App.tsx) :
  `useEffect` sur `entries` dans `ControlMeView.tsx`, sauvegarde à chaque
  changement tant qu'il y a au moins une entrée. Le titre se déduit du
  premier message utilisateur tronqué à 40 caractères (même règle que
  `NEW_CONV_TITLE` du chat), "Nouvelle session" sinon.
- `sessionId`/`sessionCreatedAt` générés côté frontend
  (`crypto.randomUUID()`/`Date.now() / 1000`), même pattern que
  `handleNewConversation` dans `App.tsx` — pas générés côté Rust.
- UI : boutons "Nouvelle session" et "Historique" dans l'en-tête de
  `ControlMeView.tsx`, panneau de liste réutilisant le style visuel du
  panneau "Mémoire" existant (même classes `.controlme-memory-panel`/
  `.controlme-memory-list`, nouvelles classes seulement pour la ligne
  session elle-même avec son bouton supprimer). Cliquer une session la
  charge (remplace `entries` courant) ; supprimer la session actuellement
  affichée démarre automatiquement une nouvelle session vide plutôt que
  de laisser un état incohérent.
- Disponible à la fois dans Control Me embarqué et dans le build
  standalone, sans code supplémentaire — `ControlMeView.tsx` est
  entièrement partagé entre les deux (voir "Control Me : produit
  installable séparément" plus haut).

### Recherche/renommage de session, retrait du bouton retour (v0.5.4)

Trois demandes explicites groupées dans la même session de travail.

- **Recherche dans l'historique** : `search_control_me_sessions` (Rust,
  `controlme_sessions.rs`) — même principe que `search_conversations`,
  cherche dans le titre ET le contenu de chaque `entry`, pas juste le
  titre affiché (même raison que pour le chat : les titres sont
  auto-générés depuis les 40 premiers caractères du premier message).
  Côté `ControlMeView.tsx` : un `useEffect` sur `[historyQuery,
  showHistory]` — requête vide → `listControlMeSessions()` immédiat
  (pas de debounce, l'ouverture du panneau ne doit pas attendre) ; requête
  non vide → `searchControlMeSessions(query)` après 200ms (même debounce
  que la recherche de conversation dans `Sidebar.tsx`). Un champ
  `<input>` ajouté en haut du panneau "Historique" (`.controlme-session-search`).
- **Renommer une session** : double-clic sur le titre dans le panneau
  Historique, même pattern exact que `Sidebar.tsx` (input inline,
  Entrée valide, Échap/blur annule — `renamingSessionId`/
  `renameSessionText`, nouvelle classe `.controlme-session-rename`). Deux
  cas distincts selon que la session renommée est celle actuellement
  affichée ou non :
  - **Session active** : passe par un nouvel état `customTitle` plutôt que
    de sauvegarder directement — l'effet de sauvegarde automatique
    (`useEffect` sur `entries`) recalculait jusqu'ici le titre depuis le
    premier message à *chaque* nouvelle entrée, ce qui écrasait
    silencieusement un renommage manuel dès le message suivant. Le titre
    utilisé est maintenant `customTitle ?? titre-calculé`, et `customTitle`
    est aussi dans les dépendances de l'effet pour déclencher une
    sauvegarde immédiate au renommage. Remis à `null` sur "Nouvelle
    session" ; réhydraté depuis `session.title` au chargement d'une
    session existante (comportement inchangé pour une session jamais
    renommée : le titre recalculé est de toute façon identique, puisque le
    premier message d'une session ne change jamais après coup).
  - **Session non active** (une autre session dans la liste, pas celle en
    cours) : ne passe pas par `entries`/`customTitle` — charge la session
    complète (`loadControlMeSession`), patch son titre, la resauvegarde
    directement. La liste affichée est mise à jour de façon optimiste
    (`setSessions`) avant même que la sauvegarde ne réponde.
- **Retrait du bouton "← Chat"** : sur demande explicite ("plus de bouton
  retourner au chat, cliquer sur la sidebar suffit") — `onBack` retiré
  entièrement de `CodexView.tsx` et `ControlMeView.tsx` (prop, type, JSX).
  La Sidebar reste **toujours visible**, quelle que soit la vue active
  (`view` dans `App.tsx`), donc cliquer "Nouvelle conversation" ou une
  conversation existante suffit à revenir au chat — `setView("chat")`
  ajouté dans `handleNewConversation` et `handleSelectConversation`
  (`App.tsx`), les deux seuls points d'entrée qui déclenchent
  `onNew`/`onSelect` de la Sidebar.

### Attente adaptative et lecture de l'arbre d'accessibilité (v0.5.6)

Demandé après une discussion libre : existe-t-il un autre moyen pour l'IA
de savoir ce qui se passe à l'écran, sans passer par des captures d'écran,
"en live" et "plus opti" ? Avec la consigne explicite de créer un vrai
outil que Gemini peut appeler lui-même. Deux améliorations indépendantes,
toutes deux passées par plan mode vu la nouveauté (nouvelle dépendance,
interop Windows), et toutes deux vérifiées contre du vrai code source avant
d'écrire quoi que ce soit (même discipline que pour enigo/xcap/
tauri-plugin-autostart en leur temps).

- **Attente adaptative** (remplace le délai fixe `sleep(120ms)` après
  chaque action, dans `run_control_me`) : nouvelle fonction
  `wait_for_settle()` qui capture une miniature très légère (64px de
  large, niveaux de gris — `capture_grayscale_thumb()`, réutilise
  `xcap::Monitor::capture_image()` déjà en place, pas de nouvel appel)
  toutes les 40ms et compare deux captures consécutives
  (`thumbs_differ()`, différence moyenne absolue par pixel, seuil 3.0) ;
  dès que l'écran est stable sur 2 vérifications consécutives OU qu'un
  plafond de 900ms est atteint, la vraie capture (pleine résolution/JPEG,
  comme avant) part vers Gemini. Plus rapide quand l'UI a déjà fini de
  réagir (cas courant), plus fiable quand elle met du temps (au lieu
  d'agir sur une capture obsolète). 100% local, aucun nouvel appel
  réseau. Reste réactif à Stop (le flag d'annulation est vérifié à chaque
  poll de 40ms, plus une vérification après le retour de la fonction).
  **Constantes non testées visuellement** (pas d'accès GUI dans cet
  environnement) : `SETTLE_POLL_INTERVAL_MS`/`SETTLE_MAX_WAIT_MS`/
  `SETTLE_STABLE_CHECKS`/`SETTLE_DIFF_THRESHOLD` en haut de
  `controlme.rs`, à ajuster après un vrai test utilisateur.
- **Nouvel outil `read_ui_elements`** (`function`, combiné à
  `computer_use` dans le tableau `tools` — pattern déjà éprouvé avec
  `remember_fact`) : Gemini peut l'appeler pour lire la structure
  d'accessibilité Windows (UI Automation) de la fenêtre au premier plan —
  titre + liste de contrôles visibles avec type, libellé exact, état
  activé/désactivé, et position **déjà normalisée 0-999** (même repère
  que les coordonnées de clic de `computer_use`, donc directement
  réutilisable) — sans capture d'écran. Complémentaire à `computer_use`,
  pas un remplacement : une UI dessinée directement (jeu, canvas) n'expose
  rien à l'accessibilité, cas normal signalé comme tel dans le texte
  retourné plutôt que traité comme une erreur.
  - Nouveau fichier `src-tauri/src/commands/ui_automation.rs` (plutôt que
    d'alourdir encore `controlme.rs`, déjà volumineux — même raison que
    l'extraction passée de `controlme_sessions.rs`) :
    `read_foreground_ui_elements(screen_width, screen_height)` parcourt
    récursivement l'arbre depuis la fenêtre au premier plan
    (`GetForegroundWindow()` + `element_from_handle`), profondeur
    plafonnée à 6 **et** nombre total de nœuds visités plafonné à 500
    (garde-fou contre un arbre DOM de navigateur géant — un onglet Chrome
    mirror tout son DOM dans l'accessibilité), ne garde que les contrôles
    visibles et nommés (`is_control_element() && !is_offscreen()`, nom ou
    automation_id non vide), plafonne aussi à 60 éléments retenus, et
    retourne un texte compact (une ligne par élément) plutôt qu'un JSON
    verbeux — plus économe en tokens.
  - **Crate choisie, API vérifiée en lisant son vrai code source avant
    d'écrire** (`crates/uiautomation/src/core.rs` sur GitHub, pas
    supposée) : [`uiautomation`](https://github.com/leexgone/uiautomation-rs)
    0.25.0, wrapper autour des interfaces COM `IUIAutomation` — même
    logique que le choix d'enigo/xcap : un wrapper maintenu plutôt que de
    l'interop COM UI Automation écrite à la main (notoirement pénible à
    faire correctement).
  - **Point de compatibilité de version vérifié** : `uiautomation` épingle
    `windows = "0.62.2"` en interne, différent de notre `windows = "0.61"`
    existant (utilisé uniquement pour le correctif WebView2 Ctrl+S dans
    `lib.rs`) — mais aucune interop directe de type COM n'est nécessaire
    entre les deux (contrairement à la leçon webview2-com où un vrai objet
    COM devait transiter entre crates de versions identiques) : seule une
    valeur de handle brute transite. `GetForegroundWindow()` est appelé
    via notre `windows = "0.61"` existant (feature
    `Win32_UI_WindowsAndMessaging` ajoutée), puis `hwnd.0 as isize` (HWND
    est `#[repr(transparent)] struct HWND(pub *mut c_void)` dans les deux
    versions), puis `uiautomation::types::Handle::from(cette_isize)` —
    zéro duplication de code d'interop, juste deux résolutions du crate
    `windows` dans l'arbre de dépendances (coût de compilation
    légèrement augmenté, aucun risque fonctionnel).
  - **Vrai bug de la crate découvert en compilant** (pas supposé) :
    `uiautomation = { default-features = false }` seul ne compile PAS —
    `core.rs` importe `crate::inputs::MouseButton` sans condition alors
    que le module `inputs` est déclaré derrière `#[cfg(feature =
    "input")]` dans son `lib.rs`. Corrigé en réactivant juste la feature
    `input` (toujours sans `control`/`pattern`, qu'on n'utilise
    réellement pas — on ne fait que lire, jamais envoyer d'action via UI
    Automation, enigo s'en charge déjà) — un vrai constat empirique via
    `cargo check`, pas une hypothèse.
  - Petit refactor de `dispatch_action` (`controlme.rs`) : sa signature
    passe de `(label, erreur)` à `(label_transcript, texte_résultat,
    erreur)` — nécessaire parce que `read_ui_elements` veut un libellé
    court dans le transcript ("Lecture de l'interface (N éléments)") mais
    le texte complet envoyé à Gemini ; tous les autres appelants gardent
    simplement `label_transcript == texte_résultat`, comme avant.
  - **Hors scope, explicitement pas construit** : capture différentielle
    DXGI Desktop Duplication (gain marginal une fois l'attente adaptative
    en place, risque d'implémentation COM bien plus élevé) ; hooks
    `SetWinEventHook` pour détecter un changement de fenêtre au premier
    plan (piste future si redemandée séparément) ; remplacer entièrement
    les captures d'écran par l'accessibilité (perdrait le raisonnement
    visuel de `computer_use` pour toute UI non standard).
- `cargo check` passé à 0 erreur ni avertissement après correctif de la
  feature `input`. **Pas de vérification visuelle possible dans cet
  environnement** (pas d'accès GUI) — à confirmer par l'utilisateur après
  installation : ressenti de vitesse/fiabilité, et si `read_ui_elements`
  est bien appelé par Gemini quand pertinent (son usage reste à la
  discrétion du modèle, pas forçable).

### Control Me à distance depuis le site (v0.5.7)

Demande explicite : piloter Control Me depuis le site Vercel (pas seulement
depuis l'app), avec une page `/controlremote` accessible depuis la landing,
un code de jumelage généré dans l'app et stocké côté navigateur (reconnexion
automatique à la prochaine visite), écran live + chat + bouton Arrêter, en
s'appuyant sur Supabase **Realtime**. Deux clarifications tranchées avec
l'utilisateur avant de coder (voir `AskUserQuestion` dans l'historique) :
**pas de Prisma** (ORM Node/TS — ne peut pas tourner dans l'app Rust, et le
site n'a aucun backend ; ajouté un aurait exigé un vrai service Node hors
scope) — appels directs à Supabase (REST + Realtime) des deux côtés, comme
partout ailleurs dans ce projet ; et **client Realtime Rust écrit à la
main** (`tokio-tungstenite` + protocole Phoenix Channels vérifié contre
https://supabase.com/docs/guides/realtime/protocol avant d'écrire le
moindre code) plutôt qu'une crate communautaire peu utilisée — aucun client
Realtime officiel n'existe en Rust, contrairement à `@supabase/supabase-js`
utilisé tel quel côté site (asymétrie assumée : client officiel là où il
existe, écrit à la main là où il n'existe pas).

**Découverte qui simplifie tout le design, faite avant d'écrire quoi que ce
soit** : aucune table Postgres n'est nécessaire. Realtime Broadcast +
Presence suffit entièrement :
- Le code de jumelage (12 chiffres, générés par `rand`) est simplement le
  **nom du salon** (topic) `realtime:remote:{code}` — pas de ligne à
  créer/valider en base, pas de RLS à écrire pour ça.
- "Qui est connecté" = **Presence** native du salon : l'app track sa propre
  présence sous la clé `"host"`, le site sous une clé aléatoire par onglet
  — toute clé de présence différente de `"host"` est traitée comme un
  viewer côté app (un seul hôte possible par construction).
- L'écran live et les instructions/réponses de chat transitent en
  **Broadcast** éphémère, jamais persistés nulle part.

Ça préserve presque entièrement la posture "Supabase en lecture seule côté
Postgres" déjà documentée plus bas dans ce fichier — c'est le service
Realtime (WebSocket), pas l'API REST/Postgres, qui porte toute cette
fonctionnalité. Nouvelle **5ᵉ exception réseau** documentée dans
"Confidentialité réseau" ci-dessous : l'écran et les instructions
transitent désormais aussi par le relais Realtime de Supabase quand le
contrôle à distance est actif.

- **`src-tauri/src/commands/remote.rs`** (nouveau) : client WebSocket
  Phoenix Channels écrit à la main (`connect_async` de `tokio-tungstenite`,
  `rustls-tls-webpki-roots` pour `wss://`, cohérent avec le choix
  `rustls-tls` déjà fait pour `reqwest` — pas d'openssl/native-tls).
  `generate_remote_code`/`clear_remote_code` (commandes Tauri) persistent
  `Settings.remote_code` et démarrent/arrêtent une tâche de fond
  (`tokio::spawn`, cycle de vie géré via `RemoteState`/`RemoteHandle` —
  simple `task.abort()` à l'arrêt, pas de flag d'annulation coopératif
  séparé, aucune section critique à protéger côté remote.rs qui le
  justifierait). **Reprise automatique au démarrage**
  (`resume_remote_on_startup`, appelé dans le hook `setup` de `lib.rs`) :
  si un code existe déjà dans les réglages, l'app se remet à écouter toute
  seule, cohérent avec "le site se reconnecte tout seul" côté navigateur —
  sans ça, la reconnexion automatique du site n'aurait personne en face.
  Heartbeat toutes les 25s, diffusion d'écran (réutilise directement
  `capture_screenshot_base64()` de `controlme.rs`, rendue `pub(crate)`)
  à 1 image/seconde **uniquement tant qu'un viewer est présent**
  (`tokio::time::interval`, pas de capture ni de bande passante sinon).
  Reconnexion avec délai fixe de 5s en cas de coupure.
- **Refactor minimal de `controlme.rs`** : le corps de `run_control_me`
  extrait dans `run_control_me_core` (prend directement les `Arc<...>`
  au lieu de `State<'_, T>`, pour être appelable depuis `remote.rs` sans
  passer par l'IPC Tauri), la commande `#[tauri::command]` d'origine
  devient un wrapper de 3 lignes. **Aucune modification du corps de la
  boucle Gemini elle-même** : quand une instruction arrive par broadcast,
  `remote.rs` appelle `run_control_me_core` directement, puis s'abonne
  temporairement aux **mêmes événements Tauri locaux**
  (`control-me-step`/`-message`/`-done`/`-error`/`-cancelled`/`-limit`,
  via `app.listen`/`app.unlisten`) déjà émis normalement par la boucle,
  et les rediffuse tels quels sur le salon Realtime — plus simple et plus
  sûr qu'ajouter un paramètre "diffuseur" à travers toute la boucle
  Gemini, et **bénéfice gratuit** : une instruction déclenchée à distance
  s'affiche aussi en direct dans `ControlMeView` local si l'app est
  ouverte, exactement comme une instruction locale.
  **Lacune connue, assumée** : `control-me-confirmation-required` n'est
  **pas** rediffusé — une pause `safety_decision` déclenchée par une
  instruction distante ne peut aujourd'hui être résolue que depuis l'app
  locale (Réglages/ControlMeView), pas depuis le site. Corriger ça
  demanderait que le site envoie son propre broadcast
  accepter/refuser routé vers `resolve_control_me_confirmation` — pas
  construit dans cette passe, noté comme limite réelle plutôt que caché.
- **Modèle de sécurité, documenté explicitement, pas caché** : le code est
  un **secret partagé sans authentification supplémentaire** — quiconque
  le connaît (ou le devine) peut voir l'écran et contrôler le PC. Même
  posture de compromis que "autonome par défaut, Stop est le seul
  garde-fou" déjà en place pour Control Me local. Espace de 10¹² codes
  (12 chiffres) : deviner au hasard est déjà impraticable sans la moindre
  protection supplémentaire.
  **Protection anti-brute-force demandée explicitement, entièrement côté
  site** (`site/controlremote.html`) : puisqu'aucune table Postgres ne
  valide un code, "code inexistant" ne peut être détecté que par un
  **timeout de 8 secondes sans présence `host`** après avoir rejoint le
  salon — regroupe "code faux" et "app éteinte", indistinguable sans
  backend, assumé comme tel. Compteur d'échecs dans le `localStorage` du
  navigateur ; à la 5ᵉ tentative échouée, l'appareil passe en
  `ollamachat_remote_banned = true` et le formulaire de saisie disparaît
  définitivement sur ce navigateur. **Ce timeout ne s'applique qu'à la
  saisie explicite d'un nouveau code** — la reconnexion automatique avec
  un code déjà enregistré ne compte jamais comme un échec (l'app locale
  simplement pas encore lancée n'est pas une tentative de piratage).
  **Limite honnête** : protection entièrement côté client, contournable en
  vidant le `localStorage`/navigation privée/autre appareil — un vrai frein
  contre un script bête qui boucle dans le même navigateur, pas une
  garantie contre un attaquant qui changerait de contexte à chaque
  tentative. Pistes plus robustes explicitement proposées mais **pas
  construites** (au choix, si redemandées) : ralentissement progressif
  entre tentatives, rotation automatique du code, alerte système
  immédiate dans l'app à toute connexion, un seul viewer à la fois,
  validation côté serveur (réintroduirait une table Postgres + RLS +
  Edge Function — la vraie solution robuste si le contournement du ban
  local devient un problème réel).
- **`site/controlremote.html`** (nouveau, statique, même philosophie zéro
  build que `index.html`) : charge `@supabase/supabase-js` via CDN
  (`type="module"`, jsDelivr `/+esm` — vérifié que `supabase.channel(nom)`
  correspond bien au topic Phoenix `realtime:{nom}` construit à la main
  côté Rust, API `channel.on("presence"/"broadcast", ...)`/`.track()`/
  `.send()`/`.subscribe()` vérifiée contre la doc officielle avant
  d'écrire le JS). Code sauvegardé dans `localStorage`
  (`ollamachat_remote_code`) : présent → reconnexion immédiate sans
  ressaisie ; absent → formulaire. Bouton **Se déconnecter** vide
  uniquement le code sauvegardé (pas le compteur d'échecs/ban, qui lui
  reste indépendant). Vue écran (`<img>` dont le `src` devient le dernier
  `data:image/jpeg;base64,...` reçu — pas de canvas/vidéo, le plus simple
  et robuste), transcript de chat (`textContent` partout, jamais
  `innerHTML`, contenu venant du réseau), bouton Arrêter. Lien ajouté
  dans `site/index.html` (section Control Me existante, pas de nouvelle
  barre de nav).
- **Réglages** (Control Me → nouvelle sous-section) : bouton "Générer un
  code" (affiche le code, avertissement de sécurité explicite),
  "Régénérer"/"Désactiver", indicateur **live** "Connecté : oui/non"
  alimenté par l'événement Tauri `remote-viewer-changed` (émis par
  `remote.rs` à chaque `presence_diff` du salon) — voir "Réglages en page
  pleine (v0.5.7)" ci-dessous pour la nouvelle organisation.
- `cargo check` passé à 0 erreur **ni avertissement** dès la première
  tentative pour tout le client WebSocket écrit à la main (une vraie
  surprise vu la nouveauté du code, mais confirmé, pas supposé).
  **Aucune vérification de bout en bout possible dans cet environnement**
  — contrairement à toute fonctionnalité précédente, celle-ci a besoin de
  deux bouts vivants en même temps (l'app lancée + un navigateur sur le
  site déployé), totalement hors de portée ici (pas d'accès GUI, pas de
  déploiement Vercel déclenchable). Protocole écrit d'après la doc sans
  jamais l'avoir vu tourner en vrai — risque réel de détail subtil (nom
  de topic, format de `ref`, timing du heartbeat) qui ne se révélera qu'à
  l'usage. **À tester explicitement par l'utilisateur** après build +
  déploiement du site : génération du code, jumelage depuis le site
  (écran + indicateur "connecté" des deux côtés), instruction envoyée
  depuis le site exécutée sur le PC, bouton Arrêter, fermeture/réouverture
  du site (reconnexion automatique sans ressaisir), déconnexion + nouveau
  code, et les 5 tentatives ratées → bannissement.

### Réglages en page pleine (v0.5.7)

Demandé explicitement, groupé avec le contrôle à distance : refonte
complète des Réglages, qui n'avaient pas bougé depuis le tout début du
projet — `SettingsModal.tsx` (169 lignes, une seule popup plate,
`.modal-overlay`/`.modal`) **supprimé entièrement**, remplacé par
`src/components/SettingsView.tsx`, une **page pleine** avec plusieurs
sections, même pattern exact que Codex/Control Me (`view` dans `App.tsx`
gagne une 4ᵉ valeur `"settings"`, lazy + `Suspense`, plus d'état modal
séparé — `Sidebar.tsx` : le bouton Paramètres appelle `setView("settings")`
au lieu d'ouvrir une popup, et gagne le même surlignage d'état actif que
Codex/Control Me).

- Navigation interne simple (colonne de gauche, `.settings-nav`) entre
  quatre sections : **Général** (host Ollama/contexte max/prompt système,
  contenu déplacé tel quel), **Modèles installés** (liste/suppression,
  déplacé tel quel, **+ bouton "Installer un modèle"** qui ouvre la même
  `HuggingFaceBrowser` qu'avant — retiré de la Sidebar sur demande
  explicite, `onOpenInstall` remonté à `SettingsView` au lieu de
  `Sidebar`), **Control Me** (nouvelle organisation : modèle
  Gemini — même `<select>` que dans `ControlMeView.tsx`, persiste le même
  `settings.gemini_model`, une seule source de vérité éditable à deux
  endroits cohérents — clé API Gemini, et le jumelage à distance décrit
  ci-dessus), **Mises à jour** (déplacé tel quel).
- Un seul bouton "Enregistrer" reste global (pas un par section) pour les
  champs texte (Général) — évite plusieurs flux de sauvegarde divergents.
  Le modèle Gemini et le code de jumelage, eux, persistent **immédiatement**
  à chaque changement (même pattern que `handlePersistControlMeModel`
  existant / les nouvelles commandes `generate_remote_code`/
  `clear_remote_code` qui sauvegardent déjà côté Rust) — pas de double
  sauvegarde ni d'incohérence si l'utilisateur quitte la page sans cliquer
  "Enregistrer".
- CSS : `.settings-view`/`.settings-nav`/`.settings-content`/
  `.settings-section` (nouvelles classes) réutilisent les styles déjà
  partagés par `.modal` pour les champs/boutons (`label`/`input`/
  `textarea`/`select`/`button` étendus pour cibler aussi
  `.settings-section`, pas dupliqués) et le système d'animation déjà en
  place depuis la v0.5.5 (`view-in` pour l'entrée de la page).

### Mémoire visible depuis le site distant (v0.5.7)

Demandé explicitement en discussion libre après le contrôle à distance :
que la mémoire de Control Me (`remember_fact`) fonctionne aussi "pour le
contrôle à distance". Deux clarifications tranchées avec l'utilisateur
avant de coder : la mémoire **reste locale** (le fichier JSON existant
reste la source de vérité — pas de vraie base Supabase, pour ne pas
rouvrir la posture "Postgres en lecture seule" qu'on venait de préserver
avec le design Broadcast/Presence), et **pas de vrais embeddings** (la
liste simple actuelle suffit, cohérent avec ce qui était déjà documenté).

- Nouvel événement `memory` diffusé sur le même salon Realtime
  (`payload: { entries }`) : poussé (a) à chaque nouveau viewer qui
  rejoint le salon (`presence_diff` avec un `join` autre que `"host"`),
  et (b) après chaque `control-me-done`/`-error`/`-cancelled` (au cas où
  `remember_fact` a été appelé pendant le run). `load_memory`/
  `save_memory` rendues `pub(crate)` dans `controlme.rs` pour être
  appelables depuis `remote.rs`.
- Nouveau broadcast entrant `clear_memory` (site → app) : appelle
  `save_memory(app, &[])` puis repousse la mémoire (vide) — équivalent
  distant du bouton "Tout effacer" déjà existant dans `ControlMeView.tsx`.
- **Refactor important au passage** : les 6 listeners Tauri locaux
  (`attach_mirrors`) sont maintenant attachés **une seule fois pour toute
  la durée de la connexion** (`run_connection`), pas seulement pendant
  qu'une instruction déclenchée à distance est en vol comme dans la
  première version. Corrige un vrai trou : une session Control Me lancée
  **localement** (utilisateur assis devant son PC) n'était jusque-là
  jamais reflétée sur le site connecté, alors que le plan d'origine disait
  bien "chaque événement... est aussi rediffusé". Nettoyage RAII
  (`MirrorGuard`, `impl Drop`) plutôt qu'un `unlisten` manuel à chaque
  `return` de `run_connection` — même raisonnement que `WatchdogGuard`
  dans `watchdog.rs`.
- Site (`site/controlremote.html`) : bouton **Mémoire** dans la barre de
  statut, panneau repliable (même style visuel que le panneau de l'app,
  catégorie + fait), bouton "Tout effacer" avec confirmation `confirm()`.

### Correctifs de vitesse et de fiabilité (v0.5.7)

Deux retours groupés dans la même session : "le truc de touche enfoncée
ne fonctionne pas" et "fais en sorte que l'IA soit encore plus rapide...
avec ui automation et tout".

- **Vrai bug corrigé, trouvé en lisant le code source d'enigo** (pas
  supposé) : `key_down` ne faisait strictement rien d'utile. `execute_action`
  crée une nouvelle instance `Enigo` à **chaque appel**, et enigo a
  `impl Drop for Enigo` qui relâche automatiquement toutes les touches
  maintenues quand l'instance est détruite
  (`release_keys_when_dropped: true` par défaut, vérifié dans
  `enigo-0.6.1/src/lib.rs` et `win_impl.rs`) — donc `key_down` appuyait la
  touche puis la relâchait **immédiatement** en sortant de la fonction,
  avant même que la capture d'écran suivante ne la voie enfoncée. Corrigé
  en passant `release_keys_when_dropped: false` à la construction de
  l'`Enigo` dans `execute_action`. L'état réel d'une touche sous Windows
  (`SendInput`) est indépendant de l'instance qui l'a envoyé, donc ça ne
  change rien au comportement de `Direction::Press`/`Release` eux-mêmes —
  juste à l'auto-nettoyage en sortie de fonction. **Contrepartie réelle,
  assumée** : si l'app est tuée pendant qu'une touche est maintenue sans
  `key_up` correspondant, elle peut rester physiquement bloquée enfoncée —
  inhérent au fait que "maintenir une touche" fonctionne enfin pour de
  vrai, pas quelque chose qu'une instance par appel pouvait empêcher de
  toute façon (elle empêchait juste le "maintenir" de marcher du tout).
- **`read_ui_elements` ne livrait pas le gain de vitesse annoncé** : après
  cet outil (et `remember_fact`), la boucle attendait quand même
  `wait_for_settle` puis recapturait et renvoyait un screenshot complet —
  alors qu'aucun des deux ne touche jamais l'écran. Nouvelle constante
  `NO_VISUAL_EFFECT_TOOLS` (`read_ui_elements`, `remember_fact`) : pour ces
  deux outils, ni attente ni capture d'écran, juste le texte du résultat —
  toutes les autres actions gardent le comportement inchangé (attente
  adaptative + capture).
- Description de l'outil `read_ui_elements` renforcée pour que Gemini le
  **préfère activement** à `computer_use` quand il doit localiser un
  élément précis dans une fenêtre standard, plutôt que de le présenter
  comme un simple complément optionnel — pure ingénierie de prompt, aucune
  garantie de comportement (reste à la discrétion du modèle).

### Mode de perception "Windows UI" (v0.5.7)

Demandé explicitement, dans la continuité directe du point précédent :
un vrai bouton pour basculer **entre** captures d'écran et UI Automation,
plutôt que les deux qui coexistent seulement comme aujourd'hui. Nouveau
réglage `Settings.control_me_perception_mode` (`"capture"` par défaut, ou
`"windows_ui"`), toggle dans Réglages > Control Me (même composant visuel
`.mode-toggle` que le bascule Auto/Approbation de Codex).

- **`computer_use` est fondamentalement un outil piloté par capture
  d'écran** — son protocole attend une image à chaque tour, il n'a pas de
  mode "texte seul". En mode `windows_ui`, il est donc **entièrement
  retiré** du tableau `tools`, remplacé par des **outils `function`
  personnalisés** qui reproduisent un par un le jeu d'actions déjà
  implémenté dans `execute_action` (click/double_click/triple_click/
  middle_click/right_click/mouse_down/mouse_up/move/type/drag_and_drop/
  wait/press_key/key_down/key_up/hotkey/scroll) — **mêmes noms de
  paramètres exacts**, donc `execute_action`/`dispatch_action` n'ont besoin
  d'aucune modification pour gérer les deux modes : seul le tableau
  `tools` construit en amont change (`build_capture_tools()` vs
  `build_windows_ui_tools()`, `controlme.rs`). Les coordonnées restent
  dans le même repère normalisé 0-999 que `read_ui_elements` renvoie déjà
  — une position lue peut être réutilisée directement pour cliquer, sans
  conversion.
- **Aucune capture d'écran n'est jamais prise dans ce mode**, ni comme
  observation initiale ni après une action : `read_foreground_ui_elements`
  fournit le texte à la place. Nouveau helper `primary_screen_size()`
  (juste `monitor.width()`/`.height()` de `xcap`, sans capturer le moindre
  pixel — vérifié que ces accesseurs existent et sont bon marché avant de
  les utiliser) pour la normalisation des coordonnées, sans avoir besoin
  d'un screenshot juste pour connaître la résolution. `primary_monitor()`
  extrait en fonction partagée (`capture_screenshot_base64`,
  `capture_grayscale_thumb`, et ce nouveau helper l'utilisent tous les
  trois — déduplication au passage, pas de changement de comportement).
- **Attente post-action différente** : pas d'attente adaptative par
  diff de pixels (`wait_for_settle`, ça n'a pas de sens sans écran à
  comparer) — un délai fixe court (`UI_MODE_SETTLE_MS`, 150ms, pas testé
  visuellement) avant de relire l'arbre d'accessibilité, sauf après un
  `read_ui_elements` explicite (déjà à jour, pas de double lecture).
- **Contrepartie réelle, assumée et affichée dans l'UI** : le signal de
  sécurité `safety_decision: require_confirmation` de Gemini fait partie
  du protocole propre à `computer_use` — un outil `function` personnalisé
  n'a pas d'équivalent. Ce garde-fou **n'existe pas** en mode
  `windows_ui`. C'est pour ça que `"capture"` reste le mode par défaut
  (bascule explicite requise, jamais une surprise) et que l'avertissement
  est visible directement sous le bouton dans Réglages, pas seulement
  documenté ici.
- Bénéfice non demandé mais réel, à noter : en mode `windows_ui`, **aucune
  image n'est jamais envoyée à Google**, seulement du texte (libellés de
  contrôles, jamais le contenu visuel de l'écran) — réduit nettement ce
  qui transite par rapport à l'exception réseau déjà documentée pour
  Control Me (captures d'écran complètes à chaque étape en mode
  `"capture"`).
- `cargo check` et `npx tsc --noEmit` passés à 0 erreur ni avertissement.
  **Pas de vérification visuelle possible dans cet environnement** — en
  particulier, aucun moyen de confirmer ici que Gemini se comporte bien
  avec un tableau `tools` sans `computer_use` (jamais documenté par
  Google comme combinaison testée) ; à valider par l'utilisateur.

### Base de connaissances Control Me — "DB ready for Control Me" (v0.5.7)

Demandé explicitement, dans le prolongement de la discussion sur les
extensions (système complet de plugins indépendamment mis à jour, mis en
pause plus tôt — voir plus bas) : une capacité concrète et scopée plutôt
que le système générique. Un dossier local que l'utilisateur remplit
lui-même (fichiers `.txt`/`.json`/`.sql`), que Control Me peut lire comme
base de connaissances de référence — différent de la mémoire auto-apprise
(`remember_fact`) : ici, c'est l'utilisateur qui choisit explicitement le
contenu, pas l'IA qui infère des faits. **Correction demandée
immédiatement après une première version** : l'interface fonctionnelle
(statut du dossier, "Ouvrir le dossier", publier, importer) ne doit pas
vivre *dans* Réglages, seulement l'y avoir mentionnée dans une première
passe — un vrai espace **Extensions** dans la Sidebar, au même niveau que
Codex/Control Me/Paramètres (`src/components/ExtensionsView.tsx`,
nouveau, même pattern lazy + `Suspense` que les autres vues), porte
l'interface réelle de "DB ready for Control Me". Réglages > Extensions
garde uniquement une liste **en lecture seule** nom + description par
extension (`EXTENSIONS` dans `SettingsView.tsx`) — correspond à "chaque
extension a une description" sans y mêler l'interface fonctionnelle. Pas
le système de plugins complet (versions indépendantes, activation
générique) — juste cette capacité précise, nommée/décrite, avec sa propre
place dans l'app.

- **Dossier `{app_data_dir}/controlme_knowledge/`**, marqué avec
  l'attribut **caché Windows** (`SetFileAttributesW` +
  `FILE_ATTRIBUTE_HIDDEN`, feature `Win32_Storage_FileSystem` ajoutée à
  la dépendance `windows` déjà présente — API vérifiée par compilation
  réelle, `HSTRING::from(path.to_string_lossy())` passé directement,
  pas devinée sans vérifier). **Honnête à documenter, pas survendu** : un
  dossier caché est un frein cosmétique (décourage un dépôt
  accidentel/casual), **pas un vrai contrôle d'accès** — un processus
  tournant avec les droits de l'utilisateur (dont un malware déjà actif)
  voit un dossier caché aussi facilement qu'un dossier normal.
- **Validation "tout ou rien"** (`src-tauri/src/commands/knowledge_base.rs`,
  nouveau fichier) : si un seul fichier du dossier n'a pas l'extension
  `.txt`/`.json`/`.sql`, la lecture est **entièrement refusée** (pas un
  filtrage silencieux qui ignore juste le fichier en trop) et les noms
  des fichiers fautifs sont renvoyés à l'utilisateur — correspond
  littéralement à la demande ("si y'a que la db et pas autre chose").
  Contenu concaténé et plafonné à 50 Ko (`MAX_TOTAL_BYTES`, même logique
  de garde-fou que les plafonds de `read_ui_elements`).
- **Ce que ça protège réellement, sans survendre** : le filtrage par
  extension bloque le vecteur "déposer un exécutable/script" (`.exe`/
  `.ps1`/`.bat`/`.vbs`/`.js`/`.lnk`...), et le contenu n'est **jamais
  exécuté ni interprété** — même un fichier `.sql` n'est lu que comme
  texte brut renvoyé à Gemini, aucun moteur de base de données ne
  l'exécute nulle part dans ce projet. Ce que ça ne protège **pas** :
  l'injection de prompt (du texte malveillant dans un `.txt` par ailleurs
  autorisé, visant à manipuler Gemini) — aucun filtre par type de fichier
  ne peut empêcher ça, catégorie de risque différente, déjà couverte pour
  Control Me par `enable_prompt_injection_detection`.
- **Nouvel outil Gemini `read_knowledge_base`**, ajouté aux deux modes de
  perception (`build_capture_tools()` et `build_windows_ui_tools()` dans
  `controlme.rs`, orthogonal au mode de perception comme `remember_fact`)
  et à `NO_VISUAL_EFFECT_TOOLS` (aucun effet sur l'écran, même
  optimisation de vitesse que `read_ui_elements`/`remember_fact` — pas
  d'attente, pas de capture après coup). Dispatché dans `dispatch_action`
  avant `execute_action`, jamais passé à enigo. Dossier vide ou absent →
  message clair plutôt qu'une erreur.
- **Publication publique via Supabase — première écriture `anon` de tout
  ce projet**, rupture assumée et documentée, pas un oubli. Jusqu'ici,
  Supabase est strictement en lecture seule pour `anon` (choix explicite
  documenté dans Décisions techniques). Nouvelle table
  `public.controlme_knowledge_shares` (migration
  `supabase/knowledge_base_migration.sql`, **à exécuter par
  l'utilisateur** comme toute migration précédente) avec policies
  `insert to anon using (true)` **et** `select to anon using (true)` —
  **aucune policy `update`/`delete`** (même choix initial que
  `app_releases`) : une base publiée reste publique et immuable pour
  toujours depuis cette version, pas de bouton "dépublier" (ce projet n'a
  aucun système de comptes/auth, donc aucune notion de "propriétaire"
  d'une ligne pour restreindre qui pourrait la modifier/supprimer — à
  reconsidérer seulement si un vrai besoin de dépublication se présente).
  Avertissement explicite affiché **avant** publication (`window.confirm`
  dans `SettingsView.tsx`), pas seulement documenté ici : "Ce contenu
  sera visible publiquement par n'importe qui, sans limite de durée, et
  ne peut pas être retiré depuis cette version de l'app."
- **Pas d'annuaire/de découverte construit** : publier renvoie un
  `share_code` (génération aléatoire réutilisant le même alphabet sans
  caractères ambigus que le code de jumelage distant) que l'utilisateur
  communique lui-même — pas de page listant toutes les bases publiques
  (une vraie fonctionnalité de marketplace, explicitement hors scope,
  pas construite sans redemande). "Importer via un code"
  (`import_knowledge_base`) récupère le contenu d'un `share_code` donné
  et l'écrit en local (copie ponctuelle, pas une synchronisation en
  direct).
- Nouvelle section **Confidentialité réseau** (6ᵉ point) : publication/
  import passent par l'API REST Supabase, uniquement à l'action explicite
  de l'utilisateur (bouton Publier/Importer), jamais automatiquement.
- `cargo check`/`npx tsc --noEmit` passés à 0 erreur ni avertissement dès
  la première tentative (y compris pour l'appel `SetFileAttributesW`,
  vérifié par compilation réelle plutôt que suppose). **Aucune
  vérification de bout en bout possible dans cet environnement** (pas
  d'accès GUI, pas d'exécution SQL sur le vrai projet Supabase depuis
  cet environnement) — à tester explicitement par l'utilisateur : dépôt
  d'un fichier non autorisé (doit être refusé en listant le fichier
  fautif), lecture par Gemini de fichiers valides, publication vérifiée
  via `curl` avec la clé anon, import sur un second poste.

### Panic de démarrage sur le thread principal (v0.5.8)

Bug critique signalé par l'utilisateur immédiatement après la publication
de la v0.5.7 : cliquer "Générer un code" (jumelage à distance, Réglages >
Control Me) faisait planter l'app, et surtout, **relancer l'app plantait
aussi, à chaque fois, sans exception** — l'app était devenue totalement
inutilisable.

Cause trouvée en relisant `remote.rs` : `start_remote_task` appelait
`tokio::spawn(...)` **directement**, plutôt que `tauri::async_runtime::
spawn(...)`. Cette fonction est appelée depuis deux endroits : la commande
`generate_remote_code` (déclenchée par le clic utilisateur), et
`resume_remote_on_startup`, appelée sans condition dans le hook `setup()`
de `lib.rs` — **sur le thread principal**, avant tout event loop GUI, dès
qu'un `remote_code` existe déjà dans `settings.json` (précisément pour
que le site se reconnecte automatiquement sans repasser par Réglages,
voir "Control Me à distance depuis le site (v0.5.7)").

Le thread principal d'une app Tauri n'a **jamais** de runtime Tokio
"entré" (pas de `.enter()`/contexte thread-local ambient) — Tauri
maintient son propre `Handle` vers un runtime Tokio en interne, mais un
`tokio::spawn` brut ne le consulte pas, il cherche le contexte
thread-local courant. Résultat : panic immédiat ("there is no reactor
running, must be called from the context of a Tokio 1.x runtime") **sur
le thread principal**, ce qui tue tout le processus (le panic n'est
attrapé nulle part, contrairement à un panic dans une tâche tokio déjà
spawnée qui reste isolé à cette tâche). Comme `remote_code` reste
persisté dans `settings.json` une fois généré, ce panic se reproduisait
à **chaque lancement suivant**, sans que l'utilisateur n'ait rien à
cliquer — d'où "l'app ne se lance plus du tout".

Corrigé en remplaçant les deux appels `tokio::spawn` de `remote.rs`
(`start_remote_task` et `spawn_remote_instruction`) par
`tauri::async_runtime::spawn` — l'API sûre depuis n'importe quel thread
dans une app Tauri, documentée précisément pour ce genre de cas (elle
utilise le `Handle` que Tauri conserve lui-même, pas le contexte
thread-local ambient). `RemoteHandle.task` a dû changer de type
(`tauri::async_runtime::JoinHandle<()>` au lieu de
`tokio::task::JoinHandle<()>` — ce ne sont pas des alias l'un de l'autre,
confirmé par une erreur de compilation immédiate en essayant le
remplacement direct, pas supposé). **Leçon retenue** : `tokio::spawn`
brut n'est sûr que depuis du code qui s'exécute déjà à l'intérieur du
runtime (une tâche déjà spawnée, ou un contexte explicitement entré) —
dans du code appelé depuis `setup()` ou depuis une commande Tauri
synchrone, toujours utiliser `tauri::async_runtime::spawn`. À vérifier
pour tout futur `tokio::spawn` ajouté dans ce projet.

**Pour un utilisateur déjà bloqué par ce bug avant la mise à jour** :
éditer `%APPDATA%\com.userasus.ollama-chat-react\settings.json` à la main
(app fermée), mettre `"remote_code": null`, relancer — l'app démarre
alors normalement (sans écoute distante active) et peut se mettre à jour
vers la version corrigée.

`cargo check` passé à 0 erreur après le correctif. **Pas de reproduction
possible dans cet environnement** (aucun `settings.json` avec
`remote_code` renseigné n'existe sur cette machine de développement — le
bug a été diagnostiqué uniquement par lecture de code, pas reproduit
localement) — cause root confirmée par le raisonnement sur le
fonctionnement de Tokio/Tauri plutôt que par un test en conditions
réelles ; **à confirmer par l'utilisateur** que le crash a bien disparu
après installation de la v0.5.8.

### Extensions : hub léger (v0.5.8)

Demande explicite de l'utilisateur, avec un vrai problème d'architecture
sous-jacent clarifié via `AskUserQuestion` avant de coder : Codex et
Control Me devaient apparaître dans l'espace Extensions, avec
"désinstaller"/"mettre à jour" par extension et un bouton "tout mettre à
jour". Or Codex et Control Me sont compilés dans le **même binaire** que
tout le reste de l'app — il n'existe aucun système de modules
indépendants (le système de plugins complet, avec versioning indépendant
par module, a été explicitement mis en pause plus tôt dans ce projet, et
ce n'est toujours pas ce qui a été construit ici). Deux clarifications
tranchées par l'utilisateur (options recommandées choisies dans les
deux cas) :

- **"Désinstaller" = interrupteur réversible, pas une vraie
  désinstallation.** Nouveau champ `Settings.disabled_extensions:
  Vec<String>` (ids `"codex"` / `"controlme"` / `"knowledge_base"`),
  persisté comme le reste des réglages. Pour `"codex"`/`"controlme"`,
  désactiver masque uniquement le bouton correspondant dans la Sidebar
  (`Sidebar.tsx` filtre son rendu sur `disabledExtensions`) — rien n'est
  supprimé du binaire, réactivable à tout instant. Pour
  `"knowledge_base"`, désactiver a un effet réel côté Control Me :
  `build_capture_tools`/`build_windows_ui_tools` (`controlme.rs`)
  prennent maintenant un paramètre `include_knowledge_base: bool`, lu
  depuis `disabled_extensions` au début de `run_control_me_core` —
  l'outil `read_knowledge_base` n'est simplement plus proposé à Gemini
  quand désactivé (les fichiers restent sur le disque, juste plus lus
  pendant une session).
- **"Mettre à jour" = un seul bouton, pas une fausse mise à jour par
  carte.** Il n'existe qu'une seule vraie mise à jour possible (l'app
  entière, un seul `.exe`, via l'auto-updater déjà en place) — proposer
  un bouton "Mettre à jour" par extension aurait été trompeur (rien ne se
  mettrait à jour indépendamment). `ExtensionsView.tsx` gagne donc un
  bouton unique **"Tout mettre à jour"** en en-tête, réutilisant
  exactement le même état déjà lifté dans `App.tsx`
  (`checkingUpdate`/`availableUpdate`/`installingUpdate`/
  `onCheckUpdate`/`onInstallUpdate`, déjà utilisé par Réglages > Mises à
  jour) plutôt qu'un second système de vérification en parallèle.

Les deux chemins d'accès à Codex/Control Me restent disponibles (choisi
explicitement plutôt que de retirer les boutons Sidebar dédiés) :
`ExtensionsView.tsx` affiche maintenant trois cartes (Codex, Control Me,
DB ready for Control Me), chacune avec un bouton "Ouvrir" (navigue vers
la vue correspondante, désactivé si l'extension est elle-même
désactivée) et un bouton Activer/Désactiver. Réglages > Extensions reste
inchangé (liste en lecture seule nom + description uniquement, comme
tranché à la correction précédente).

### Correctif CSS boutons non stylés (v0.5.8)

Retour utilisateur direct : "les boutons dans Paramètres et Extensions
sont moches, dans Codex aussi". Cause trouvée en auditant `App.css` :
`.modal button, .settings-section button` (fond/rayon/padding) ne
couvrait que les boutons **à l'intérieur** de ces deux conteneurs précis
— chaque nouvel ajout d'UI dans un conteneur différent depuis plusieurs
versions (approbation inline Codex dans `.tool-approval-inline`, en-tête
et confirmation de Control Me dans `.controlme-header`/`.controlme-confirm`,
et la totalité du nouvel espace `ExtensionsView.tsx`) n'avait jamais été
ajouté à cette liste — ces boutons s'affichaient donc avec le chrome brut
par défaut du navigateur (gris, 3D), jurant avec le reste de
l'interface sombre et personnalisée. Un vrai bug d'oubli répété, pas
une question de goût.

Corrigé en stylant l'élément `button` **directement, globalement**
(fond `#2c2c2c`, rayon 8px, padding, `:hover`/`:disabled`) plutôt que de
continuer à étendre une liste de sélecteurs à chaque nouvelle vue —
élimine toute la catégorie de bug plutôt que de patcher les 5 endroits
trouvés un par un (et n'importe quel bouton futur en profite
automatiquement). `.modal button, .settings-section button` (devenu
redondant) supprimé.

**Piège de spécificité CSS repéré avant de committer, pas après** : un
sélecteur `button:hover { ... }` brut a une spécificité de (0,1,1) — le
sélecteur de type `button` compte pour 1, ce qui le rend **plus
spécifique** qu'un sélecteur à une seule classe comme
`.editor-tab-close:hover` (0,1,0), et l'aurait donc silencieusement
emporté sur des dizaines de couleurs de survol/désactivé déjà
personnalisées ailleurs dans l'app (`.editor-tab-close`,
`.installed-model-delete`, `.send-btn:disabled`...). Corrigé en utilisant
`:where(button)` pour les variantes `:hover`/`:disabled`/`:active`
(`:where()` neutralise toujours sa propre spécificité à zéro) — reste un
filet de secours de priorité minimale, jamais capable de l'emporter sur
un sélecteur de classe existant. Au passage, corrigé le même piège déjà
présent (avant cette session) sur la règle `:active` globale ajoutée en
v0.5.5, qui empêchait silencieusement `.editor-tab-close:active` de
jouer son propre `scale(0.85)`.

`.send-btn` (bouton d'envoi rond, icône positionnée en `inset: 0`)
recevait désormais un padding non désiré du nouveau style global — ajouté
`padding: 0` explicitement pour préserver son rendu exact (vérifié par
lecture du CSS, pas testé visuellement — pas d'accès GUI dans cet
environnement).

### Ctrl+S enregistrait du contenu périmé (v0.6.0)

Retour utilisateur : "control S ne fonctionne toujours pas dans codex" —
malgré le correctif WebView2 de la v0.3.4 (qui empêchait le navigateur
d'intercepter le raccourci avant que la page ne le reçoive). Un second
bug, totalement distinct, existait en dessous : `EditorPane.tsx` enregistre
la commande Monaco `Ctrl+S` dans `onMount`, qui ne s'exécute **qu'une
seule fois** par instance d'éditeur (chaque changement d'onglet remonte
l'éditeur via `key={active.path}`, mais taper dans le même fichier ne le
fait pas). Le callback passé à `editorInstance.addCommand(...)` fermait
directement sur `onSave` (prop) et `active` (variable locale) — une
closure figée à l'instant du montage. `onSave` pointe vers `handleSave`
dans `CodexView.tsx`, qui lit `openFiles` par fermeture sur l'état de
**son propre rendu** — pas l'état le plus récent. Résultat concret :
Ctrl+S enregistrait sur disque le contenu du fichier **tel qu'il était à
l'ouverture de l'onglet**, ignorant silencieusement toute frappe faite
depuis — pendant que l'indicateur "non enregistré" (point orange sur
l'onglet) se remettait à zéro comme si tout s'était bien passé, laissant
croire que la sauvegarde avait réussi. Un bug classique de closure périmée
dans un point d'échappement impératif (l'API `addCommand` de Monaco
contourne le cycle de rendu React). Corrigé avec un `useRef` mis à jour à
chaque rendu (`onSaveRef.current = onSave` dans un `useEffect`), et le
callback Monaco appelle `onSaveRef.current(...)` au lieu de `onSave(...)`
directement — `active.path` reste utilisé tel quel dans la closure (il ne
change jamais sans un remontage, contrairement au contenu). `npx tsc
--noEmit` passé à 0 erreur. **Pas de test visuel possible dans cet
environnement** — à confirmer par l'utilisateur.

### Réglages/Extensions restructurés (v0.6.0)

Trois demandes explicites groupées : Control Me ne doit plus avoir sa
propre section dans Réglages (ses réglages doivent vivre sous une petite
icône réglages sur sa carte, dans Réglages > Extensions), le bouton "Tout
mettre à jour" doit être dans Réglages > Extensions plutôt que dans
l'espace Extensions lui-même (qui gagne une recherche à la place), et une
notification de mise à jour désactivable.

- `SettingsView.tsx` : `SECTIONS` passe de
  `["general","models","controlme","extensions","updates"]` à
  `["general","models","extensions","devices","updates"]` — plus de
  section `controlme` dédiée. La carte "Control Me" dans
  `EXTENSIONS` (tableau local) porte `hasSettings: true` ; un clic sur
  l'icône `⚙` qu'elle affiche bascule `openGear` et révèle un panneau
  inline (`.extension-gear-panel`, animation `panel-open` déjà existante)
  contenant exactement ce qui vivait avant dans la section Control Me
  dédiée (modèle Gemini, clé API, bascule capture/Windows UI) — Codex n'a
  pas d'icône réglages (rien à configurer à ce niveau, son bascule
  Auto/Approbation reste dans `CodexView.tsx` lui-même).
- Un bouton "Tout mettre à jour" (+ bandeau "Installer X.Y.Z" si
  disponible) apparaît en haut de la section Extensions, réutilisant
  exactement le même état déjà lifté dans `App.tsx`
  (`checkingUpdate`/`availableUpdate`/`installingUpdate`/`onCheckUpdate`/
  `onInstallUpdate`) — aucun second système de vérification.
- Nouvelle case à cocher `form.update_popup_enabled` (nouveau champ
  `Settings.update_popup_enabled: bool`, défaut `true` via
  `#[serde(default = "default_true")]`) — le toast "Nouvelle version
  disponible" dans `App.tsx` se masque désormais aussi si
  `settings.update_popup_enabled === false`, en plus de ses conditions
  existantes (version différente, pas sur Réglages).
- **"Appareils connectés"** remplace le bloc "Contrôle à distance"
  auparavant niché dans la section Control Me — même code de jumelage,
  mêmes commandes (`generateRemoteCode`/`clearRemoteCode`), juste
  déplacé dans sa propre section de navigation et son libellé généralisé
  ("discute avec le modèle qui tourne sur ce PC... et contrôle son écran
  si Control Me est activé" au lieu de la description Control-Me-only
  d'avant) — cohérent avec le fait qu'un seul code sert maintenant les
  deux (voir "Chat distant unifié avec Control Me (v0.6.0)").
- `ExtensionsView.tsx` (l'espace Sidebar) perd le bouton "Tout mettre à
  jour" (et les props `checkingUpdate`/`availableUpdate`/etc. associées)
  et gagne un champ de recherche (`.extensions-search`, dans l'en-tête) —
  filtre les cartes Codex/Control Me **et** la liste des skills par nom/
  description (une seule recherche, portée volontairement large plutôt
  que deux champs séparés).

### DB skill for Control Me (v0.6.0)

Remplace entièrement "DB ready for Control Me" (v0.5.7) — retour de
l'utilisateur : "il faut obligatoirement un nom et une description et pas
un code", plus toute une série de demandes (liste de skills visibles,
choix du skill à fournir avant une session, extraction automatique depuis
une session passée, skills téléchargeables). L'ancien design (un seul
dossier plat de fichiers `.txt`/`.json`/`.sql` validés en bloc) ne
permettait aucune de ces choses — refonte complète plutôt que patch.

- **`src-tauri/src/commands/skills.rs`** (nouveau, remplace
  `knowledge_base.rs` supprimé) : `Skill { id, name, description, content,
  is_public, share_code, created_at }`, un fichier JSON par skill dans
  `{app_data_dir}/controlme_skills/` (même dossier cache Windows que
  l'ancien design, même raison : frein cosmétique, pas un vrai contrôle
  d'accès) — pattern JSON-par-item déjà utilisé partout ailleurs dans ce
  projet (conversations, sessions Control Me, mémoire) plutôt qu'inventer
  un format dossier-par-skill-avec-sous-fichiers. `name`/`description`
  obligatoires, validés côté Rust (`validate()`) avant toute écriture —
  correspond littéralement à la demande "obligatoirement un nom et une
  description".
- **Sélection avant une session** : `run_control_me`/`run_control_me_core`
  gagnent un paramètre `active_skill_ids: Vec<String>` — le contenu des
  skills choisis est **préfixé directement à l'instruction** (même
  mécanisme que le préchargement de la mémoire `remember_fact`, juste
  appliqué aux skills explicitement sélectionnés plutôt qu'à tout le
  fichier mémoire), pas exposé comme outil `read_knowledge_base` que
  Gemini devait penser à appeler — l'utilisateur a déjà fait le choix
  explicitement, il n'y a plus rien à décider pour le modèle. L'outil
  `read_knowledge_base` et tout ce qui y touchait dans `controlme.rs`
  (`build_capture_tools`/`build_windows_ui_tools` reprennent leur
  signature sans paramètre) sont supprimés. Panneau "Skills" dans
  `ControlMeView.tsx` (à côté de Mémoire/Historique) — liste à cases à
  cocher, comptable dans le libellé du bouton
  (`Skills (2)`).
- **Publication/téléchargement** : `publish_skill` écrit `name`,
  `description`, `content` dans `controlme_knowledge_shares` (même table
  que l'ancien design — migration `supabase/skills_migration.sql`,
  **à exécuter par l'utilisateur** : renomme `title` en `name`, ajoute
  `description NOT NULL DEFAULT ''`, aucune policy RLS à toucher).
  `unpublish_skill` est **local uniquement** — remet `is_public`/
  `share_code` à faux/`None` côté app, mais **ne retire rien de ce qui
  est déjà sur Supabase** (aucune policy `update`/`delete` pour `anon`,
  décision assumée depuis le tout premier design de cette table, voir
  "Base de connaissances Control Me (v0.5.7)") — documenté explicitement
  dans le commentaire de module de `skills.rs`, pas caché. Nouveau
  `list_public_skills()` (parcours de tous les skills publics, pas juste
  par code) — gratuit : la policy `select to anon using (true)` déjà en
  place pour la recherche par code autorise déjà lister toute la table,
  aucun changement de schéma/RLS nécessaire pour ça.
- **"Extraire les informations"** (`extract_skill_from_transcript`,
  `skills.rs`) : appel Gemini **ponctuel, sans outils, sans boucle** (juste
  `input: [{type:"text", text: prompt}]`, pas de `tools` dans le corps) —
  distinct de la boucle agentique de Control Me dans `controlme.rs`, un
  simple appel de génération de texte. Le prompt inclut le contenu actuel
  du skill (peut être vide) + le transcript de la session choisie, et
  demande une réécriture complète et à jour. Le résultat est affiché dans
  le champ de contenu de l'éditeur pour relecture — **jamais appliqué
  automatiquement**, l'utilisateur doit encore cliquer "Enregistrer".
  "Quand ya qu'un seul fichier choisi" (contrainte demandée explicitement)
  est satisfait par construction plutôt que par une vérification
  séparée : l'éditeur de `ExtensionsView.tsx` n'ouvre jamais qu'un seul
  skill à la fois (cliquer une ligne de la liste = ouvrir son éditeur),
  donc il n'existe structurellement aucun état où "plusieurs sont
  sélectionnés" — pas besoin du message d'avertissement décrit dans la
  demande, l'ambiguïté qu'il visait à couvrir ne peut simplement pas se
  produire.
- **"Désinstaller" a un vrai sens ici**, contrairement à Codex/Control Me
  (voir "Extensions : hub léger (v0.5.8)") : `delete_skill` supprime
  réellement le fichier JSON local — un skill est un vrai fichier créé
  par l'app, pas une fonctionnalité compilée dans le binaire.
- `ExtensionsView.tsx` réécrit entièrement : carte "DB skill for Control
  Me" avec liste de skills (`.skill-list`/`.skill-row`, recherche
  partagée avec les cartes Codex/Control Me), bouton "Nouveau skill",
  éditeur inline (nom/description/contenu + sélecteur de session pour
  l'extraction + publier/rendre privé/désinstaller/enregistrer), section
  "Parcourir les skills publics" repliable + import manuel par code en
  secours.
- `cargo check`/`npx tsc --noEmit` passés à 0 erreur. **Aucune
  vérification de bout en bout possible dans cet environnement**
  (nécessite une vraie clé API Gemini pour tester l'extraction, et un
  accès GUI pour tout le reste) — à tester par l'utilisateur : créer un
  skill, le sélectionner dans une session Control Me, publier/vérifier
  via `curl` avec la clé anon, importer sur un second poste, extraire
  depuis une session passée.

### Chat distant unifié avec Control Me (v0.6.0)

Demande explicite, avec un changement de modèle assez profond par
rapport au design de la v0.5.7 : "je veux qu'il y ait qu'un seul code" —
jusqu'ici, le code de jumelage vivait dans la section Control Me des
Réglages et ne donnait accès qu'à Control Me sur le site. Maintenant, ce
même code (même canal Realtime, aucun second système) donne accès à
**deux onglets** sur le site : Chat (discuter avec le modèle Ollama qui
tourne sur le PC) et Control Me (si activé localement) — voir "Réglages/
Extensions restructurés (v0.6.0)" pour le renommage de la section en
"Appareils connectés".

- **Relais de chat, `remote.rs`** : `chat::send_chat` est une commande
  Tauri **synchrone** (pas `async fn`) qui spawn son propre thread et
  émet des événements `chat-chunk`/`chat-done`/`chat-error`/
  `chat-cancelled` — appelable directement avec un `AppHandle` et les
  `State<T>` qu'elle attend (`app.state::<ChatCancelFlag>()`/
  `app.state::<Watchdog>()`), exactement comme `run_control_me_core`
  était déjà appelée directement depuis `remote.rs` sans passer par l'IPC
  Tauri. `chat::list_models` utilise `reqwest::blocking` en interne —
  appelée via `tokio::task::spawn_blocking` pour ne jamais bloquer le
  thread qui fait tourner toute la connexion WebSocket (heartbeats, tick
  d'écran) le temps qu'Ollama réponde.
- **Événements de mirroring préfixés** : `attach_mirrors` (déjà en place
  pour Control Me depuis la v0.5.7) mirrore maintenant aussi
  `chat-chunk`/`chat-done`/`chat-error`/`chat-cancelled`, mais sous les
  noms `chat_chunk`/`chat_done`/`chat_error`/`chat_cancelled` (préfixés)
  plutôt que les noms courts de Control Me (`step`/`message`/`done`/
  `error`/`cancelled`) — sans ça, "done" serait ambigu entre "une session
  Control Me vient de finir" et "une réponse de chat vient de finir" sur
  le même canal partagé, côté site.
- **Nouveaux événements entrants** (site → app, dans `handle_incoming`) :
  `chat_message` (`{messages, model}`, appelle `spawn_remote_chat`),
  `chat_stop` (déclenche `ChatCancelFlag`, même flag que le chat local —
  cohérent, un seul chat actif à la fois de toute façon), `list_models`
  (répond avec un broadcast `models`).
- **Capacités annoncées à la connexion** : nouvel événement
  `capabilities` (`{chat: true, controlme: bool}`), poussé à chaque
  nouveau viewer comme la mémoire (`push_capabilities`, même point
  d'accroche que `push_memory` dans `presence_diff`). Codex n'est **jamais**
  annoncé (aucun équivalent distant sensé pour un éditeur de code piloté
  depuis un téléphone/navigateur) — `chat` est toujours `true` (le chat de
  base existe forcément), `controlme` reflète `disabled_extensions`.
- **`site/controlremote.html` réécrit** : barre d'onglets Chat/Control Me
  (Control Me masqué si `capabilities.controlme` est faux), onglet Chat
  avec sélecteur de modèle (peuplé via `list_models` à la première
  ouverture de l'onglet), zone de conversation, champ de saisie, bouton
  Arrêter. Rendu des messages de chat en **texte brut uniquement**
  (`textContent`, jamais `innerHTML`) — même discipline que le reste de
  cette page (mémoire/étapes/messages Control Me déjà en `textContent`),
  délibérément pas de dépendance markdown ajoutée juste pour ce nouvel
  onglet.
- **Windows UI branché automatiquement pour les sessions distantes** :
  `run_control_me_core` gagne un paramètre `force_windows_ui: bool` —
  `true` pour toute instruction déclenchée par `spawn_remote_instruction`
  (peu importe le réglage local de l'utilisateur), `false` pour la
  commande IPC locale (`run_control_me`, comportement inchangé, respecte
  toujours le réglage local). Raisonnement : le flux d'écran que voit le
  site (`broadcast_frame_if_viewer`) est **totalement indépendant** de ce
  que Gemini perçoit lui-même — donc basculer Gemini en mode texte
  (Windows UI) pour une session distante ne prive le viewer de rien, tout
  en étant plus rapide et en n'envoyant aucune image à Google.
  **Vérification explicite demandée** ("trouve un moyen de vérifier que
  l'UI ne lance pas de prompt ni de LLM, juste regarder l'ui") : tracé le
  code de `read_foreground_ui_elements`/`read_ui_elements` (`controlme.rs`/
  `ui_automation.rs`) — c'est un parcours **purement local** de l'arbre
  UI Automation Windows (COM), aucun appel réseau, aucun appel à l'API
  Gemini nulle part dans cette fonction ; le mode `windows_ui` retire même
  `computer_use` du tableau `tools` (voir "Mode de perception Windows UI
  (v0.5.7)"), donc **aucune image n'est jamais capturée ni envoyée** dans
  ce mode — seul du texte transite vers Gemini (l'instruction + le
  contenu de `read_foreground_ui_elements`), jamais vers un autre service.
  Vérifié par lecture de code, pas par un test réseau en direct (pas de
  clé API Gemini disponible dans cet environnement pour observer le
  trafic réellement émis).
- **Lacune connue, héritée du design v0.5.7, pas nouvelle** :
  `control-me-confirmation-required` n'est toujours pas mirroré — une
  pause `safety_decision` (mode capture uniquement) déclenchée à distance
  ne peut toujours être résolue que depuis l'app locale. Sans rapport
  avec le nouveau chat (le chat n'a pas de mécanisme de confirmation).
- `cargo check` passé à 0 erreur ni avertissement dès la première
  tentative. **Aucune vérification de bout en bout possible dans cet
  environnement** (nécessite l'app lancée ET un navigateur sur le site
  déployé en même temps) — à tester explicitement par l'utilisateur :
  jumelage, onglet Chat (liste de modèles, envoi, streaming, Arrêter),
  bascule automatique vers l'onglet Chat si Control Me est désactivé,
  onglet Control Me toujours fonctionnel comme avant.

### Le vrai bug du contrôle à distance : protocole Realtime jamais fonctionnel (v0.6.1)

Retour utilisateur après premier vrai test : "ya un bug meme si je mets le
bon code, ca mets comme quoi le code est incorrect". Jusqu'ici, chaque
version touchant `remote.rs` (v0.5.7 pour sa création, v0.5.8 pour le
correctif de crash, v0.6.0 pour l'ajout du chat) n'avait pu être
**"vérifiée" que par lecture attentive de la documentation Realtime** —
jamais testée contre un vrai client, faute d'accès GUI dans cet
environnement. Ce test utilisateur était la toute première confrontation
réelle du protocole, et il a révélé que **la fonctionnalité entière
n'avait jamais marché**, depuis son introduction.

**Méthode de découverte — la différence cette fois** : plutôt que de
continuer à deviner à partir de la doc, installation dans le scratchpad
d'une vraie instance de `@supabase/supabase-js` (via `npm install`) pour
servir de référence de comportement, et écriture d'un client WebSocket
brut en Node (l'API `WebSocket` native, disponible depuis Node 22+)
reproduisant *exactement* ce que `remote.rs` envoie sur le fil. Les deux
tournés l'un à côté de l'autre contre le vrai serveur Supabase Realtime
du projet, en interceptant et loggant chaque trame envoyée/reçue de
chaque côté (y compris en patchant `globalThis.WebSocket` pour sniffer ce
que la vraie librairie envoie réellement, plutôt que de faire confiance
à sa documentation). Quatre bugs distincts trouvés et corrigés, chacun
vérifié individuellement en le reproduisant puis en confirmant qu'il
disparaît :

1. **`vsn=1.0.0` au lieu de `vsn=2.0.0`** dans l'URL de connexion
   WebSocket. Un `phx_join` envoyé avec `vsn=1.0.0` est accepté par le
   serveur au niveau TCP/WebSocket (la connexion reste ouverte,
   `readyState` passe bien à `OPEN`) mais **n'obtient jamais la moindre
   réponse** — pas de `phx_reply`, pas d'erreur, pas de fermeture,
   silence total y compris après 20+ secondes d'attente. Repéré en
   sniffant l'URL que le vrai client `supabase-js` construit lui-même :
   `vsn=2.0.0`, jamais `1.0.0` — la doc/les souvenirs qui avaient mené au
   choix initial de `1.0.0` étaient simplement obsolètes ou faux.
2. **Payload de join incomplet.** Même avec `vsn=2.0.0`, un payload de
   join sans les champs `postgres_changes: []` et `private: false` (que
   `remote.rs` n'envoyait pas) obtient le même silence total qu'avec le
   mauvais `vsn` — le serveur semble exiger la présence de ces champs
   pour traiter le join, même s'ils ne servent à rien pour un canal
   Broadcast/Presence pur sans Postgres Changes. Corrigé en envoyant
   exactement le payload que le vrai client envoie (sniffé, pas deviné) :
   `{broadcast: {...}, presence: {enabled: false, key: "host"}, postgres_changes: [], private: false}`
   — noter au passage que `presence.enabled` vaut `false` chez le vrai
   client (pas `true` comme envoyé jusqu'ici), voir point suivant pour
   pourquoi ce n'est pas contradictoire.
3. **Aucun message de présence "track" explicite envoyé après le join.**
   Le champ `presence.key` dans le payload de join réserve seulement une
   *identité* pour la présence — il ne fait strictement rien tout seul.
   Le vrai client envoie un message séparé après confirmation du join :
   `[join_ref, ref, topic, "presence", {type:"presence", event:"track", payload:{...}}]`.
   Sans ce message, `run_connection` rejoignait le canal avec succès
   (une fois les deux bugs précédents corrigés) mais **n'apparaissait
   jamais dans `presence_diff`/`presence_state`** — donc `hostOnline`
   restait `false` indéfiniment côté site, qui abandonnait après le
   timeout de 8s et affichait "code invalide ou appareil hors ligne" —
   **exactement le symptôme rapporté**, alors que le code était pourtant
   correct. `run_connection` attend maintenant explicitement le
   `phx_reply` du join (boucle avec timeout de 10s) avant d'envoyer ce
   message de track — même séquencement que le vrai client.
4. **Les broadcasts utilisent un format binaire propriétaire, pas du
   JSON texte.** Le plus gros des quatre, et celui qui aurait cassé
   *tout le reste* même après avoir corrigé les trois premiers : lire le
   vrai code source de `@supabase/realtime-js`
   (`serializer.ts`, installé dans le scratchpad, pas deviné) révèle que
   `channel.send({type:"broadcast", ...})` n'envoie **jamais** de JSON
   texte — toujours une trame binaire "userBroadcastPush" (kind `3`) :
   un en-tête de 7 octets (kind, puis les longueurs en octets de
   join_ref/ref/topic/event/metadata, puis le type d'encodage) suivi des
   octets bruts de chaque champ puis du payload JSON. Et en réception, le
   serveur relaie un broadcast aux autres abonnés dans un format binaire
   **différent** ("userBroadcast", kind `4`, sans join_ref/ref puisque
   non pertinents pour un abonné qui n'a pas poussé le message). Une
   trame JSON texte portant `event: "broadcast"` est tout simplement
   **ignorée sans erreur** par le serveur — jamais délivrée à personne.
   `handle_incoming` ne traitait jusque-là que `Message::Text`
   (`let Message::Text(text) = msg else { return };`) — toute trame
   binaire entrante (donc **tous** les broadcasts envoyés par le site :
   `instruction`, `stop`, `chat_message`...) était silencieusement
   jetée. Et `build_broadcast` construisait du JSON texte — donc tout ce
   que l'app tentait d'envoyer au site (écran, étapes, messages,
   mémoire...) ne partait jamais nulle part non plus. Corrigé par
   `build_broadcast` (encodage kind 3) et un nouveau
   `decode_broadcast_binary` (décodage kind 4) dans `remote.rs`, tous
   deux vérifiés **byte pour byte** en comparant leur sortie/entrée avec
   les vraies trames capturées du client officiel — pas juste "ça
   compile".

**Vérification finale, complète et bidirectionnelle, effectuée pour de
vrai** (pas juste "par lecture de code" comme pour tout le reste de cette
fonctionnalité jusqu'ici) : un client Node reproduisant exactement le
comportement corrigé de `remote.rs` connecté en parallèle d'un vrai
client `supabase-js`, contre le vrai serveur Supabase Realtime du projet
— présence confirmée dans les deux sens (`{"host":[...], "viewer-final":[...]}`),
broadcast host→viewer reçu et décodé correctement par le vrai client
(`ch.on("broadcast", {event:"step"}, ...)` déclenché avec le bon
payload), broadcast viewer→host décodé correctement par la reproduction
Rust-équivalente
(`{"event":"instruction","payload":{"text":"bonjour depuis le viewer"}}`,
exactement ce que le vrai client avait envoyé). C'est la toute première
fois dans ce projet que cette fonctionnalité est confirmée fonctionner de
bout en bout autrement que par la lecture de sa propre implémentation.

**Portée de ce que ça implique** : toutes les versions depuis la v0.5.7
documentaient "aucune vérification de bout en bout possible dans cet
environnement" pour Control Me à distance — ce n'était pas une prudence
excessive, c'était littéralement vrai, et la fonctionnalité n'a jamais
marché avant ce correctif, malgré plusieurs passes de "vérification par
lecture de documentation" qui semblaient raisonnables sur le moment.
**Leçon pour ce projet** : pour un protocole réseau bas niveau
réimplémenté à la main (plutôt qu'une librairie officielle), la
documentation ne suffit pas — quand une vraie implémentation de
référence existe (ici `@supabase/supabase-js`), l'installer et sniffer
ce qu'elle envoie réellement sur le fil est la seule vérification qui
compte, dès que c'est possible de le faire (ça l'était depuis le début
dans cet environnement — `npm install` fonctionne très bien en dehors du
build Tauri lui-même — mais ça n'avait jamais été fait avant ce
correctif).

`cargo check` passé à 0 erreur après chaque correctif. Deux demandes
complémentaires traitées dans la même passe, une fois le protocole
réparé et vérifiable :

- **Skills dans leur propre espace Sidebar** (`src/components/SkillsView.tsx`,
  nouveau) : tout le CRUD de skills (créer/éditer/publier/parcourir/
  importer/extraire) déplacé hors de `ExtensionsView.tsx` (qui ne garde
  plus que les cartes Codex/Control Me + leur interrupteur/recherche)
  vers son propre bouton Sidebar "Skills" — retour explicite de
  l'utilisateur ("db skill for control me doit etre une interface
  accessible depuis l'espace ou se trouve codex et parametre"), même
  leçon déjà apprise une fois avec "DB ready" avant sa refonte en
  skills (voir "Extensions : vrai espace Sidebar" plus haut) —
  réappliquée un niveau plus haut cette fois : une carte parmi d'autres
  dans un espace partagé reste trop peu visible pour une fonctionnalité
  avec sa propre interface de création.
- **Sélection de skill(s) depuis le site** : jusqu'ici local-app-only
  (voir "DB skill for Control Me (v0.6.0)" — décision de scope
  explicitement révisée ici). Nouveau broadcast entrant `list_skills`
  (site → app, `handle_broadcast_event` appelle directement
  `skills::list_skills`, déjà une commande Tauri ordinaire donc
  appelable sans IPC) et sortant `skills` (réponse, liste
  id/nom/description). Le payload du broadcast `instruction` gagne un
  champ `active_skill_ids` (tableau d'ids), lu côté Rust et transmis à
  `run_control_me_core` exactement comme le fait déjà `ControlMeView.tsx`
  localement — `spawn_remote_instruction` et `run_control_me_core`
  n'avaient besoin d'aucun changement de logique, juste de faire
  transiter ce paramètre au lieu de toujours passer un vecteur vide.
  Site (`site/controlremote.html`) : bouton "Skills" dans l'onglet
  Control Me, panneau à cases à cocher (réutilise le style visuel
  `.memory-panel`/`.memory-entry` déjà en place), demandé à l'ouverture
  de l'onglet ou du panneau si pas encore chargé.

**Aucune vérification GUI de bout en bout possible dans cet
environnement** pour la partie app-locale de ces deux derniers points
(espace Skills, sélection distante) — seul le protocole Realtime
lui-même a pu être vérifié empiriquement cette fois, pas l'interface
React/le rendu réel. À tester par l'utilisateur : jumelage (devrait
maintenant réussir avec le bon code), écran + chat + Control Me
fonctionnels sur le site, sélection de skill(s) visible et effective
dans l'onglet Control Me du site, nouvel espace Skills dans la Sidebar de
l'app.

### Deuxième bug réel de Codex : tool_calls jamais structuré (v0.6.2)

Retour utilisateur : "l'ia de codex n'est toujours pas capable de faire
des commande" — malgré les correctifs v0.3.3 (renforcement du system
prompt) et v0.3.4 (filet de secours pour un bloc markdown ` ```powershell
`). Cette fois, vérifié pour de vrai plutôt que patché à l'aveugle une
troisième fois : Ollama tourne réellement sur cette machine de
développement (`http://127.0.0.1:11434`), avec `qwen2.5-coder:3b`
installé — le modèle que CLAUDE.md mentionnait déjà être celui testé par
l'utilisateur lors du tout premier signalement de ce bug (v0.3.3). Un
appel direct à `/api/chat`, avec exactement le même corps de requête
qu'`agent.rs` construit (`tools` + `stream: true`) et une instruction
demandant explicitement d'exécuter une commande, montre que **le modèle
ne remplit jamais le champ `tool_calls` structuré de la réponse** — au
lieu de ça, il écrit l'appel voulu en JSON texte brut dans
`message.content`, sans le moindre bloc de code :

```
{"name": "run_powershell_command", "arguments": {"command": {"type": "string", "description": "...", "value": "Get-ChildItem 'C:\\Users\\userAsus\\Documents'"}}}
```

Deux choses cassent en même temps : (1) Ollama annonce pourtant
`"capabilities":["completion","tools","insert"]` pour ce modèle — le
template de chat supporte le function calling, mais un modèle de 3B
paramètres reste peu fiable pour l'invoquer correctement à chaque fois,
un problème connu des petits modèles quantisés ; (2) même le filet de
secours markdown existant ne peut pas rattraper ce cas précis, puisqu'il
n'y a **aucun bloc de code fence** — juste du JSON brut en préfixe/à la
place du texte de la réponse. Les deux correctifs précédents supposaient
tous les deux que le modèle échouerait d'une manière ou d'une autre déjà
anticipée (soit un vrai `tool_calls`, soit un bloc markdown) — aucun ne
couvrait "le modèle écrit du JSON brut, mal formé, sans balisage".

Nouveau second filet de secours (`extractFallbackJsonToolCall`,
`useAgentLoop.ts`), essayé seulement si ni un vrai `tool_calls` ni un
bloc markdown n'a été trouvé :
- Essaie `JSON.parse` sur le contenu entier, puis, si ça échoue, sur le
  sous-texte entre la première `{` et la dernière `}` (au cas où le
  modèle ajoute une phrase avant/après le JSON).
- Accepte la forme `{name, arguments}` directement ou imbriquée sous
  `{function: {name, arguments}}` (les deux formes existent selon les
  modèles/versions).
- Vérifie que `name` correspond à un outil réellement connu de l'app
  (`read_file`/`list_dir`/`write_file`/`edit_file`/
  `run_powershell_command`/`ask_user_question`) — évite de déclencher un
  faux positif sur un JSON sans rapport présent ailleurs dans une
  réponse.
- **Dépliage d'un niveau d'imbrication en trop**, observé tel quel dans
  la vraie réponse ci-dessus : au lieu de `{"command": "..."}`, le modèle
  a écrit `{"command": {"type": "string", "description": "...", "value":
  "..."}}` — confondant la définition du schéma de l'outil (qui a bien
  des champs `type`/`description`) avec la valeur à lui passer.
  `unwrapSchemaShapedValue` détecte ce cas précis (un objet contenant une
  clé `value`) et extrait `.value` à la place de l'objet entier.

**Vérifié avec les vraies données capturées**, pas juste "ça compile" :
un script Node reproduisant exactement `extractFallbackJsonToolCall`
appliqué à la réponse brute réellement renvoyée par `qwen2.5-coder:3b`
extrait correctement
`{"name": "run_powershell_command", "arguments": {"command": "Get-ChildItem 'C:\\Users\\userAsus\\Documents'"}}`
— à la fois sur le JSON seul et avec une phrase de politesse ajoutée
autour. `npx tsc --noEmit` passé à 0 erreur. Le reste de la boucle
(exécution de l'outil, approbation, retour du résultat au modèle) est
inchangé — ce correctif n'ajoute qu'une deuxième façon de reconnaître
l'intention du modèle, la même mécanique d'exécution que le filet
markdown existant prend le relais ensuite.

### Comptes et marketplace d'extensions (v0.6.3)

Demande explicite, la plus large de tout ce projet à ce jour : un vrai
système de comptes (login Google), profils (pseudo public unique, photo
de profil), plusieurs appareils par compte (nommables, on peut changer
entre eux depuis le site), une bascule "compte développeur", et un espace
développeur pour publier des extensions — examinées par une IA (Gemini
3.7) avant publication, refusées si jugées dangereuses, marquées "non
officielle" par défaut, installables avec une double confirmation
(confiance au créateur + à ses risques et périls).

**Décision de scope tranchée avant de coder, communiquée à l'utilisateur
plutôt que devinée en silence** : "un vrai système de plugins" a été
choisi explicitement (via `AskUserQuestion`, entre une version allégée —
juste un annuaire de skills — et un vrai moteur d'exécution de code
tiers). Mais **exécuter du code arbitraire uploadé** exigerait un vrai
bac à sable (aucun n'existe dans ce projet — l'app tourne avec les droits
complets de l'utilisateur, accès fichiers/PowerShell sans restriction) :
la seule façon responsable de le faire serait un runtime WASM
(wasmtime), avec une API de capacités explicite (l'extension ne peut
appeler que ce que l'hôte expose volontairement) — un chantier
d'architecture de plusieurs semaines à lui seul, pas quelque chose à
improviser en une nuit même avec l'accord de l'utilisateur pour "le vrai
système". Décision assumée : **v1 reste déclarative** — une extension est
un ajout de texte au prompt système (cible "chat" ou "controlme"), dans
le même esprit que les skills déjà en place, jamais du code exécuté. La
revue Gemini porte sur CE texte (tentative de manipulation de l'IA,
contenu trompeur), un problème beaucoup plus tractable pour une IA que
"ce code est-il sûr à exécuter". Le schéma (`extension_versions.manifest`
en `jsonb`) est conçu pour pouvoir grossir vers un vrai type d'extension
"code" plus tard sans tout reconstruire, si un runtime sandboxé est
construit un jour — pas promis, juste pas fermé.

- **`supabase/accounts_marketplace_migration.sql`** (nouveau, **à
  exécuter par l'utilisateur**, comme toute migration précédente ; exige
  aussi d'activer manuellement le fournisseur Google dans Auth >
  Providers côté dashboard Supabase — fait par l'utilisateur en parallèle
  de cette session) : cinq tables.
  - `profiles` (id = auth.users.id, `username` unique avec contrainte de
    format strict `^[a-z0-9_]{3,24}$` — évite les usurpations visuelles
    sur un pseudo affiché publiquement comme auteur —, `avatar_url`,
    `is_developer`). Lecture publique (anon+authenticated), écriture
    limitée à sa propre ligne.
  - `devices` (appareils appairés, rattachés à un compte — voir plus
    bas). Entièrement privé, aucune policy publique.
  - `extensions` (métadonnées : nom, description, `is_official`).
    **`is_official` protégée colonne par colonne** — RLS seule ne peut
    pas restreindre une colonne dans une ligne qu'on a par ailleurs le
    droit de modifier (une policy s'applique à la ligne entière), donc
    `revoke update on extensions from authenticated` suivi de
    `grant update (name, description) to authenticated` : le propriétaire
    peut modifier nom/description, jamais le badge officiel — seule la
    clé `service_role`, à la main, après revue humaine, le peut. Publier
    exige `profiles.is_developer = true` (vérifié par sous-requête RLS
    directement, pas seulement côté app).
  - `extension_versions` (contenu réellement versionné, immuable une fois
    publié — même posture que `app_releases`/
    `controlme_knowledge_shares` : aucune policy update/delete pour
    `authenticated`). `manifest jsonb` porte `{target, system_prompt_addition}`.
    `safety_verdict`/`safety_reasoning` gardent une trace du verdict
    Gemini qui a permis la publication (une ligne n'existe que si le
    verdict était "safe" — un verdict "unsafe" n'insère jamais rien,
    refusé entièrement côté site avant le moindre appel à Supabase).
  - `extension_installs` (une ligne par paire extension/appareil,
    upsert — empêche un même appareil de gonfler artificiellement le
    compteur en désinstallant/réinstallant) + fonction
    `extension_install_count(uuid)` en `security definer` pour exposer un
    compte public sans avoir besoin d'une policy `select` large sur la
    table elle-même (qui aurait permis à n'importe qui de lister quel
    appareil a installé quoi).
  - **Deux vrais bugs trouvés et corrigés avant publication, pas après**
    (relecture systématique du SQL/JS avant de considérer le travail
    fini, cohérent avec la discipline du reste de cette session) :
    (1) `extensions.owner_id`/`devices.owner_id` référençaient
    `auth.users(id)` — PostgREST a besoin d'une clé étrangère **directe**
    entre deux tables pour les joindre via la syntaxe d'imbrication
    (`extensions.html` fait `select("...,profiles(username)")`) ; même si
    `profiles.id` référence lui-même `auth.users(id)` (mêmes valeurs au
    final), l'absence de FK directe `extensions → profiles` aurait fait
    échouer cette requête avec une erreur "no relationship found".
    Corrigé en pointant directement vers `profiles(id)`. (2) la policy
    Storage pour les avatars vérifie
    `(storage.foldername(name))[1] = auth.uid()` (convention Supabase
    standard, dossier par utilisateur) mais `account.js` construisait un
    chemin plat `{id}.jpg` (zéro segment de dossier) — l'upload aurait
    été systématiquement rejeté par RLS. Corrigé en utilisant
    `{id}/avatar.jpg`.
- **`site/account.js`** (nouveau) : module partagé chargé par les quatre
  pages du site (`index.html`, `controlremote.html`, `dev.html`,
  `extensions.html`) — client Supabase unique pour l'auth (distinct du
  client Realtime déjà écrit à la main dans `controlremote.html`, qui
  reste inchangé), `signInWithGoogle`/`signOut`, `onProfileChange`
  (pattern pub/sub simple, pas de framework), `claimUsername`/
  `updateUsername`/`setDeveloper`/`uploadAvatar`, `listDevices`/
  `renameDevice`/`attachDevice`. `renderAccountBar(container)` monte une
  barre de compte (bouton "Se connecter" / avatar + menu déroulant)
  réutilisée identiquement sur les quatre pages.
- **`site/dev.html`** (nouveau) : espace développeur. Interrupteur animé
  "Mode développeur" (`<input type="checkbox">` caché + `<span>` stylé en
  glissière, transition CSS — pas de librairie d'animation, cohérent avec
  la préférence déjà établie du projet). Recadrage d'avatar : un simple
  crop carré centré via `<canvas>` (pas de recadrage interactif par
  glisser-déposer — hors budget de temps ce soir, documenté comme
  simplification plutôt que caché) redimensionné à 256px, encodé en JPEG.
  Formulaire de publication : nom/description/cible/version/contenu + la
  clé API Gemini de l'utilisateur (jamais stockée, utilisée une seule
  fois pour l'appel de revue) → `reviewSafety()` appelle directement
  `generativelanguage.googleapis.com/v1beta/interactions` depuis le
  navigateur (même modèle "clé API personnelle de l'utilisateur, jamais
  fournie par l'app" que Control Me) avec un prompt de revue de sécurité
  dédié, extrait un JSON `{verdict, reasoning}` de la réponse ; seul un
  verdict `"safe"` déclenche l'insertion dans `extensions`/
  `extension_versions`.
- **`site/extensions.html`** (nouveau) : marketplace publique, recherche
  côté client sur nom/description, badge cible (Chat de base/Control Me)
  et officiel/non-officiel, compteur d'installations (via la fonction
  `security definer`), bouton "Copier l'identifiant" — pas de bouton
  "Installer" qui agirait directement depuis le site : l'installation
  réelle se fait côté app (voir plus bas), le site ne fait que fournir
  l'identifiant à coller.
- **Pont site → app** : `src-tauri/src/commands/skills.rs` gagne
  `import_marketplace_extension(extension_id)` — récupère la dernière
  version publiée d'une extension (lecture publique `anon`, aucune
  authentification nécessaire côté app) et la matérialise comme un skill
  local ordinaire, réutilisant entièrement l'infrastructure skills déjà
  en place plutôt que d'inventer un second concept "extension installée"
  séparé. **Seules les extensions ciblant `"controlme"` s'installent
  ainsi** — une cible `"chat"` modifierait le prompt système du chat de
  base, ce qui n'est pas sûr à faire silencieusement sans que
  l'utilisateur ne relise le contenu d'abord ; retourne une erreur claire
  plutôt que de le faire quand même. Câblé dans `SkillsView.tsx`
  (`importMarketplaceExtension`) avec la double confirmation demandée
  explicitement, combinée en une seule boîte de dialogue `window.confirm`
  couvrant à la fois "fais-tu confiance à ce créateur" et "à tes risques
  et périls, l'app n'est pas responsable" — plutôt que deux popups
  natives successives, jugé moins pénible pour un résultat équivalent
  (les deux avertissements sont bien montrés, l'utilisateur doit
  explicitement valider pour continuer).
- `cargo check`/`npx tsc --noEmit` passés à 0 erreur après correction des
  deux bugs ci-dessus. **Aucune vérification de bout en bout possible
  dans cet environnement** — ni le flux OAuth Google réel, ni l'upload
  Storage, ni l'appel de revue Gemini n'ont pu être testés contre de
  vraies interactions navigateur. À tester explicitement par
  l'utilisateur après exécution de la migration : connexion Google,
  choix de pseudo, upload de photo, activation du mode développeur,
  publication d'une extension (avec un contenu manifestement sûr, puis
  avec un contenu délibérément suspect pour vérifier que Gemini la
  refuse), installation depuis l'app via l'identifiant copié, gestion des
  appareils (renommer, changer).

### Marketplace v0.7 : compte enrichi, page GitHub-like par extension, installation en un clic

Demande explicite, la plus détaillée du projet à ce jour : refonte complète
du site façon GitHub (landing impressionnante, compteur temps réel,
grille de recherche à deux colonnes, page dédiée par extension avec
galerie et bouton "Ajouter" qui installe automatiquement dans l'app sans
étape manuelle), menu de compte restructuré (avatar Google réel, panneau
"Notre compte" partagé, bascule développeur dans le menu, déconnexion en
rouge), et une bibliothèque de fonctions documentées pour écrire des
extensions plus fiables. S'appuie entièrement sur les fondations de
"Comptes et marketplace d'extensions (v0.6.3)" ci-dessus — aucune table
existante retirée, uniquement étendue.

**Installation en un clic — la partie techniquement la plus risquée,
validée en premier avant le reste.** Le navigateur ne peut pas parler
directement à une app de bureau installée ; le mécanisme standard est un
**schéma d'URL personnalisé** (`ollamachat://...`) que l'OS route vers
l'app plutôt que vers un site web. Deux plugins Tauri officiels ajoutés,
avec leur documentation/code source lus avant d'écrire quoi que ce soit
(même discipline que pour enigo/xcap/uiautomation en leur temps) :
- **`tauri-plugin-deep-link`** — enregistre `ollamachat` comme schéma
  (`tauri.conf.json` → `plugins.deep-link.desktop.schemes`, forme exacte
  vérifiée dans le code source de `tauri-utils` — `desktop` accepte un
  objet unique `{schemes: [...]}}` ou une liste). Sur le tout premier
  lancement (app pas encore ouverte, l'OS la démarre avec l'URL comme
  argument), le plugin lit déjà `std::env::args()` tout seul dans son
  propre `setup()` — vérifié dans son code source, aucun code
  supplémentaire nécessaire côté `lib.rs` pour ce cas précis.
- **`tauri-plugin-single-instance`** (feature `deep-link` activée) —
  **doit être enregistré en premier dans le `Builder`** (exigé
  explicitement par la doc du plugin). Nécessaire spécifiquement parce que
  ce projet est Windows-only : sur Windows/Linux, cliquer un lien
  `ollamachat://` alors que l'app tourne déjà ne déclenche PAS
  d'événement vers l'instance existante — l'OS relance un **second**
  processus avec l'URL comme unique argument (documenté explicitement
  comme limitation par `tauri-plugin-deep-link` lui-même). Ce plugin
  intercepte ce second lancement, le termine, et transmet son `argv` à
  l'instance déjà ouverte ; avec la feature `deep-link`, il appelle
  automatiquement `deep_link.handle_cli_arguments(args)` avant le
  callback fourni (vérifié dans le code source du plugin, pas supposé) —
  notre callback se contente de ramener la fenêtre au premier plan
  (`window.show()` + `set_focus()`, utile si l'app était planquée dans le
  tray). Sans ce second plugin, cliquer "Ajouter" pendant que l'app est
  déjà lancée n'aurait strictement rien fait.
- URL utilisée : `ollamachat://install-extension/<id-extension>`. Côté
  app, un nouveau `useEffect` dans `App.tsx` importe dynamiquement
  `@tauri-apps/plugin-deep-link`, vérifie `getCurrent()` au montage (cas
  premier lancement) **et** s'abonne à `onOpenUrl` (cas app déjà
  ouverte) — les deux chemins existent réellement selon la doc du plugin,
  donc les deux sont couverts plutôt que de parier sur un seul. L'URL est
  parsée avec `new URL(...)` (`hostname === "install-extension"`,
  `pathname` = l'identifiant), puis réutilise **exactement** le même
  `importMarketplaceExtension` que le champ de collage manuel dans
  Skills (v0.6.3) — donc hérite automatiquement de sa restriction
  existante (seules les extensions ciblant `"controlme"` s'installent
  réellement, une cible `"chat"` renvoie une erreur claire) sans code
  supplémentaire. Double confirmation préservée : un `confirm()` côté
  site juste avant la redirection (`extension.html`), un second
  `window.confirm()` côté app juste avant l'appel réel — le clic seul sur
  "Ajouter" n'installe jamais rien sans ce second geste explicite.
- Capability `deep-link:default` ajoutée à `capabilities/default.json`
  (même pattern que chaque plugin précédent). Schéma enregistré
  uniquement pour l'app de chat principale (`tauri.conf.json`), pas pour
  le build standalone Control Me (`tauri.controlme.conf.json`) — Skills
  et la Sidebar complète n'existent que dans l'app principale, c'est elle
  la cible naturelle d'un clic "Ajouter".

- **`supabase/marketplace_v2_migration.sql`** (nouveau, **à exécuter par
  l'utilisateur** après `accounts_marketplace_migration.sql`) : étend
  `extensions` avec `summary` (résumé court, contrainte `char_length <= 220`
  en plus de la limite déjà posée côté formulaire — défense en profondeur,
  même logique que `profiles.username`), `thumbnail_url`,
  `page_view_count`/`install_click_count` (deux compteurs distincts de
  `extension_install_count` déjà existant : "combien ont ouvert la page"
  et "combien ont cliqué Ajouter" sont des mesures différentes d'une
  installation réellement confirmée côté app). Nouvelle table
  `extension_media` (galerie photos/vidéos, RLS : lecture publique,
  écriture réservée au propriétaire de l'extension visée). Nouveau bucket
  Storage `extension-media` (public, 10 Mo max, types image/vidéo
  courants posés directement sur le bucket) avec policies vérifiant
  `(storage.foldername(name))[1]` contre `extensions.owner_id` via une
  sous-requête — même schéma que la policy d'avatar déjà en place, RLS
  Storage acceptant très bien une jointure vers une autre table. Fonction
  `site_stats()` (`security definer`, compte `profiles`+`extensions`) et
  ajout de ces deux tables à la publication `supabase_realtime` (pour le
  compteur temps réel de la landing, voir plus bas) — écrit dans un bloc
  `do $$ ... exception when duplicate_object then null; end $$` pour que
  le fichier reste ré-exécutable sans erreur si les tables y sont déjà,
  même discipline que les migrations précédentes de ce projet.
  **Compteurs de vues/clics volontairement non protégés contre le
  spam** (RPC `security definer` appelable par `anon` sans limite de
  fréquence) — même compromis assumé qu'ailleurs dans ce projet (code de
  jumelage à distance, dossier caché de connaissances) : un frein normal,
  pas une garantie face à un attaquant motivé.
- **`site/account.js`** : `avatarUrlFor(profile, session)` — utilise
  désormais **la vraie photo Google** du compte
  (`session.user.user_metadata.avatar_url`/`.picture`, remplie
  automatiquement par Supabase Auth lors du login OAuth) comme valeur par
  défaut, avant de retomber sur l'identicon dicebear généré — seulement
  si aucune photo n'a jamais été uploadée manuellement
  (`profiles.avatar_url` reste toujours prioritaire une fois définie).
  Nouveau panneau **"Notre compte"** (modale, `openAccountModal()`) —
  pseudo + photo de profil, avant réservé à `dev.html` et donc invisible
  pour un compte non développeur ; maintenant accessible à n'importe quel
  compte connecté, depuis n'importe quelle page, via le menu déroulant.
  **Bascule "Mode développeur" déplacée directement dans le menu**
  (glissière animée, même style que celle qui vivait avant dans
  `dev.html`) — l'activer fait apparaître l'entrée "Espace développeur"
  juste en dessous, sans recharger la page ni naviguer ailleurs.
  "Se déconnecter" stylé en rouge (`.account-signout-btn`) comme demandé
  explicitement. Toutes ces nouvelles classes sont injectées une seule
  fois via un `<style>` généré par `ensureStyles()` plutôt que dupliquées
  dans le bloc `<style>` de chaque page HTML — les classes déjà stylées
  par chaque page (`.account-bar`/`.account-menu`/etc.) ne sont pas
  touchées, donc aucun risque de régression visuelle sur ce qui existait
  déjà.
- **`site/index.html`** (refait) : nouvel en-tête collant (`.site-header`,
  `backdrop-filter: blur`) avec le nom du projet, une nav ("Extensions",
  "Documentation"), le bouton d'installation et le menu de compte — plus
  besoin de faire défiler toute la page pour les retrouver. Section héros
  avec un **compteur temps réel** (`site_stats()` au chargement, puis
  ré-appelé automatiquement via un canal Supabase Realtime
  `postgres_changes` abonné aux `INSERT` sur `profiles`/`extensions` —
  plus simple et plus fiable qu'essayer de maintenir un total local
  incrémenté à la main, qui désynchroniserait entre onglets/visiteurs).
  Grille "Comment ça marche" étendue à 4 cartes (Chat/Codex/Control
  Me/Skills, contre 2 avant) et nouvelle section "Le système
  d'extensions" expliquant que Codex/Control Me/Skills sont eux-mêmes
  les capacités "intégrées" que la marketplace complète, avec liens vers
  `/extensions` et `/docs`. **Retiré, comme demandé explicitement** : le
  calculateur de config RAM (existait depuis plusieurs versions, voir
  Journal), la section de téléchargement Control Me seul, et la section
  "Interface pour appareil connecté" — leur fonction reste accessible
  (Control Me s'installe/se configure depuis l'app elle-même ; les
  appareils connectés restent à un clic via "Mes appareils" dans le menu
  de compte, inchangé depuis v0.5.7).
- **`site/extensions.html`** (refait) : grille à **deux colonnes**
  (`grid-template-columns: repeat(2, 1fr)`, une seule colonne sous 620px)
  de cartes cliquables — miniature (`thumbnail_url`, un dégradé de
  substitution si absente), nom en gras, badge officiel/non-officiel,
  résumé tronqué à 3 lignes (`-webkit-line-clamp`), avatar + pseudo de
  l'auteur en petit. Remplace l'ancienne liste verticale avec case
  UUID/bouton copier — l'installation ne passe plus par ce
  copier-coller, chaque carte mène directement à la page de l'extension.
- **`site/extension.html`** (nouveau) — la page GitHub-like par
  extension : photo d'impression en hero, nom, badges cible/officiel,
  auteur, résumé, bouton **"Ajouter à l'app"** (voir le mécanisme de deep
  link plus haut), trois statistiques affichées côte à côte (vues de la
  page / clics sur Ajouter / installations confirmées), description
  complète, galerie photos/vidéos, et un lien vers le tableau de bord si
  le visiteur connecté est l'auteur. **Comptage de vue anti-doublon
  léger** : une clé `sessionStorage` par extension évite qu'un simple
  rechargement de page ne gonfle `page_view_count` à chaque F5 — mesure
  honnête mais pas rigoureuse (contournable en navigation privée),
  documentée comme telle plutôt que présentée comme un vrai comptage de
  visiteurs uniques.
- **`site/dev.html`** (restructuré) : l'édition de pseudo/photo en a été
  **retirée** (vit maintenant dans "Notre compte", partagée par toutes
  les pages — plus besoin d'être développeur pour changer sa photo).
  Nouveau bouton "Documentation" en en-tête vers `/docs`. Formulaire de
  publication étendu : résumé court (compteur de caractères en direct,
  220 max), upload de la photo d'impression, upload multiple de
  photos/vidéos de démonstration — les fichiers sont envoyés vers le
  bucket `extension-media` sous le chemin `{id-extension}/...` **après**
  la création (ou mise à jour) de la ligne `extensions`, dans cet ordre
  précis parce que la policy Storage a besoin que la ligne existe déjà
  pour vérifier la propriété via la sous-requête. "Mes extensions"
  affiche maintenant les **trois métriques séparément** par extension
  (vues de page, clics sur Ajouter, installations confirmées — cette
  dernière toujours récupérée via `extension_install_count`, inchangée).
- **`site/docs.html`** (nouveau) — documentation extensive demandée
  explicitement ("ajoute un maximum d'information"), avec sommaire
  collant. Couvre le format exact du manifeste, chaque champ du
  formulaire de publication avec ses limites, et surtout une
  **bibliothèque de fonctions nommées** (`clique(x, y)`, `tape("...")`,
  `raccourci("Ctrl+S")`, `lit_interface()`, `retiens(fait, categorie)`...)
  à citer dans le texte d'une extension Control Me pour décrire une
  action sans ambiguïté. **Ce ne sont pas de vraies fonctions
  exécutées** — le contenu d'une extension reste du texte libre ajouté
  au prompt système (décision de scope v0.6.3, non remise en cause ici) ;
  c'est un vocabulaire documenté qui correspond un-à-un aux outils déjà
  câblés côté Control Me (`click`, `type`, `hotkey`, `read_ui_elements`,
  `remember_fact`...), pour que le modèle reconnaisse directement à quelle
  capacité réelle chaque terme renvoie plutôt que de laisser l'auteur
  décrire la même chose en prose libre à chaque fois. Section équivalente
  pour une extension `"chat"`, qui documente à la place les 6 outils fixes
  de Codex (pas de nouvel outil possible pour cette cible, seulement du
  contexte qui influence comment ils sont utilisés). Deux exemples de
  manifeste complets (assistant Spotify pour Control Me, style de revue
  de code pour Chat/Codex).
- `npx tsc --noEmit` passé à 0 erreur. `cargo check` lancé après ajout des
  deux nouveaux plugins Rust — voir Journal des changements pour le
  résultat. **Aucune vérification de bout en bout possible dans cet
  environnement** (nécessite un vrai clic "Ajouter" depuis un navigateur
  sur le site déployé, avec l'app installée en face, pour confirmer que
  le schéma `ollamachat://` est bien enregistré par l'installeur NSIS et
  que Windows route effectivement vers l'app) — à tester explicitement
  par l'utilisateur après build + déploiement Vercel + exécution de la
  migration SQL.

### Passe UI/sécurité et commandes clavier (v0.7.1)

Demande dense groupant plusieurs sujets indépendants : boutons moches dans
l'espace développeur, absence de champ "code"/vocabulaire propre à une
extension, mémorisation de la clé Gemini, repli automatique 3.7→3.6,
amélioration générale de la marketplace, ne pas révéler dans la doc
comment le chat/Control Me sont construits, un prompt prêt pour une IA,
un "système anti-injection SQL"/défense des données "impénétrable", un
upload de fichier pour le contenu d'une extension, un site mobile
réellement différent du site desktop, plus d'animations/hover partout
(site et app), et de nouvelles commandes clavier pour Control Me (touche
Windows, VerrMaj, Ctrl, combinaisons, glisser-déposer, emoji).

**Audit sécurité fait avant d'écrire quoi que ce soit** de nouveau, pour
savoir quoi construire réellement plutôt que de deviner : grep systématique
de tous les appels réseau du site (`site/*.html`). Résultat, à l'opposé de
la prémisse "SQL injection" de la demande : **aucune requête de ce projet
ne construit jamais de SQL par concaténation de chaîne** — tout passe par
le query builder paramétré de `supabase-js` (`.eq()`, `.select()`,
`.insert()`...) ou par des fonctions RPC à paramètres typés (`uuid`, etc.),
donc l'injection SQL classique n'est structurellement pas possible ici,
pas juste peu probable. En revanche, un **vrai problème de sécurité
existait ailleurs** : `extensions.name`/`description`/`summary`/
`thumbnail_url` et `profiles.username`/`avatar_url` sont écrits par
n'importe quel compte développeur (RLS contrôle qui a le droit d'écrire
une ligne, pas ce qu'elle contient) puis réinjectés **sans échappement**
dans des templates `innerHTML` sur `extensions.html`/`extension.html`/
`dev.html` — un nom d'extension `<img src=x onerror=...>` se serait
exécuté chez **n'importe quel visiteur** de la marketplace, pas seulement
chez son auteur. Corrigé avec un nouvel export `escapeHtml()` dans
`account.js` (round-trip `textContent` → `innerHTML`, fiable par
construction, pas une regex à avoir tort dessus) appliqué à chaque valeur
de ce type avant interpolation. `controlremote.html` était déjà épargné
(rendu du chat déjà en `textContent` pur depuis sa conception, voir
Journal — vérifié par grep plutôt que supposé). C'est ce correctif, pas
un système "anti-injection" séparé, qui répond réellement à la demande de
sécurité — présenté comme tel plutôt que de prétendre construire quelque
chose d'"impénétrable" (aucun système ne l'est ; ce qui est vrai, c'est
que la classe de bug la plus probable ici — XSS stocké côté marketplace —
est maintenant couverte).

- **Espace développeur (`site/dev.html`)** :
  - **Champs fichier restylés** : un `<input type="file">` natif ne se
    laisse pas styliser directement dans aucun navigateur — pattern
    standard repris ici : l'input reste dans le DOM et reste focusable/
    activable au clavier (`.file-input-hidden`, positionné hors écran via
    `clip`/`position:absolute`, **pas** `display:none` qui casserait
    l'activation clavier/lecteur d'écran), un `<label for="...">` normal
    et stylé sert de déclencheur visuel, un `<span>` affiche le nom du
    fichier choisi une fois sélectionné.
  - **Contenu importable depuis un fichier** : deux boutons ("Écrire
    directement" / "Importer un fichier") basculent entre la `<textarea>`
    existante et un nouveau champ fichier (`.txt`/`.md`, lu via
    `file.text()`) qui **remplit** cette même textarea — un seul champ
    reste la source de vérité envoyée à la publication, le fichier n'est
    qu'une façon plus confortable de le remplir pour un contenu long
    écrit d'abord dans un éditeur normal.
  - **Commandes personnalisées** (`custom_commands`) : répond à la partie
    la plus ouverte de la demande ("créer une toute nouvelle chose, avec
    des commandes embarquées", "ajouter une fonctionnalité de plus qu'à
    Control Me/Skill/Chat"). Décision de scope explicite, cohérente avec
    celle déjà prise en v0.6.3 (pas de code arbitraire exécuté, aucun bac
    à sable dans ce projet) : plutôt que de construire un vrai moteur
    d'extension avec de nouvelles capacités techniques (un chantier de
    plusieurs semaines, contredirait la décision de sécurité déjà prise
    et déjà communiquée), le manifeste gagne un champ optionnel
    `custom_commands: [{name, description}]` — une extension peut définir
    **son propre vocabulaire nommé**, réutilisable dans son propre texte
    comme les fonctions de la bibliothèque commune, sans que ce soit du
    code exécuté (toujours du texte, juste un raccourci de rédaction que
    le modèle reçoit avec sa définition). Répétable dans le formulaire
    (`+ Ajouter une commande`, lignes name/description supprimables),
    stocké tel quel dans `manifest.custom_commands`, affiché nulle part
    de spécial côté install (fait juste partie du JSON que
    `import_marketplace_extension` récupère).
  - **Clé Gemini mémorisée** (`localStorage`, clé
    `ollamachat_dev_gemini_key`) : n'introduit pas de nouvelle exposition
    — cette clé part déjà en clair vers l'API Google à chaque examen de
    sécurité (`x-goog-api-key`), la garder aussi en local ne fait
    qu'éviter de la retaper, documenté comme tel dans le champ lui-même
    plutôt que présenté comme un vrai changement de posture de sécurité.
  - **Repli 3.7→3.6 silencieux** : `reviewSafety()` essaie
    `gemini-3.7-flash`, et sur **n'importe quel échec** (pas seulement un
    429 identifié précisément — un timeout, une erreur 5xx ou de format
    auraient le même symptôme côté développeur) retente automatiquement
    avec `gemini-3.6-flash` sans jamais montrer l'erreur du premier essai
    à l'utilisateur ; seul un échec du **second** essai est encore
    affiché normalement. Complète la doc/`dev.html` déjà remaniées pour
    ne plus citer "Gemini 3.7" nommément dans les textes visibles
    (l'app/le site continuent d'utiliser le modèle qu'il faut, seul le
    message montré au développeur ne fige plus un numéro de version
    précis qui peut changer).

- **`site/docs.html`** : les blocs `.fn-maps-to` qui affichaient
  explicitement "→ correspond à l'action `click`/`read_ui_elements`/..."
  (les noms exacts des outils internes envoyés à Gemini) sont retirés —
  demande explicite de ne pas exposer comment le chat/Control Me sont
  construits en interne. La bibliothèque de fonctions reste identique
  côté lecteur (même noms `clique()`/`tape()`/...), juste sans révéler à
  quoi ça correspond dans le code. Nouvelle section **Commandes
  personnalisées** (exemple complet, playlist Spotify) et nouvelle section
  **Prompt pour une IA** : un bloc de texte copiable (bouton "Copier",
  `navigator.clipboard`) à coller dans Claude/ChatGPT/etc. avant de
  décrire ce qu'on veut, qui connaît déjà le format JSON exact, le
  vocabulaire disponible et les noms de touches valides — pour quelqu'un
  qui préfère faire écrire l'extension par une IA plutôt qu'à la main.

- **Passe UI site-wide, via `account.js`** (chargé par toutes les pages,
  donc le seul endroit qui les touche toutes sans dupliquer la même règle
  six fois) :
  - Fond en dégradé (`radial-gradient`) plutôt qu'une couleur plate,
    transitions sur tous les boutons/liens (`transform` léger au survol,
    `scale` au clic), `.link-btn` pour styliser un `<a>` texte qui sert
    d'action principale comme un vrai bouton (utilisé sur la landing et
    la page d'extension — "plus de texte cliquable" au sens littéral :
    moins de liens qui ressemblent à du texte simple) sans lui donner
    toute la logique JS d'un vrai `.btn`.
  - Animation d'entrée légère (`site-fade-up`) sur les blocs de contenu
    principaux, respectant `prefers-reduced-motion` (accessibilité, même
    discipline que la passe d'animations de l'app en v0.5.5).
  - **Vrai menu mobile** (`mountMobileNav`, appelé depuis `index.html` sur
    `.site-nav`) plutôt qu'une version desktop juste comprimée : sous
    640px, les liens de nav disparaissent au profit d'un bouton compact
    (`☰`) qui déroule un panneau — demandé explicitement ("que la version
    mobile du site ne soit pas la même que la version ordi"). **Repéré et
    corrigé avant publication** : ce nouveau menu (`.mobile-nav-menu`)
    aurait eu exactement le même bug de cascade CSS que le correctif
    précédent sur `.account-menu` (un `display: flex` d'auteur qui bat
    silencieusement le `[hidden] { display: none }` du navigateur, quelle
    que soit la spécificité) — `.mobile-nav-menu[hidden] { display: none;
    }` ajouté préventivement plutôt que découvert après coup.

- **`src-tauri/src/commands/controlme.rs`** : `key_from_name()` avait déjà
  `meta`/`win`/`windows`/`cmd`/`super` → touche logo Windows et
  `control`/`ctrl`/`alt`/`shift` (vérifié dans le code avant de conclure
  quoi que ce soit manquait — la demande listait ces touches comme si
  elles n'existaient pas). Réellement absents et ajoutés :
  `capslock`/`caps`, `insert`, `f1` à `f12`. `hotkey` (combinaisons
  multi-touches, ex. Ctrl+Maj+S) et `drag_and_drop` (clic maintenu d'un
  point à un autre) existaient déjà eux aussi — seules leurs descriptions
  d'outils (côté mode "Windows UI", `build_windows_ui_tools()`) ont été
  enrichies avec des exemples concrets pour que Gemini les utilise plus
  fiablement. **Emoji dans `tape()`/`type`** : déjà fonctionnel sans
  changement Rust — vérifié dans le code source d'enigo
  (`enigo-0.6.1/src/win/win_impl.rs`) que `Keyboard::text()` encode déjà
  correctement les caractères hors du plan de base (la plupart des emoji)
  en paires de substituts UTF-16 avant l'envoi via `SendInput`, donc
  aucun changement de code n'était nécessaire — seulement documenté
  explicitement dans la description de l'outil et dans `docs.html`.
  `cargo check` à 0 erreur.

- Pas de vérification GUI possible dans cet environnement pour la partie
  site (comme pour la v0.7 elle-même) ni pour les nouvelles touches
  Control Me (nécessite une vraie session avec clé Gemini) — à confirmer
  par l'utilisateur : boutons de fichier cliquables et lisibles, bascule
  contenu texte/fichier, ajout/suppression de commandes personnalisées,
  clé Gemini effectivement mémorisée entre deux visites, menu mobile sous
  640px de large, et qu'une combinaison comme Ctrl+Maj+S ou la touche
  Windows fonctionne bien en conditions réelles.

**Deuxième passe demandée explicitement juste après** ("vérifie tout le
code, et renforce la sécurité [...] anti injection") — relecture
systématique de `src-tauri/src/commands/` à la recherche de la même
famille de bug que le XSS déjà trouvé côté site : une valeur qui devrait
être un simple identifiant, injectée telle quelle dans quelque chose qui a
sa propre syntaxe (un chemin de fichier, une URL de requête). Trois
vraies vulnérabilités trouvées et corrigées, aucune supposée :

1. **Traversée de chemin réelle dans `read_active_skills`**
   (`skills.rs`) : `active_skill_ids` — la liste de skills à fournir à une
   session Control Me — était jointe directement à un chemin de fichier
   (`dir.join(format!("{id}.json"))`, et `PathBuf::join` ne filtre
   **pas** les composants `..`) sans la moindre validation. Sévérité
   réelle, pas théorique : ce paramètre est atteignable **à distance**,
   `remote.rs` le lit tel quel depuis le broadcast `instruction` envoyé
   par n'importe quel visiteur ayant le code de jumelage (voir "Chat
   distant unifié avec Control Me (v0.6.0)") — un id comme
   `"../../../../chemin/vers/un/fichier"` aurait fait lire ce fichier et
   l'aurait injecté dans le prompt envoyé à Gemini. Comme le code de
   jumelage donne déjà un contrôle complet (écran, clavier, souris), ce
   n'est pas une élévation de privilège en soi — mais c'est une manière
   distincte d'en abuser : exfiltrer le contenu d'un fichier précis vers
   un tiers (Google) sans avoir besoin d'accès visuel à l'écran. Corrigé
   en validant que chaque id fait exactement `ID_LEN` caractères
   alphanumériques minuscules (le seul format que `random_id()` produit
   réellement) avant tout `join` — silencieusement ignoré sinon, même
   comportement que "ce skill n'existe pas".
2. **Même bug, moindre sévérité, corrigé par précaution** : `skill_path()`
   (choix central utilisé par `load_skill`/`save_new_skill`/
   `update_skill`/`delete_skill`) et les équivalents dans
   `conversations.rs`/`controlme_sessions.rs` (mêmes trois commandes
   load/save/delete, id généré par `crypto.randomUUID()` côté frontend)
   avaient la même construction de chemin non validée — atteignables
   seulement via l'IPC Tauri local (le propre frontend de l'app, pas le
   réseau), donc un risque bien plus faible en pratique, mais corrigé
   quand même pour fermer complètement la classe de bug plutôt que de
   laisser un cas "probablement sûr aujourd'hui". Nouvelle fonction
   partagée `safe_item_id()` dans `mod.rs` (accepte alphanumérique/`-`/`_`,
   64 caractères max — couvre le format UUID avec tirets) réutilisée par
   `conversations.rs`/`controlme_sessions.rs` ; `skills.rs` garde sa
   propre vérification, plus stricte, déjà en place pour son format d'id
   différent.
3. **Injection de paramètres PostgREST dans `skills.rs`** (trois appels
   réseau : `download_skill`, et `import_marketplace_extension` deux
   fois) : l'URL de la requête vers Supabase était construite avec
   `format!("...&share_code=eq.{}", share_code)` / `"...&id=eq.{}"` — une
   valeur contenant `&` ou `,` aurait pu injecter un paramètre de requête
   PostgREST supplémentaire (élargir le filtre `eq.` en `in.`, ajouter
   son propre `&select=...`) plutôt que d'être traitée comme une valeur
   littérale. Sévérité concrète surtout pour `import_marketplace_extension` :
   `extension_id` y arrive **directement depuis un lien cliqué**
   (`ollamachat://install-extension/<id>`, voir "Marketplace v0.7"), donc
   entièrement écrit par qui a distribué le lien — pas un code tapé à la
   main comme pour `download_skill`. Corrigé en remplaçant la
   construction d'URL par `.query(&[...])` de `reqwest` (déjà utilisé
   correctement ailleurs dans ce fichier, ex. `search_hf_models` dans
   `huggingface.rs` — ces trois-là étaient les seuls endroits qui ne
   suivaient pas déjà ce pattern), qui encode chaque valeur en
   pourcentage via la crate `url` plutôt que de la concaténer telle
   quelle.

**Ce qui a été vérifié et confirmé déjà sûr, pas juste supposé** :
injection SQL classique structurellement impossible (déjà établi côté
site plus haut, revérifié côté Rust — même constat, tout passe par des
paramètres typés) ; `decode_broadcast_binary`/`handle_incoming`
(`remote.rs`, parsing de trames binaires non fiables venant du réseau)
utilisent déjà `bytes.get(...)`/`checked_add`/`unwrap_or` partout, aucun
indexage direct ni panique possible sur une trame malformée — vérifié en
relisant chaque ligne, pas supposé sûr parce que "ça n'a jamais planté" ;
le code de jumelage à distance (`generate_code()`) et le topic Realtime
qui l'utilise sont générés localement (jamais de texte libre utilisateur),
aucune injection possible à cet endroit ; `run_powershell_command`/l'accès
fichiers non-sandboxé de Codex restent des risques **déjà documentés et
assumés explicitement** (voir Limites connues et risques) — pas des bugs,
pas retouchés ici ; les deux usages de `dangerouslySetInnerHTML` côté app
React (`MessageBubble.tsx`, `ControlMeView.tsx`) passent déjà par
`DOMPurify.sanitize()` avant injection, vérifié en remontant jusqu'à la
définition de `renderMarkdown()` plutôt que supposé parce que c'était déjà
documenté ailleurs.

`cargo check` relancé après ces trois correctifs pour confirmer 0 erreur
avant de considérer la passe terminée.

### Bascule jour/nuit et fond animé (v0.7.2)

Demande explicite, uniquement présentation cette fois ("ton seul but
améliorer un maximum l'UI du site et de l'app") : un maximum d'animation,
un écran de chargement, un fond dynamique, une bascule jour/nuit fluide,
et une meilleure page d'extension. Recherche web faite avant d'implémenter
(demandée explicitement) plutôt que deviné : technique de fond en
dégradé animé ("mesh gradient", plusieurs `radial-gradient` superposés —
CSS n'a pas encore de vrai mesh-gradient natif), animation de bascule de
thème via la View Transitions API (`document.startViewTransition`, un
cercle qui grandit depuis le bouton cliqué via `clip-path`), et tendances
2026 de landing page SaaS (animations "avec un but", pas du mouvement
permanent — d'où le choix de révélation au scroll plutôt qu'une
animation groupée au chargement pour tout).

- **`site/account.js`** (chargé par les 6 pages, donc le seul endroit qui
  les touche toutes en une fois) gagne :
  - `applyStoredTheme()`/`mountThemeToggle(container)` : bouton rond
    ☀️/🌙, persiste le choix dans `localStorage`
    (`ollamachat_theme`), et anime la transition via
    `document.startViewTransition()` quand disponible (Chromium — les
    deux vrais publics de ce site, le WebView2 de l'app et
    Chrome/Edge, l'ont ; ailleurs, retour silencieux à un changement
    instantané, adouci par les `transition` CSS déjà posées sur
    `body`). Chaque page reçoit aussi un petit `<script>` **synchrone**
    (pas `type="module"`, qui s'exécute trop tard) tout en haut du
    `<head>`, avant le bloc `<style>`, qui relit `localStorage` et pose
    `data-theme` avant le premier rendu — sans ça, un visiteur ayant
    choisi le clair verrait le sombre flasher une fraction de seconde
    au chargement.
  - **Palette claire centralisée** : plutôt que dupliquer un bloc
    `[data-theme="light"]` dans les 6 fichiers, une seule règle
    `:root[data-theme="light"] { --bg: ...; ... }` dans `account.js`
    écrase les variables que chaque page déclare déjà sur son propre
    `:root` (même nom de variable partout : `--bg`/`--bg-raised`/
    `--border`/`--text`/`--text-dim`/`--accent`/`--accent-strong`/
    `--warn`/`--danger`/`--ok`) — spécificité égale à un éventuel bloc
    `[data-theme="dark"]` existant, l'ordre d'injection (après coup,
    donc plus tard dans le document) tranche en sa faveur. `index.html`/
    `controlremote.html` avaient déjà un mécanisme de suivi automatique
    du thème système (`@media (prefers-color-scheme: light)`) — laissé
    tel quel, il reste le comportement par défaut tant que l'utilisateur
    n'a jamais cliqué le bouton ; une fois cliqué, `data-theme` posé
    explicitement prend le dessus dans tous les cas, y compris à
    contre-courant du thème système.
  - `mountScrollReveal(root)` : `IntersectionObserver` générique, ajoute
    `.reveal-visible` (déclenche l'animation d'entrée) la première fois
    qu'un élément `.reveal` croise le viewport puis arrête de
    l'observer — une seule fois, pas à chaque scroll. Remplace la
    règle globale `section, .ext-card, ... { animation: ... }` de la
    v0.7.1 (tout animait au chargement, y compris hors écran) par un
    marquage explicite `.reveal` posé section par section dans
    `index.html`.
  - `animateCounter(el, value)` : anime un nombre de 0 à sa valeur
    finale (easing cubique), utilisé pour les deux compteurs de la
    landing — seulement au tout premier chargement, une mise à jour
    temps réel ultérieure (quelqu'un vient de s'inscrire) met juste à
    jour le chiffre sans rejouer l'animation.
  - Classe `.skeleton` (dégradé qui glisse en boucle) pour tout ce qui
    dépend d'un appel Supabase — compteurs de la landing, grille
    d'extensions, en-tête de la page d'extension — au lieu d'un espace
    vide ou d'un "—" pendant le chargement.
  - **Vrai bug de contraste trouvé et corrigé avant publication** :
    plusieurs badges (`.badge-official`/`.badge-unofficial` sur
    `extensions.html`/`extension.html`/`dev.html`,
    `.badge-target`/`.memory-category`/`.remote-step` sur
    `extension.html`/`controlremote.html`) codaient leur fond en dur
    (ex. `background: #1f3a24`) tout en laissant le texte suivre une
    variable de thème (`color: var(--ok)`). En sombre, cohérent avec
    la variable d'origine. En clair, `--ok`/`--warn`/`--accent`
    deviennent des teintes **foncées** (pensées pour rester lisibles
    sur un fond clair) — posées sur un fond resté sombre en dur, texte
    et fond finissent presque de la même couleur. Corrigé en dérivant
    le fond de badge de la **même** variable que le texte via
    `color-mix(in srgb, var(--ok) 20%, transparent)` — fond et texte
    restent alors toujours de la même famille de couleur, dans les deux
    thèmes, un seul correctif centralisé dans `account.js` plutôt que
    trois correctifs par page. Deux survivants isolés dans `dev.html`
    (`.file-label:hover`, `.command-remove:hover`) avaient le même
    défaut avec des couleurs différentes — corrigés directement dans le
    fichier, trop spécifiques à cette page pour valoir une règle
    partagée.
- **`src/App.tsx`/`App.css`** (l'app elle-même) :
  - **Écran de démarrage animé** (`.app-splash`) — délibérément un temps
    d'entrée de marque plutôt qu'un indicateur "patiente" : le
    chargement réel (réglages/modèles/conversations, tout en local) est
    quasi instantané, donc affiché un minimum fixe (~650ms) même si les
    données sont déjà prêtes, avant un fondu croisé vers l'app réelle.
    **Ne touche pas** au mécanisme anti-flash existant (fenêtre cachée
    jusqu'à `getCurrentWindow().show()`, voir v0.3.2/v0.6.2) — l'écran
    de démarrage est peint une fois la fenêtre déjà visible à sa bonne
    taille, il ne cherche pas à la remplacer.
  - **Fond en dégradé animé** derrière tout `body` (donc visible dans
    le panneau principal chat/Codex/Control Me, qui ne pose pas son
    propre fond opaque) — même technique que le site, couleurs reprises
    de l'accent bleu déjà utilisé par `.send-btn` (`#3d6dd8`) plutôt
    qu'inventées.
  - **Pas de bascule jour/nuit dans l'app** — décision de scope
    assumée, pas une case oubliée : `App.css` (plus de 2000 lignes)
    n'a **aucune** variable CSS de couleur, chaque composant code sa
    couleur en dur depuis le début du projet (vérifié par grep avant
    de commencer, pas supposé) — retokeniser tout ça à l'aveugle pour
    ajouter un thème clair aurait un risque élevé de régression
    visuelle sur des dizaines de composants, pour un chantier qui
    mériterait sa propre passe dédiée plutôt qu'être improvisé au
    milieu d'une passe UI plus large. Le site, lui, avait déjà cette
    infrastructure de variables (posée dès la v0.7), d'où la bascule
    beaucoup plus simple à y ajouter.
- `npx tsc --noEmit`, `npm run build` (tsc + vite) passés à 0 erreur ;
  JS de chaque page du site revérifié avec `node --check`. **Pas de
  vérification visuelle possible dans cet environnement** (pas d'accès
  GUI) — à confirmer par l'utilisateur : bascule de thème sur les 6
  pages (l'animation en cercle en particulier, qui ne peut être vue
  qu'en vrai), lisibilité des badges dans les deux thèmes, écran de
  démarrage de l'app, et que le fond animé ne nuit pas à la lisibilité
  du texte par-dessus.

### Écran de démarrage découplé du chargement (v0.7.3)

Signalé par l'utilisateur : l'app pouvait rester bloquée sur l'écran de
démarrage animé (v0.7.2). Cause : le minuteur qui déclenche la disparition
de l'écran de démarrage (`setSplashLeaving`/`setSplashVisible`) était
imbriqué dans le même bloc `finally` que le chargement des réglages/
modèles/conversations — si l'un de ces appels traînait anormalement
longtemps (un hôte Ollama qui ne refuse pas activement la connexion mais
la laisse pendre plutôt que de la rejeter immédiatement), le minuteur de
l'écran de démarrage attendait avec lui. Corrigé en donnant à ce minuteur
son propre `useEffect` indépendant (`App.tsx`) qui se déclenche
systématiquement ~1070ms après le montage, peu importe l'état du
chargement des données — celui-ci garde son propre `finally` (toujours
nécessaire pour ne jamais laisser la fenêtre invisible), mais ne pilote
plus l'écran de démarrage.

### Désactivation temporaire de Hugging Face (v0.7.4)

Demandé explicitement suite à un incident de sécurité signalé chez
Hugging Face — l'utilisateur a aussi fait remarquer que
`HuggingFaceBrowser` lançait une recherche automatiquement dès son
montage (`useEffect(() => { handleSearch(); }, [])`), et qu'`App.tsx`
ouvrait ce composant automatiquement dès qu'aucun modèle Ollama n'était
installé (`if (list.length === 0) setShowInstall(true)`) — combinés, un
premier lancement de l'app sans modèle contactait Hugging Face sans la
moindre action de l'utilisateur. Corrigé en deux temps :
`HuggingFaceBrowser.tsx` gagne un flag `HF_DISABLED` (actuellement `true`)
qui coupe à la fois la recherche automatique au montage et remplace toute
l'interface habituelle par un message explicite ("désactivé
temporairement suite à un incident de sécurité...") — recherche **et**
installation manuelle par référence `hf.co/...` sont toutes les deux
coupées, pas seulement la recherche ; et `App.tsx` n'ouvre plus jamais ce
composant automatiquement. À réactiver (repasser `HF_DISABLED` à `false`)
seulement quand l'utilisateur confirme que l'incident est clarifié — ne
pas le faire de sa propre initiative.

### Voix et raccourci clavier global (v0.7.5)

Demandé explicitement : entrée/sortie vocale façon ChatGPT/Gemini pour le
chat et Control Me, et des raccourcis clavier. Contrainte forte de la
session : **aucun `npm install`**, suite à une inquiétude de sécurité de
la chaîne d'approvisionnement npm signalée par l'utilisateur — les deux
fonctionnalités sont construites pour ne jamais en avoir besoin.

- **Voix** (`src/voice.ts`, nouveau) : entièrement basé sur l'API Web
  Speech du navigateur (`SpeechRecognition`/`SpeechSynthesis`), déjà
  disponible dans WebView2 sans la moindre dépendance — vérifié par
  recherche web avant d'écrire le code (Windows/WebView2 étant basé sur
  Chromium, "les deux parties de l'API fonctionnent normalement", contrairement à
  Linux/webkitgtk, non pertinent pour ce projet Windows-only). Le lib DOM
  de TypeScript n'a pas de types pour `SpeechRecognition` (toujours non
  standardisé) — les formes minimales utilisées ici sont déclarées à la
  main plutôt que d'ajouter un paquet `@types/dom-speech-recognition`
  (aurait nécessité un `npm install`, exclu).
  - `MicButton.tsx` (nouveau, partagé) : bouton micro dans la barre de
    saisie du chat (`App.tsx`) et de Control Me (`ControlMeView.tsx`) —
    dictée en direct qui remplit le champ de texte, ne rend rien si le
    navigateur ne supporte pas `SpeechRecognition` plutôt qu'un bouton
    qui échouerait silencieusement au clic.
  - Bouton "lire à voix haute" ajouté directement dans `MessageBubble.tsx`
    (donc disponible partout où ce composant est déjà utilisé — chat de
    base et Control Me) sur les réponses de l'assistant non-streaming :
    bascule lecture/arrêt, sondage de `speechSynthesis.speaking` toutes
    les 300ms pour revenir à l'état "lire" une fois la lecture terminée
    (l'API n'expose pas de promesse "terminé"). Le texte lu retire la
    syntaxe markdown la plus commune (blocs de code, `*`/`_`/`` ` ``/`#`)
    pour ne pas lire les caractères de mise en forme à voix haute — une
    approximation texte brut, pas un vrai analyseur.
  - **Nouvelle exception réseau documentée** (voir Confidentialité
    réseau) : `SpeechRecognition` est fourni par WebView2/Chromium
    lui-même, qui peut envoyer l'audio à un service de reconnaissance
    externe — ce n'est pas un appel que ce projet initie ou contrôle,
    documenté par honnêteté. La synthèse vocale reste entièrement locale
    (Windows), aucune réserve de ce type pour elle.
- **Raccourci clavier global** (Ctrl+Alt+O, ramène la fenêtre principale
  au premier plan depuis n'importe où) : crate `global-hotkey` (`cargo
  add`, donc autorisée malgré la contrainte — celle-ci ne visait que
  npm) plutôt que `tauri-plugin-global-shortcut` officiel, dont la
  moitié JS (`@tauri-apps/plugin-global-shortcut`) aurait justement
  demandé le `npm install` exclu — cette crate est d'ailleurs ce que ce
  plugin utilise en interne, seulement sans son wrapper JS. Enregistré
  dans `lib.rs > setup()` (le gestionnaire doit être créé sur le thread
  qui fait tourner la boucle d'événements Win32, vérifié dans le README
  de la crate avant d'écrire le code — c'est le thread principal d'une
  app Tauri) ; les événements sont ensuite reçus depuis un thread dédié
  (`std::thread::spawn`, simple boucle bloquante sur
  `GlobalHotKeyEvent::receiver().recv()` — un canal, donc sûr à lire
  depuis n'importe quel thread, contrairement à la création du
  gestionnaire). **Vrai piège de compilation rencontré et corrigé** :
  `GlobalHotKeyManager` contient un `HWND` qui est en réalité un
  `*mut c_void` dans cette version de la crate — un pointeur brut, donc
  ni `Send` ni `Sync` par défaut en Rust, quelle que soit sa sécurité
  réelle d'usage — empêchant `app.manage(...)` (qui exige les deux) de
  compiler. Corrigé avec un petit type enveloppe local
  (`HotkeyManagerHolder`) et des `unsafe impl Send`/`unsafe impl Sync`
  explicites dessus, justifiés en commentaire : le gestionnaire n'est
  jamais ré-accédé après l'enregistrement, il est seulement gardé en vie
  dans l'état managé pour repousser son `Drop` (qui désenregistrerait le
  raccourci) jusqu'à la fermeture de l'app — pas un vrai partage
  concurrent qui nécessiterait une synchronisation réelle.
- `cargo check`/`npx tsc --noEmit` passés à 0 erreur. **Pas de
  vérification GUI possible dans cet environnement** (ni pour la
  reconnaissance vocale, ni pour le raccourci global) — à confirmer par
  l'utilisateur : dictée fonctionnelle dans le chat et Control Me,
  lecture à voix haute d'une réponse, et que Ctrl+Alt+O ramène bien la
  fenêtre au premier plan depuis n'importe quelle autre application.

### Actions Control Me groupées par tour, en bascule (v0.8.0)

Demandé après un retour "toujours trop lent" sur la latence Gemini (fil
de discussion complet : modèle déjà le plus rapide de la gamme Gemini
vérifié par recherche web, Groq/OpenRouter écartés faute de
`computer_use`, LLM local écarté pour fiabilité — le seul levier
restant était de réduire le nombre d'allers-retours vers Gemini, pas
d'accélérer chaque appel individuellement, déjà au plancher). **Historique
de cette fonctionnalité, assumé** : une première version a été construite
en forçant ce comportement pour tout le monde (publiée en interne sous le
nom "v0.7.6", jamais réellement diffusée) — l'utilisateur est revenu
dessus explicitement ("supprime 7.6") pour en faire un vrai réglage
optionnel plutôt que le seul comportement, annulée proprement avec
`git revert` (pas un rejeu manuel des changements) avant de reconstruire
la version actuelle par-dessus le code v0.7.5 propre.

- **Découverte en lisant le code avant d'écrire quoi que ce soit** : la
  boucle de `run_control_me_core` collectait déjà TOUS les
  `function_call` d'un tour dans un `Vec` (`let function_calls: Vec<&Value>
  = steps.iter().filter(...)`) mais n'agissait que sur `function_calls[0]`
  — l'infrastructure pour un appel de fonction "parallèle" (plusieurs
  actions décidées dans le même tour, un protocole standard chez les
  principaux fournisseurs de function-calling) était donc déjà à moitié
  là, jamais exploitée.
- **Nouveau réglage `Settings.control_me_action_mode`** (`"live"` par
  défaut, ou `"predefined"`) — même famille que le bascule existant
  `control_me_perception_mode` (capture/Windows UI), même emplacement
  dans Réglages > Extensions > Control Me (`SettingsView.tsx`, juste
  après le bascule de perception). `"live"` : une seule action traitée
  par tour, comportement identique à avant que cette fonctionnalité
  n'existe (`&function_calls[..1]`, le reste ignoré si jamais Gemini en
  renvoyait plusieurs sans y être invité). `"predefined"` : toutes les
  actions du tour sont traitées (`&function_calls`), dans l'ordre, avec
  la même logique `safety_decision`/confirmation par action qu'avant.
- **Une seule observation fraîche par tour traité**, pas une par action
  — capture d'écran ou lecture d'interface prise une seule fois après la
  dernière action du tour (qu'il y en ait une ou plusieurs), attachée au
  `function_result` de cette dernière action, même forme qu'avant (texte
  + observation ensemble). En mode `"live"`, ça retombe exactement sur
  le comportement d'origine (un seul élément traité, donc une seule
  observation, comme toujours).
- **Vrai compromis assumé, pas caché** : en mode `"predefined"`, les
  actions du tour après la première s'exécutent sans revoir l'écran
  entre elles — si l'interface ne réagit pas comme prévu en plein milieu
  (popup, chargement plus long que prévu), une action suivante peut
  rater sa cible. C'est explicitement pour ça que ce n'est **pas** le
  comportement par défaut.
- **Amorce du groupement limitée au mode Windows UI** : `computer_use`
  est un protocole propriétaire de Google, pas quelque chose qu'une
  consigne de prompt peut fiablement pousser à regrouper — l'incitation
  ("si tu es certain d'une courte séquence... tu peux renvoyer plusieurs
  actions dans le même tour") n'est ajoutée à l'instruction que si
  `control_me_action_mode == "predefined"` **et** `control_me_perception_mode
  == "windows_ui"` en même temps. Laissé entièrement au jugement du
  modèle tour par tour, pas forcé — le mode capture garde le même code
  de traitement de lot par sécurité/cohérence (dégrade sans risque vers
  un lot d'un seul élément si `computer_use` ne renvoie jamais plusieurs
  actions à la fois, ce qui reste probable mais non vérifié).
- `cargo check`/`npx tsc --noEmit` passés à 0 erreur. **Aucune
  vérification empirique possible dans cet environnement** (nécessite
  une vraie clé API Gemini et un accès GUI) — en particulier, impossible
  de confirmer ici que Gemini accepte bien plusieurs `function_result`
  dans le même `input` suivant (implémenté selon le motif standard
  documenté pour l'appel de fonction parallèle chez les principaux
  fournisseurs, pas vérifié contre la vraie API Gemini) ni que le modèle
  choisit effectivement de regrouper des actions en pratique une fois le
  réglage activé — à tester explicitement par l'utilisateur : que
  `"live"` reste bien identique au comportement déjà connu, le gain de
  vitesse perçu une fois basculé sur `"predefined"`, et qu'aucune action
  ne parte dans le vide suite à un regroupement mal jugé par le modèle.

### Mode conversation vocale (v0.9.0)

Demandé explicitement : "pour chat et control me, le système voice,
n'affiche plus chat, juste une conversation entre deux personnes". La
dictée au micro de la v0.7.5 remplissait simplement le champ de saisie —
ici c'est un vrai mode mains libres qui **remplace** le fil de discussion
pendant qu'il est ouvert, au lieu de s'ajouter à côté.

- `src/components/VoiceMode.tsx` (nouveau, partagé chat + Control Me) :
  deux participants affichés (toi / l'IA, celui qui a la parole étant mis
  en avant), une sphère animée qui porte l'état (respiration lente en
  écoute, rotation en réflexion, pulsation large quand l'IA parle), et
  une seule légende — la phrase en cours, jamais l'historique.
- **Boucle de tour de parole automatique** : écoute → l'utilisateur se
  tait → envoi → génération → lecture à voix haute → réécoute. Rendu
  possible par un ajout à `startListening` (`voice.ts`) : un paramètre
  `continuous`, mis à `false` ici, pour que la reconnaissance s'arrête
  d'elle-même à la pause — c'est cet arrêt qui **est** le signal "j'ai
  fini de parler". La dictée simple (`MicButton`) garde `true`.
- `speak()` accepte maintenant un `onDone`, utilisé pour rendre la parole
  à l'utilisateur exactement à la fin de l'énoncé, au lieu de sonder
  `speechSynthesis.speaking` en boucle.
- **Qualité de voix** : `pickVoice()` choisit une voix française en
  préférant celles marquées `natural`/`neural`/`online` — Windows expose
  à la fois les vieilles voix SAPI (robotiques) et les neurales
  récentes, sans autre distinction que le nom. C'est ce qui fait la
  différence entre "lecteur d'écran" et "conversation".
- **Cas de blocage traité** : si un tour est ignoré (une génération déjà
  en cours, ou un échec), aucune réponse n'arrive jamais — la sphère
  serait restée sur "Réflexion…" micro coupé, conversation morte. Un
  garde reprend l'écoute dès que `busy` retombe sans nouvelle réponse.
- Toujours aucune dépendance ajoutée : API Web Speech du navigateur,
  déjà disponible dans WebView2 (voir la v0.7.5 pour la vérification).

### Passe de sécurité v0.9.0 (site, base, app)

Demandée dans le même message. Chaque point ci-dessous était un trou réel,
pas une précaution théorique.

- **Site — en-têtes HTTP absents** (`vercel.json`) : aucune CSP, aucun
  `nosniff`, aucun `frame-ancestors`. Ajoutés, avec une CSP qui interdit
  notamment le chargement de scripts depuis un domaine arbitraire. Limite
  assumée et documentée : `script-src` garde `'unsafe-inline'`, parce que
  chaque page porte de vrais scripts en ligne (dont celui qui applique le
  thème avant le premier rendu) et qu'un site statique édité à la main ne
  peut pas maintenir des hachages à jour sans se casser silencieusement.
- **App — CSP du webview désactivée** (`"csp": null` dans
  `tauri.conf.json`, depuis la création du projet). C'est le point le
  plus payant des trois : dans une app Tauri, un XSS ne vole pas des
  cookies, il atteint l'IPC et donc `run_powershell_command`. Le rendu
  markdown passe déjà par DOMPurify, mais une CSP ferme le cas d'un
  contournement de DOMPurify qui injecterait un `<script src=…>` distant.
  Politique volontairement permissive sur ce qui est réellement utilisé
  (`'unsafe-inline'`, `blob:` pour les workers Monaco) pour ne pas casser
  l'app, stricte sur le reste (`object-src 'none'`, pas de `frame-src`,
  scripts distants bloqués). **À vérifier au premier lancement** — c'est
  le seul changement de cette passe qui pourrait, en cas d'erreur,
  empêcher l'app de s'afficher ; le retour en arrière est une seule ligne
  de configuration.
- **Base — `supabase/security_hardening_migration.sql`** (nouveau, **à
  exécuter par l'utilisateur**) :
  - *Aucune limite de taille nulle part.* `controlme_knowledge_shares.content`
    est insérable par le rôle `anon` (seule écriture anon du projet) sans
    plafond : un INSERT de plusieurs centaines de Mo était possible, en
    boucle. Contraintes ajoutées là et sur les champs des extensions.
  - *Compteurs gonflables à l'infini.* `record_extension_page_view` et
    `record_extension_install_click` sont `security definer` et
    appelables par `anon` sans déduplication — n'importe qui pouvait
    boucler l'appel pour gonfler les statistiques de sa propre extension.
    Déduplication ajoutée par appelant et par jour, via le hash md5 de
    l'IP lue dans `request.headers` (le GUC exposé par PostgREST) : l'IP
    n'est jamais stockée en clair, seul le hash sert de clé. Repli
    délibéré vers l'ancien comportement si l'en-tête est absent, plutôt
    que de ne plus rien compter.
  - *URL non contraintes* (`avatar_url`, `thumbnail_url`, `media_url`),
    réinjectées dans des attributs `src` : restreintes à `https://`.
  - *Bucket `avatars`* sans limite de taille ni type MIME (contrairement
    à `extension-media`) : aligné dessus.

### Où passe réellement le temps dans Control Me (v0.9.0, mesuré)

L'utilisateur signalait ">10 s entre chaque commande". Les sessions
précédentes avaient conclu "c'est la latence Gemini" **par raisonnement,
sans jamais mesurer** — notamment en supposant que la lecture locale de
l'interface était rapide (<100 ms). Cette fois, mesure réelle sur cette
machine, avec un banc d'essai gardé dans le dépôt
(`src-tauri/examples/uia_bench.rs`, `cargo run --release --example
uia_bench`) pour pouvoir être rejoué.

**Résultats (walk actuel, arbre d'accessibilité préchauffé) :**

| Fenêtre cible | Durée | Éléments |
|---|---|---|
| Explorateur de fichiers | **839-871 ms** | 82 visités, 60 retenus (plafond) |
| Fenêtre de cette app | 121 ms | 15 visités |
| VS Code | 65-67 ms | 12 visités |
| Bureau / fenêtres vides | 8-13 ms | 1 visité |

**L'"optimisation" évidente était un piège, et la mesure l'a démontré
avant qu'elle ne soit livrée.** La recommandation classique pour UI
Automation est de remplacer les lectures de propriétés une par une
(chaque appel traverse le processus) par un `FindAllBuildCache` groupé.
Implémenté avec `TreeScope::Subtree`, ça a mesuré **17 192 ms** — 20 fois
pire que l'existant — parce que `Subtree` force le fournisseur à
matérialiser l'arbre d'accessibilité entier. Une deuxième tentative
bornée (un appel caché par niveau, `TreeScope::Children`) a échoué sur
l'API de la crate (`AutomationElement n'était pas demandé`) même après
avoir posé `ElementMode::Full`. Les deux tentatives ont été **retirées**,
pas gardées "au cas où" : le code est resté sur le walk d'origine, avec
les mesures en commentaire pour que personne ne refasse le trajet.

**Conclusion, chiffrée plutôt qu'affirmée** : le pipeline local coûte
entre 8 ms et ~0,9 s selon la fenêtre visée. Même en supprimant
totalement la lecture d'interface, ça ne retire pas 1 s sur les >10 s
constatés — donc l'essentiel du délai est bien l'aller-retour Gemini,
mais c'est maintenant établi par soustraction mesurée, pas supposé.
**Impossible de mesurer Gemini depuis cet environnement** : aucun
`settings.json` avec clé API n'existe sur cette machine (Control Me n'y a
jamais été configuré), donc aucun chiffrage de la part réseau/inférence
n'a pu être fait — c'est la seule pièce manquante du budget.

Deux vraies améliorations en sont sorties malgré tout :
- **`read_ui_off_runtime`** (`controlme.rs`) : la lecture d'interface
  passe par `tokio::task::spawn_blocking`. Elle ne devient pas plus
  rapide, mais elle cesse d'immobiliser un thread du runtime async
  jusqu'à ~0,9 s — ce qui bloquait aussi le heartbeat et le flux d'écran
  du contrôle à distance quand une session était suivie depuis le site.
- **Vrai bug de panique corrigé** (`ui_automation.rs`) :
  `&label[..80]` tronquait un libellé d'interface par octets. Tout
  libellé contenant un accent, un emoji ou du CJK à cheval sur l'octet 80
  faisait paniquer le thread — atteignable trivialement sur une interface
  française. Remplacé par une troncature par caractères.

Le levier restant contre le nombre d'allers-retours reste le bascule
"Prédéfini" (voir la section précédente) — construit en v0.8.0, dont le
build n'avait jamais abouti, donc jamais réellement essayé.

### Micro, skills dans Control Me et actions à durée (v0.9.1)

Lot de retours après le premier vrai essai du mode vocal livré en v0.9.0.

**Le bug micro : la cause était en Rust, pas en JavaScript.** Signalé
comme "même si je mets activer le micro il m'entend pas". Trois défauts
distincts, dont un seul est la vraie cause racine :

1. **Cause racine — WebView2 n'avait jamais accordé le micro.** WebView2
   conditionne `getUserMedia` (donc toute reconnaissance vocale) à sa
   propre invite de permission, et — point décisif vérifié plutôt que
   supposé — une fois cette invite refusée ou simplement ignorée, **la
   page ne peut plus jamais la redemander** : le micro reste bloqué en
   silence, définitivement, ce qui produit exactement le symptôme décrit.
   Corrigé dans `lib.rs`, dans le bloc `with_webview` déjà en place pour
   le correctif Ctrl+S : un `PermissionRequestedEventHandler` accorde
   `COREWEBVIEW2_PERMISSION_KIND_MICROPHONE`, donc la demande n'atteint
   plus jamais cette invite. **Scopé au micro uniquement** — tout autre
   type de permission garde le traitement par défaut de WebView2, plutôt
   qu'une approbation en bloc.
2. **L'erreur était jetée à la poubelle** (`voice.ts`) :
   `recognizer.onerror = () => onEnd()` perdait le code d'erreur, donc un
   micro bloqué était rigoureusement indistinguable de "tu n'as rien
   dit". La signature devient `onEnd(error?: string)`, et les codes sont
   traduits en messages qui disent quoi faire.
3. **Boucle de relance infinie** : `onerror` **et** `onend` se déclenchent
   tous les deux pour une session ratée, donc `onEnd` était appelé deux
   fois par échec — soit deux relances par échec dans la boucle mains
   libres, c'est-à-dire une boucle serrée dès que la reconnaissance
   échouait instantanément (ce que fait précisément un micro bloqué).
   Garde `ended` dans `voice.ts`, plus un plafond de 3 échecs dans
   `VoiceMode.tsx`.

**Limite réelle, à ne pas masquer** : la recherche faite pour ce
correctif montre des rapports constants (Electron, CEF) d'une
reconnaissance vocale qui échoue en `network` dans un Chromium embarqué,
parce qu'elle dépend d'un service Google dont la clé n'est présente que
dans les navigateurs de marque. Le mainteneur Tauri affirme à l'inverse
que sous Windows "both parts should just work". **Impossible de trancher
depuis cet environnement** (aucun accès GUI) — d'où le message dédié pour
le code `network`, qui distingue ce cas du micro bloqué au lieu de les
confondre. Si l'utilisateur voit ce message précis, la cause est le
service de reconnaissance, pas la permission, et il faudra alors une vraie
alternative (enregistrement local + transcription par Gemini, non
construite).

**L'IA parle toujours, même sourde.** Demandé explicitement ("dans le
vocal l'ia doit toujours me parler, mais compliqué quand elle m'entend
pas"). Après 3 échecs consécutifs, `VoiceMode` passe en état "sourd" :
l'IA **dit à voix haute** pourquoi elle n'entend plus (au lieu d'un orbe
muet avec un texte d'erreur), et une saisie clavier de secours apparaît —
seule l'entrée repasse au clavier, les réponses continuent d'être dites à
voix haute. Sans ça, un micro cassé transformait le mode vocal en écran
mort.

**Bouton haut-parleur par message retiré** (`MessageBubble.tsx` + son CSS)
— demandé explicitement. La lecture à voix haute existe toujours, mais
uniquement là où elle a du sens : dans le mode conversation vocale.

**Skills gérés depuis Control Me** (`ControlMeView.tsx`). Le panneau
Skills ne faisait que cocher des skills existants ; toute la gestion
vivait dans l'espace Skills séparé. Il gagne :
- **"Créer un skill depuis cette conversation"** — la demande initiale
  ("ca fais une discussion, ou l'ia pourra noter des chose de ce quelle a
  appris"). Réutilise `extract_skill_from_transcript`, déjà en place
  depuis la v0.6.0, avec un contenu existant vide : Gemini relit toute la
  session et écrit ce qu'il en a appris. Le skill créé est **coché
  automatiquement** pour la suite de la session.
- **"Enrichir"** par skill — même appel, mais avec le contenu actuel du
  skill passé en `existingContent`, donc une mise à jour plutôt qu'un
  remplacement (c'est ce paramètre, déjà prévu, qui fait la différence).
- **Renommer** (double-clic, même pattern que la Sidebar) et
  **supprimer** (avec confirmation).
- Cocher plusieurs skills fonctionnait déjà et reste inchangé : ils sont
  tous préfixés à la même conversation, comme demandé.

**Cinq nouvelles actions, disponibles dans les deux modes de perception**
(`timed_action_tools()`, ajouté à `build_capture_tools()` **et**
`build_windows_ui_tools()` — même orthogonalité que `remember_fact`) :
- `hold_key(key, seconds)` — la demande explicite ("rester appuyer sur z
  ou q"). `key_down`/`key_up` existaient déjà, mais **répartis sur deux
  allers-retours Gemini** : la touche restait enfoncée exactement le
  temps que le modèle mette à répondre, soit plusieurs secondes non
  contrôlables — inutilisable dès que la durée compte, ce qui est
  précisément le cas dans un jeu. Le maintien se fait maintenant en un
  seul appel, avec la durée réellement demandée.
- `press_key_repeat(key, times)` — jusqu'à 50 appuis en un appel au lieu
  d'autant d'allers-retours.
- `hold_mouse(x, y, seconds, button)` — appui long / tir continu.
- `move_relative(dx, dy)` — déplacement relatif, **nécessaire** dans un
  jeu qui capture le curseur : les coordonnées absolues n'y ont aucun
  effet.
- `scroll_at(x, y, direction)` — défiler dans une zone précise quand la
  page en contient plusieurs.

Aucune de ces cinq n'entre dans `NO_VISUAL_EFFECT_TOOLS` : elles
modifient l'écran, donc l'attente et la ré-observation habituelles
s'appliquent. `dispatch_action` n'a eu besoin d'aucune modification (tout
nom non spécial tombe déjà dans `execute_action`).

`cargo check` et `npx tsc --noEmit` à 0 erreur. **Aucune vérification GUI
possible dans cet environnement** — à confirmer par l'utilisateur : que le
micro entend enfin (et si non, quel message exact s'affiche — c'est lui
qui distingue permission et service), la création/enrichissement de skill
depuis une conversation, et `hold_key` en conditions réelles.

### Enregistrement dans un skill pendant la conversation (v0.9.2)

Demande explicite, qui corrige une lecture trop étroite de la v0.9.1 :
"dans une conversation on peut créer un skill, et l'annuler ou arrêter de
sauvegarder, même avant de parler, l'IA Control Me va y rajouter dedans ce
qu'il juge important". La v0.9.1 avait construit une **extraction à la
fin** (`extract_skill_from_transcript` rejoué sur une session terminée) ;
ce qui était demandé est un **enregistrement pendant**.

- **Armer** : bouton "Enregistrer dans un nouveau skill" (ou "Enregistrer
  ici" sur un skill existant) dans le panneau Skills de Control Me.
  Utilisable **avant le premier message** — c'est le point : le modèle
  écrit au fur et à mesure au lieu qu'il faille penser à tout extraire
  après coup.
- **Outil `add_to_skill`** (`controlme.rs`), déclaré **uniquement** quand
  un skill est armé, dans les deux modes de perception. Il ne prend qu'une
  `note` — aucune cible — donc le modèle ne peut écrire que dans le skill
  choisi par l'utilisateur. Ajouté à `NO_VISUAL_EFFECT_TOOLS` (n'agit pas
  sur l'écran, donc ni attente ni nouvelle observation).
  `skills::append_to_skill` écrit une ligne par note, plafonnée à 40 Ko
  pour qu'une session longue ou qui boucle ne fasse pas gonfler le fichier
  sans fin ; l'id passe par `skill_path`, qui est ce qui rejette une
  tentative de traversal.
- **Arrêter / Annuler** : Arrêter conserve tout. Annuler supprime le skill
  s'il venait d'être créé, sinon restaure le contenu capturé au moment de
  l'armement (`snapshot`) — sans ça, annuler sur un skill existant aurait
  laissé des notes à moitié écrites.
- **Sessions distantes exclues** (`remote.rs` passe `None`) : armer est un
  geste local délibéré, et personne n'est devant la machine pour arrêter.

### Panneau Audio des Réglages (v0.9.2)

Demandé en même temps que "j'ai pas l'impression qu'il m'entend". Autant un
diagnostic qu'une page de réglages : "le micro ne m'entend pas" a **trois
causes qui se ressemblent exactement** de l'extérieur et appellent des
correctifs différents — pas de périphérique / permission jamais accordée /
service de transcription injoignable depuis un webview embarqué.

Le **niveau sonore en direct** (getUserMedia + AnalyserNode) tranche : si
la barre bouge, le son atteint réellement l'app, donc tout échec ensuite
vient du service de reconnaissance et non du micro. S'y ajoutent l'état de
la permission (Permissions API), la liste des entrées
(`enumerateDevices` — les libellés restent masqués tant que la permission
n'est pas accordée, d'oû le rafraîchissement après le premier
getUserMedia), un test de reconnaissance qui affiche le **code d'erreur
exact**, et un test de voix de sortie.

### Transcription de secours par Gemini et liens vers Windows (v0.9.2)

Deux ajouts d'abord annoncés comme volontairement absents, puis demandés
explicitement.

**Pas de menu de sélection du micro, et c'est délibéré.** La
reconnaissance vocale du moteur utilise toujours le périphérique par
défaut de Windows et n'expose aucun moyen d'en choisir un autre. Un menu
dans l'app n'aurait piloté que le compteur de niveau — donc il aurait
menti. À la place, deux boutons ouvrent directement les pages Windows qui
comptent (`ms-settings:privacy-microphone`, `ms-settings:sound`), via
`open_windows_settings` — commande Rust avec **liste blanche** des URI :
cet argument finit résolu par le shell, rien d'autre que ces deux pages
n'a de raison d'être ouvert de là. `explorer.exe` résout l'URI ; passer
par `cmd` ferait clignoter une console.

**Chemin de transcription indépendant** (`src/audioRecorder.ts` +
`skills::transcribe_audio`) : l'audio est enregistré localement par
`MediaRecorder`, puis transcrit par Gemini. Il ne remplace pas la
reconnaissance du moteur, il existe précisément pour le cas où celle-ci
échoue en `network` — un échec que l'app ne peut pas corriger, puisqu'il
vient d'un service Google dont la clé n'accompagne que les navigateurs de
marque.

- **Format vérifié, pas deviné** : l'API Interactions documente l'audio en
  `{"type":"audio","data":<base64>,"mime_type":...}` et accepte
  `audio/webm`, ce que `MediaRecorder` produit ici. C'était le vrai
  risque : la doc de l'ancien endpoint `generateContent` liste un jeu de
  formats plus restreint où **WebM est absent**, donc partir de cette
  page-là aurait mené à un échec silencieux.
- Le type est choisi via `MediaRecorder.isTypeSupported` plutôt qu'écrit
  en dur : un type non supporté fait lever le constructeur.
- L'encodage base64 parcourt le tampon par tranches — `btoa` avec un
  spread sur un gros tableau dépasse la limite de pile, et l'échec aurait
  été silencieux sur un enregistrement long.
- Plafond côté Rust avant l'envoi (la requête inline est limitée à 20 Mo,
  et le base64 gonfle d'environ un tiers) : refus clair plutôt qu'une
  erreur opaque de l'API.
- Branché à deux endroits : un test dans Réglages > Audio, et surtout un
  **"appuyer pour parler" dans `VoiceMode`** dès que la reconnaissance est
  tombée — le mode vocal reste une conversation au lieu de dégrader vers
  la saisie clavier seule. Nécessite la clé Gemini de l'utilisateur : sans
  elle le bouton ne s'affiche pas, plutôt que d'échouer au clic.
- **Nouvelle exception réseau** à rattacher à la section Confidentialité :
  l'audio enregistré part vers Google, uniquement sur action explicite
  (bouton parler / bouton de test), jamais en continu.

### Troisieme passe sur Codex, mesuree (v0.9.2)

Retour utilisateur : "ameliore aussi les commandes codex car j'ai
l'impression qu'elle ne fonctionne pas" — après v0.3.3 (prompt), v0.3.4
(filet markdown) et v0.6.2 (filet JSON). Cette fois encore, sonde contre
l'Ollama réellement installé (`qwen2.5-coder:3b`) plutôt qu'un quatrième
patch à l'aveugle, avec le vrai `CODEX_SYSTEM_PROMPT` et les vrais schémas
d'outils lus depuis `agentTools.ts`.

**Confirmé (reproduit)** : le modèle ne remplit **jamais** le champ
`tool_calls` structuré. Il écrit l'appel en JSON brut dans `content`, avec
la valeur imbriquée sous une clé `value` — exactement ce que décrivait la
v0.6.2. Le filet de secours est donc ce qui fait fonctionner Codex, pas le
tool-calling normal.

**Erreur de méthode commise puis corrigée dans la même session, à ne pas
reproduire** : un premier test à **un seul échantillon** par variante a
semblé montrer que l'absence de `tool_name` sur les messages de résultat
faisait boucler le modèle indéfiniment, et ça a été annoncé comme "le vrai
bug, décisif". La boucle complète rejouée ensuite a montré que les deux
variantes aboutissent. Le modèle échantillonne : **un essai ne prouve
rien**, il faut compter sur plusieurs exécutions. Comptage réel ensuite :
**5/5 aboutissent sans `tool_name`**, en 2 à 3 tours. `tool_name` est envoyé quand même — c'est le
champ documenté par Ollama pour un message `role: "tool"` — mais **ne pas
le présenter comme la cause** du problème rapporté.

**Trois vrais défauts corrigés** :
1. **Le JSON brut s'affichait comme un message de l'assistant.** Quand le
   filet se déclenche, `content: resp.content` mettait
   `{"name":"list_dir","arguments":{...}}` dans le transcript — ça se lit
   comme "elle a craché du JSON et n'a rien fait", même quand l'outil
   tournait vraiment. C'est très probablement l'origine de l'impression
   rapportée. Nouveau champ `displayContent` (`types.ts`) : l'affichage
   masque l'appel, le format d'envoi garde `content` intact (le tour du
   modèle doit rester complet pour la requête suivante).
2. **Le filet ne reconnaissait qu'une seule forme d'appel.**
   `extractFallbackJsonToolCall` est devenu `extractFallbackJsonToolCalls`
   (au pluriel) et gère : `arguments` sérialisé en **chaîne** JSON
   (convention OpenAI), **plusieurs appels d'affilée** (l'ancien découpage
   "premier `{` → dernier `}`" produisait du JSON invalide dans ce cas),
   `parameters`/`args`/`input` au lieu d'`arguments`, et les wrappers
   `tool_call`/`function_call`. Le scan d'objets JSON équilibre les
   accolades en ignorant celles à l'intérieur des chaînes. **14 cas sur
   14**, dont trois qui ne doivent **pas** matcher (prose seule, JSON sans
   rapport, nom d'outil inconnu).
3. **Le dépliage des arguments mal formés ne s'appliquait qu'au filet.**
   Un `tool_call` structuré portant la même forme
   (`{"path": {"type":"string","value":"..."}}`) arrivait à l'outil avec un
   objet là où une chaîne était attendue, et l'appel échouait. Le dépliage
   s'applique maintenant aux deux chemins.

### Mode apprentissage et skills par conversation (v1.0.0)

Demande explicite : « en parlant avec l'IA, après avoir cliqué sur créer
un skill, il lui apprend à faire des choses, genre je lui apprends à aller
sur un site, comment surfer ». La v0.9.2 avait construit l'**enregistrement**
(l'IA agit et note ce qu'elle juge important) ; ce qui est demandé ici est
une **leçon** : la personne explique, l'IA apprend.

- Nouveau paramètre `teaching: bool` sur `run_control_me`/`run_control_me_core`.
  Quand il est vrai, un brief est préfixé à l'instruction : n'agis pas sur
  l'ordinateur de toi-même, reformule pour confirmer, pose une question quand
  un détail manque, et appelle `add_to_skill` au fil de l'eau avec des notes
  autonomes (quoi, où, dans quel ordre, comment savoir que c'est réussi).
  **Sans ce brief le modèle traite chaque phrase comme une tâche et se met
  à cliquer**, ce qui est l'exact contraire de se faire enseigner.
- Les outils d'action restent déclarés plutôt que retirés : le brief demande
  la retenue, mais on peut lui dire « essaie maintenant » pour vérifier ce
  qu'elle a compris, ce qui serait impossible si les outils avaient disparu.
- Les sessions distantes ne peuvent pas enseigner (`remote.rs` passe
  `false`) : armer un apprentissage est un geste local délibéré.

**Skills utilisés par conversation** (`SessionSkills.tsx`, dans Réglages >
Extensions > Control Me) : `ControlMeSession` gagne `skill_ids`
(`#[serde(default)]`, donc les sessions enregistrées avant ce champ se
chargent toujours), porté aussi par `ControlMeSessionMeta` pour que le
panneau n'ait pas à charger chaque session entière. Chaque conversation
affiche les skills qu'elle a utilisés, avec « Améliorer » qui relit cette
conversation et enrichit ce skill précis — `extract_skill_from_transcript`
avec le contenu actuel en `existingContent`, donc une mise à jour et non
une réécriture. L'idée : un skill s'améliore à partir des sessions qui
l'ont réellement exercé, sans avoir à se rappeler laquelle a servi à quoi.

### Codex connaît son dossier (v1.0.0)

Le prompt système de Codex ne mentionnait **nulle part** le dossier ouvert :
le modèle devait deviner un chemin absolu à chaque `read_file`/`list_dir`,
donc il ne pouvait pas répondre à « liste le dossier courant ». Nouveau
`contextNote` sur `useAgentLoop`, réinjecté comme message système **quand
il change** — nécessaire parce que le prompt système n'est envoyé qu'au
premier message, donc ouvrir un autre dossier en cours de conversation
restait invisible pour le modèle.

### Correctifs d'audit (v1.0.0)

Passe demandée explicitement. Cinq défauts réels, pas du style :

1. **`read_ui_elements` appelé explicitement par Gemini restait synchrone**
   et bloquait un thread du runtime jusqu'à ~0,9 s. Le correctif v0.9.0
   n'avait couvert que le chemin d'observation ; `dispatch_action` devient
   async et passe par `read_ui_off_runtime`.
2. **Deux fuites de micro** : quitter Réglages > Audio ou fermer le mode
   vocal pendant un enregistrement laissait le périphérique ouvert, sans
   moyen de l'arrêter (indicateur Windows allumé en permanence).
3. **Bug introduit une heure plus tôt dans la même session** : un échec
   passager du bouton « appuyer pour parler » appelait `setError`, dont
   dérive l'état « sourd » — l'interface restait donc verrouillée en mode
   dégradé alors que la reconnaissance fonctionnait. État séparé.
4. **Changer de micro pendant le test** ne redémarrait pas la mesure : la
   barre continuait d'afficher l'ancien appareil, ce qui est pire que rien.
5. **`partial_cmp().unwrap()` dans quatre comparateurs de tri** : pas
   atteignable aujourd'hui (JSON ne porte pas NaN), mais une panique dans
   une commande Tauri coûte cher ici — la v0.5.8 avait tué l'app entière
   pour cette raison.

### Les 6 outils de l'agent
1. `read_file` — lecture texte (limite 5 Mo), chemin absolu
2. `list_dir` — listing un niveau, chemin absolu
3. `write_file` — création/écrasement complet
4. `edit_file` — remplacement exact ciblé (préféré à `write_file` sur fichier existant)
5. `run_powershell_command` — exécution PowerShell, streaming, timeout, annulable
6. `ask_user_question` — pose une question à l'utilisateur et attend sa réponse

`write_file`, `edit_file` et `run_powershell_command` sont les outils mutants
(`MUTATING_TOOLS` dans `src/agentTools.ts`) ; ce sont les seuls soumis au mode Approbation.

### Bascule Auto / Approbation
Réglage `codex_mode` (`"auto"|"approve"`, défaut `"approve"`). En mode
Approbation, chaque outil mutant ouvre une modale (diff Monaco pour
write/edit, confirmation textuelle pour les commandes) avant exécution. C'est
le seul filet de sécurité de l'application — voir Limites connues ci-dessous.

### Système anti-gel

Demandé explicitement par l'utilisateur : fermer l'app si elle semble figée,
sans jamais la fermer juste parce qu'elle utilise 100% des ressources en
train de vraiment générer. Couvre maintenant **le chat de base ET Codex**
(`send_chat` et `agent_chat` partagent le même `Watchdog`) :

- `src-tauri/src/commands/watchdog.rs` — `Watchdog` (état partagé
  `Arc<Mutex<...>>`, managé par Tauri), `WatchdogGuard` (RAII : incrémente un
  compteur de générations actives à la création, le décrémente au `Drop`, donc
  chaque sortie du thread/appel qui l'utilise — erreur, annulation, fin
  normale — se désenregistre correctement sans avoir à s'en souvenir à chaque
  `return`), un thread qui vérifie toutes les 5s si ça fait plus de 120s sans
  le moindre chunk reçu **alors qu'au moins une génération est active**.
- **Compteur plutôt que booléen** : rien n'empêche le chat de base et Codex de
  générer en même temps (changer de vue ne coupe pas une requête en cours) —
  un simple booléen aurait un bug où la première génération à finir désactive
  à tort le suivi de l'autre encore en cours.
- Chaque chunk streamé (`send_chat` ET maintenant `agent_chat`, voir
  Architecture > Codex) compte comme une vraie preuve de progression
  (`report_progress`) — si des chunks recommencent à arriver après un
  avertissement, il se résout tout seul (`freeze-resolved`), sans que
  l'utilisateur ait à cliquer quoi que ce soit.
- Si 120s s'écoulent sans le moindre chunk : événement `freeze-warning`
  (`stalled_secs`) envoyé au front. Le compte à rebours de grâce (20s,
  `FREEZE_GRACE_SECS` dans `App.tsx`) est géré **côté front**, pas par le
  watchdog Rust lui-même — celui-ci se contente de détecter et prévenir, la
  fermeture réelle passe par la commande `close_app` (`app.exit(0)`),
  déclenchée soit par le timer du front, soit par le bouton "Fermer
  maintenant", soit annulée/reportée par "Attendre encore".

**Pourquoi c'est sûr pour Codex maintenant** (ça ne l'était pas avant que
`agent_chat` streame en interne, voir Architecture > Codex pour le pourquoi
technique) : le `WatchdogGuard` de `agent_chat` est scopé strictement à
l'appel HTTP vers Ollama lui-même — il se désenregistre dès que `agent_chat`
retourne, **avant** que `useAgentLoop.ts` n'exécute le moindre tool_call. Les
outils mutants (`write_file`/`edit_file`/`run_powershell_command`) tournent
dans des commandes Tauri complètement séparées, appelées après coup — le
watchdog n'est jamais actif pendant qu'un fichier est en cours d'écriture,
donc aucun risque de fermeture en pleine écriture.

### Freeze au démarrage (bug corrigé en v0.3.2)

Signalé par l'utilisateur : un freeze systématique à chaque lancement de
l'app, ~5 secondes, apparu "depuis la v0.3.0". Deux causes distinctes
identifiées et corrigées ensemble :

1. **Aucun timeout sur la vérification de mise à jour automatique**.
   `UPDATE_CHECK_DELAY_MS` vaut exactement 5000ms — coïncidence trop précise
   avec les "5 secondes" rapportées pour être ignorée. Vérifié en lisant le
   code source de `tauri-plugin-updater` (`updater.rs` : `timeout: Option<Duration>`,
   défaut `None`) : ni la vérif automatique au démarrage ni le bouton manuel
   "Vérifier les mises à jour" ne bornaient jamais la requête HTTP — un
   réseau lent (DNS, VPN, pare-feu) pouvait faire pendre l'appel
   indéfiniment, sans jamais résoudre ni rejeter la promesse. Corrigé en
   passant `{ timeout: UPDATE_CHECK_TIMEOUT_MS }` (10s) à `check()` dans
   `App.tsx`, pour les deux appels (silencieux et manuel) — la commande
   `check` du plugin accepte bien ce paramètre côté JS (`CheckOptions.timeout`,
   transmis jusqu'à `updater.rs`).
2. **`get_system_ram_gb` bloquait un thread du runtime async**. Commande
   Rust **non-async** faisant un `std::process::Command::new("powershell")
   .output()` **synchrone et bloquant** (attente du process PowerShell,
   souvent 1 à 5s pour un `Get-CimInstance` WMI + démarrage de l'hôte
   PowerShell) au tout début du montage de `App.tsx`, en parallèle d'autres
   appels `invoke()` critiques pour le premier rendu (`load_settings`,
   `list_models`, `list_conversations`). Aucune trace de `spawn_blocking`
   dans les macros/codegen de Tauri (vérifié dans le cache cargo local) : une
   commande sync bloquante peut donc immobiliser un thread ouvrier du
   runtime tokio partagé, ce qui peut retarder d'autres commandes en attente
   sur un pool de threads restreint (surtout sur une machine à peu de
   cœurs). Corrigé en passant la commande en `async fn` avec
   `tokio::process::Command` (feature `process` ajoutée à `tokio` dans
   `Cargo.toml`) — le process est maintenant attendu de façon async, sans
   jamais occuper de thread ouvrier pendant l'attente.

Combinées, ces deux corrections éliminent le risque de blocage plutôt que de
juste le rendre moins probable — bornage explicite (1) et suppression du
blocage à la source (2), plutôt qu'une seule rustine côté symptôme.
Vérification faite via `cargo check`/`npx tsc --noEmit` (0 erreur) ; pas de
reproduction possible en local (pas d'accès GUI dans cet environnement) —
**à confirmer par l'utilisateur** après installation de la v0.3.2 que le
freeze a bien disparu.

## Limites connues et risques

- **Accès fichiers non-sandboxé** : l'agent peut lire/écrire n'importe où sur
  le PC de l'utilisateur, pas seulement dans le dossier ouvert. Choix
  explicite de l'utilisateur après avoir été prévenu des risques.
- **Exécution PowerShell autorisée** sans sandbox. Même choix explicite.
- **Bug corrigé en v0.2.1** : `reqwest` était configuré
  (`default-features = false, features = ["blocking", "json"]`) **sans aucun
  backend TLS**, donc toute requête HTTPS échouait au runtime avec "Impossible
  de contacter Supabase : error sending request for url..." — touchait
  `check_for_update` ET `search_hf_models` (les deux seuls appels HTTPS du
  code). Passé inaperçu jusqu'à la v0.2.0 car jamais testé en conditions
  réelles (seulement vérifié via `curl` en direct côté Supabase, jamais via
  le binaire compilé). Corrigé en ajoutant la feature `rustls-tls` à
  `reqwest` dans `Cargo.toml`. **Leçon** : `cargo check`/`cargo build` ne
  détectent pas ce genre de problème (c'est un échec runtime, pas de
  compilation) — pour toute nouvelle commande qui fait un appel HTTPS,
  vérifier qu'elle marche réellement une fois l'app lancée, pas juste que ça
  compile.
- **Installeur non signé** : Windows SmartScreen affiche un avertissement
  "Éditeur inconnu" au premier lancement (constaté par l'utilisateur avec la
  v0.1.0). Seule une signature de code (certificat payant, OV ou EV) ou une
  distribution via le Microsoft Store (MSIX) fait disparaître cet
  avertissement — **décision explicite de l'utilisateur le 2026-08-30 de ne
  rien faire pour l'instant** (options présentées : certificat OV, certificat
  EV, Microsoft Store MSIX, ne rien faire — l'utilisateur a choisi la
  dernière). Ne relance pas cette question sans qu'on te le redemande. Le
  site documente comment passer outre l'avertissement
  (`Informations complémentaires` → `Exécuter quand même`).
  Metadata Cargo.toml/tauri.conf.json (description, publisher) corrigées le
  2026-08-30 par bonne pratique, mais ça ne change rien à SmartScreen.
- Le mode Approbation est le seul garde-fou : ne l'affaiblis pas (l'assouplir,
  ajouter des exceptions, etc.) sans qu'on te le demande explicitement.
- `agent_chat` streame en interne côté Rust (voir Architecture > Codex et
  Système anti-gel) **et** le frontend affiche maintenant ce flux en direct
  depuis la v0.3.2 (texte en direct, statut d'outil, sortie de commande live,
  approbation inline) — voir "Streaming visuel dans Codex" dans Architecture
  > Codex pour le détail complet. Ancienne limitation résolue.

## Confidentialité réseau (garantie explicite)

Audité le 2026-08-30 (demande explicite de l'utilisateur : "aucune donnée ne
sort de l'appli, tout rentre mais rien ne sort"). Liste exhaustive des appels
réseau sortants dans `src-tauri/src/commands/` à cette date :

1. **`agent_chat` / `send_chat` / `list_models` / `install_model` /
   `delete_model`** (chat.rs, agent.rs) → vers `settings.ollama_host`
   uniquement, réglage contrôlé par l'utilisateur (défaut
   `http://127.0.0.1:11434`, local). C'est le cœur de l'app : les messages et
   fichiers lus par Codex partent forcément vers ce host pour obtenir une
   réponse — attendu, pas une fuite, tant que le host reste local ou choisi
   explicitement par l'utilisateur.
2. **`search_hf_models`** (huggingface.rs) → Hugging Face, envoie uniquement
   le texte de recherche tapé par l'utilisateur (nom de modèle), jamais de
   conversation/fichier/réglage.
3. **`check_for_update`** (update.rs), et le site (`site/index.html`) → API
   REST Supabase en lecture seule, aucune donnée envoyée à part la requête
   elle-même (clé anon en en-tête).
4. **[2026-08-30, exception explicite] `run_control_me`** (controlme.rs) →
   API Gemini de Google, **uniquement quand l'utilisateur lance une
   instruction Control Me**. Contrairement aux trois cas ci-dessus, ceci
   envoie une **capture d'écran complète** à chaque étape (pas juste du
   texte) — tout ce qui est visible à l'écran pendant la session, pas
   seulement l'appli visée par l'instruction. Voir la section "Control Me"
   dans Architecture pour le détail complet (clé API propre à l'utilisateur,
   jamais fournie par l'app ; `enable_prompt_injection_detection` activé).
   C'est une rupture délibérée et documentée de la garantie ci-dessous, pas
   un oubli — demandée explicitement par l'utilisateur en connaissance de
   cause.
5. **[2026-08-31, exception explicite] `remote.rs`** (client WebSocket
   Realtime de Control Me à distance) → service Supabase **Realtime**
   (pas l'API REST/Postgres), **uniquement quand un code de jumelage est
   actif** (généré explicitement par l'utilisateur dans Réglages). Envoie
   des **captures d'écran complètes en continu** (1/s tant qu'un viewer
   est présent sur le salon) et le texte des instructions/réponses vers ce
   relais, consultable par quiconque a rejoint le salon avec le bon code —
   voir "Control Me à distance depuis le site (v0.5.7)" dans Architecture
   > Control Me pour le détail complet (aucune table Postgres, tout en
   Broadcast/Presence éphémère jamais persisté ; modèle de sécurité du
   code de jumelage). Même famille de rupture délibérée et documentée que
   le point 4 — demandée explicitement, en connaissance de cause.
6. **[2026-09-01, exception explicite] `knowledge_base.rs`**
   (`publish_knowledge_base`/`import_knowledge_base`) → API REST Supabase,
   **uniquement à l'action explicite de l'utilisateur** (bouton "Publier
   en public"/"Importer" dans Réglages > Extensions), jamais
   automatiquement. Contrairement au point 3 (lecture seule), **ceci
   écrit réellement** dans une table Postgres publique — voir "Base de
   connaissances Control Me (v0.5.7)" dans Architecture pour le détail
   complet (première écriture `anon` de tout ce projet, RLS et
   implications documentées explicitement à cet endroit).
7. **`import_marketplace_extension`** (skills.rs) → API REST Supabase, en
   lecture seule (récupère le nom/la description/le dernier manifeste
   d'une extension) — sur action explicite de l'utilisateur : soit un
   identifiant collé à la main dans Skills, soit (depuis v0.7, voir
   "Marketplace v0.7" dans Architecture) un clic sur "Ajouter" sur le
   site suivi d'une confirmation **dans l'app** avant tout appel réseau.
   Rien n'est écrit côté Supabase par cette commande — seul le contenu
   récupéré est écrit localement (fichier skill).
8. **[2026-09-04, exception explicite] Reconnaissance vocale** (`voice.ts`,
   bouton micro dans le chat et Control Me) → passe par l'API navigateur
   `SpeechRecognition` de WebView2, **uniquement quand l'utilisateur clique
   sur le bouton micro**. Contrairement à tout le reste de cette liste, ce
   n'est **pas un appel réseau que ce projet contrôle** — `SpeechRecognition`
   est fourni par le moteur Chromium de WebView2 lui-même, qui peut envoyer
   l'audio à un service de reconnaissance vocale externe (typiquement
   Microsoft, potentiellement Google selon la configuration) pour le
   transcrire, exactement comme dans n'importe quel site web utilisant cette
   API standard. Documenté ici par honnêteté (l'app ne peut ni le confirmer
   ni l'empêcher), pas parce que le code de ce projet initie lui-même cet
   appel. La synthèse vocale (bouton "lire à voix haute", `speechSynthesis`)
   n'a pas cette réserve — elle est traitée entièrement en local par Windows,
   aucune donnée n'est envoyée nulle part pour ça.

En dehors de ces huit cas, aucune autre destination réseau n'existe dans
le code (pas de télémétrie, pas d'analytics, pas d'appel automatique à un
service tiers non listé ici). Si tu ajoutes un nouvel appel réseau, vérifie
qu'il tombe dans un de ces cas — sinon, demande confirmation avant d'envoyer
quoi que ce soit qui ressemble à des données utilisateur (conversations,
contenu de fichiers, réglages, captures d'écran) vers autre chose que
`ollama_host`.

## Auto-update en continu

Depuis la v0.3.0 (2026-08-30), "Vérifier les mises à jour" dans Réglages
utilise `tauri-plugin-updater` : télécharge, installe et redémarre l'app
avec le nouveau code, sans jamais ouvrir de navigateur. L'ancien flux (bouton
qui ouvrait le lien Supabase Storage dans le navigateur) a été retiré
entièrement — `update.rs`/`check_for_update` supprimés côté Rust,
`checkForUpdate`/`openExternalUrl`/`UpdateStatus`/`AppRelease` supprimés
côté TS. Le site (`site/index.html`), lui, continue de lire `app_releases`
directement en HTTP pour son propre bouton de téléchargement — logique
différente, pas concerné par ce qui suit.

**Pourquoi une signature cryptographique est obligatoire** : `tauri-plugin-updater`
refuse d'installer un update non signé, par design (empêche d'injecter une
mise à jour malveillante même si l'endpoint ou le fichier hébergé étaient
compromis). Clé générée le 2026-08-30 via `tauri signer generate --ci -p ""`
(sans mot de passe). La clé **publique** est commitée dans
`tauri.conf.json` → `plugins.updater.pubkey` (sans risque, c'est fait pour
être public, comme la clé anon Supabase). La clé **privée** vit dans `.env`
(`TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, cette
dernière vide) — si elle est perdue, aucun install existant ne pourra plus
jamais vérifier une future mise à jour signée avec une nouvelle clé (il
faudrait qu'ils réinstallent manuellement une fois, comme pour n'importe
quel changement de clé de signature).

**Pourquoi un endpoint RPC plutôt qu'une lecture directe de la table** :
`tauri-plugin-updater` attend un JSON précis
(`{version, notes, pub_date, platforms: {"windows-x86_64": {signature, url}}}`),
qu'une requête REST classique sur `app_releases` ne peut pas produire (la
table est plate, pas imbriquée). `supabase/updater_migration.sql` ajoute une
colonne `signature` et une fonction `latest_release_manifest()` (SQL,
`stable`, donc appelable en GET par PostgREST) qui reformate la dernière
ligne dans la forme attendue. `tauri.conf.json` pointe
`plugins.updater.endpoints` vers
`{SUPABASE_URL}/rest/v1/rpc/latest_release_manifest`.

**Bug corrigé en v0.3.1** : `plugins.updater.headers` dans `tauri.conf.json`
**n'est pas un champ que le plugin lit** (halluciné de mémoire, jamais
vérifié contre le vrai schéma de config — `tauri-plugin-updater`'s
`Config` ne supporte que `endpoints`/`pubkey`/`windows`/les 3 flags
`dangerous*`, rien d'autre, voir son `config.rs`). Résultat : aucune clé
`apikey`/`Authorization` n'était jamais envoyée, Supabase répondait 401
("No API key found in request"), et le plugin traduisait ça en l'erreur
générique "Could not fetch a valid release JSON from the remote" — signalée
par l'utilisateur juste après avoir testé v0.3.0. La bonne API : le
`Builder` **Rust** du plugin a un vrai `.header(k, v)` / `.headers(HeaderMap)`,
donc les en-têtes se configurent dans `lib.rs` à l'enregistrement du plugin
(`SUPABASE_ANON_KEY`, `apikey` + `Authorization: Bearer`), pas dans le JSON.
Vérifié avec `curl` avant ET après le fix (sans `apikey` → 401 confirmé
reproductible, ce qui a confirmé l'hypothèse avant de toucher au code).
**Leçon** : comme pour `prevent_close` vs `prevent_default`, ne pas supposer
qu'un champ de config existe parce qu'il "semble logique" qu'il existe —
vérifier contre le code source du plugin (il est dans le cache cargo local,
`~/.cargo/registry/src/.../tauri-plugin-updater-*/src/config.rs`) avant de
l'utiliser, surtout pour un champ jamais testé en conditions réelles.

**Transition ponctuelle** : les installs jusqu'à la v0.2.3 n'ont pas du tout
le plugin updater — elles ne peuvent pas détecter automatiquement une mise à
jour. Un utilisateur doit récupérer une version ≥ 0.3.1 manuellement une
fois (site ou lien Supabase Storage direct) ; à partir de là, les mises à
jour suivantes se font vraiment en un clic depuis l'app — **v0.3.0 elle-même
ne doit pas être considérée comme fonctionnelle** pour l'auto-update (voir
bug ci-dessus), seulement à partir de v0.3.1. v0.3.1 est publiée et vérifiée
(anon key) depuis le 2026-08-30 — c'est la première version où l'auto-update
fonctionne réellement de bout en bout.

## Publier une release

La publication se fait en CLI avec la clé **`service_role`** (contourne
toute RLS — différente de la clé anon utilisée partout ailleurs dans ce
projet, qui elle reste committable). Elle vit dans `.env` à la racine,
**gitignoré** (voir `.env.example` pour le template, jamais rempli avec la
vraie valeur).

Étapes pour publier une nouvelle version :

1. Bump la version dans `package.json`, `src-tauri/Cargo.toml` et
   `src-tauri/tauri.conf.json` (les trois, gardés synchronisés) — sans ça,
   deux versions identiques ne déclenchent aucune mise à jour détectée même
   si le binaire a changé.
2. **`source .env && npm run tauri build`** (bien sourcer `.env` dans la
   **même** commande shell que le build — les variables d'environnement ne
   survivent pas d'un appel Bash à l'autre dans cet environnement). Ça
   produit `<nom>_<version>_x64-setup.exe` **et** un fichier `.sig` à côté
   (signature auto-générée par le bundler grâce aux variables
   `TAURI_SIGNING_PRIVATE_KEY*`) — sans `.env` sourcé, le build réussit quand
   même mais sans signature, et l'updater refusera silencieusement cette
   version.
3. Upload l'installeur vers Supabase Storage (bucket public `releases`) avec
   la `service_role` key :
   `POST {SUPABASE_URL}/storage/v1/object/releases/<fichier>`, headers
   `Authorization: Bearer <service_role>` + `apikey: <service_role>`, corps =
   le fichier en binaire.
4. Insère la ligne dans `app_releases`, **avec le contenu du `.sig`** dans le
   champ `signature` :
   `POST {SUPABASE_URL}/rest/v1/app_releases` (mêmes headers,
   `Content-Type: application/json`, `Prefer: return=minimal`) avec
   `{"version", "download_url", "notes", "signature"}`. Le `.sig` contient
   des retours à la ligne (format minisign) — construire le JSON avec un
   petit script (Node par ex.), pas à la main, pour ne pas casser
   l'échappement.
5. Vérifie avec la clé **anon** (celle que l'app/le site utilisent
   réellement) : le fichier est lisible publiquement (`curl -I` sur l'URL de
   storage), **et** `GET {SUPABASE_URL}/rest/v1/rpc/latest_release_manifest`
   renvoie bien le JSON avec la nouvelle version — ne jamais considérer une
   release publiée sans ces deux vérifications côté lecture publique.

**Pourquoi la clé `service_role` est traitée différemment de l'anon key** :
l'anon key est conçue pour être publique (protégée par RLS), donc committée
sans souci dans `site/index.html` et `tauri.conf.json`. La `service_role`
key contourne RLS entièrement — un mot de passe root sur tout le projet
Supabase, pas juste cette table. D'où : `.env` gitignoré, jamais lue par
l'app elle-même (aucun `SUPABASE_SERVICE_ROLE_KEY` dans le code Rust/TS —
uniquement utilisée manuellement en CLI au moment de publier), et redemandée
par Claude à chaque session plutôt que supposée disponible, sauf si
l'utilisateur confirme qu'elle est bien dans `.env` local.

## Décisions techniques (le pourquoi)

- **Supabase en lecture seule uniquement, via l'API REST publique (PostgREST),
  sans sqlx ni ORM** (périmètre précisé par l'utilisateur le 2026-08-30 :
  « rien ne sort de l'app »). Contrairement à l'idée initiale du fichier de
  passation, il n'y a **pas de sync des conversations ni des réglages** vers
  Supabase. Le seul usage est : vérification de version dans l'app +
  affichage sur le site (`site/`), sur une table publique en lecture seule
  (clé anon, RLS sans policy d'écriture pour ce rôle). C'est exactement le
  pattern déjà utilisé par le projet sœur OmniDeck pour son update-checker
  (« Update-checker sur Supabase REST directement, sans Prisma » — même
  raisonnement : pas de serveur Node ici pour justifier un ORM, un simple
  appel HTTP suffit pour une lecture publique). **Exception ponctuelle,
  documentée** (v0.5.7) : la publication de base de connaissances Control
  Me (`knowledge_base.rs`) écrit réellement, avec la clé `anon`, sur
  action explicite de l'utilisateur uniquement — voir "Base de
  connaissances Control Me (v0.5.7)" dans Architecture pour le détail
  complet et le modèle de sécurité assumé. Toujours pas d'ORM/sqlx, RLS
  au lieu d'un serveur pour gérer qui peut écrire quoi.
- **Monaco sans CDN** : la version installée (`monaco-editor@0.56.0`) dicte le
  chemin d'import correct via sa map `exports` dans `package.json` — vérifié
  empiriquement : `monaco-editor/editor/editor.worker`, PAS
  `monaco-editor/esm/vs/editor/editor.worker`. Si tu changes de version,
  revérifie ce chemin avant de supposer qu'il a changé de forme.
- **Fenêtre redimensionnable** (1280×800, min 900×560) plutôt que la taille
  fixe 800×600 du template Tauri de départ — nécessaire pour l'éditeur Codex
  (arborescence + éditeur + panneaux) qui a besoin de place.
- **Site de téléchargement sur Vercel** (décidé le 2026-08-30) plutôt que
  GitHub Pages comme envisagé initialement — préférence explicite de
  l'utilisateur.
- **Pas d'emoji** dans la documentation ni les checklists de ce projet
  (préférence explicite de l'utilisateur, 2026-08-30) — d'où les libellés
  texte `[FAIT]`/`[À FAIRE]` plutôt que ✅/🚧/⛔.
- **Annulation de `agent_chat` via `tokio::select!` + polling d'un `AtomicBool`
  toutes les 60 ms**, plutôt qu'un vrai notifieur async (`Notify`) : l'appel
  n'a que deux points d'attente courts (envoi de la requête, parsing JSON de
  la réponse), donc jusqu'à 60 ms de latence d'annulation est imperceptible,
  et ça évite un risque de perte de réveil (cancel arrivant entre la création
  du flag et son premier sondage) qu'un `Notify` mal utilisé peut introduire.
  Nécessite `reqwest::Client` (async) plutôt que `reqwest::blocking` pour cette
  commande précise — `tokio` a été ajouté comme dépendance directe (`time` +
  `macros`) pour `select!`/`sleep`.
- **Clé anon Supabase commitée en dur** (`src-tauri/src/commands/update.rs`
  et `site/index.html`) plutôt que mise dans les réglages ou un `.env` : c'est
  précisément l'usage prévu par Supabase pour cette clé (protégée par les
  policies RLS, pas un secret), même logique que n'importe quel site
  JAMstack public qui l'embarque côté client. Seule la clé `service_role`
  serait un vrai secret à ne jamais commiter.

## Journal des changements

- **2026-08-30** — Import du code existant (chat + Codex) dans le dépôt git
  `Grenofar/ollamachatreactgrnfr` (le dossier de dev d'origine,
  `ollama-chat-react`, n'était pas encore suivi par git) ; premier vrai push
  du code. Rédaction de ce CLAUDE.md. Ajout d'une landing page statique dans
  `site/`. Ajout de la création de fichier inline dans `FileTree`, et d'une
  annulation réelle de `agent_chat` (async + `tokio::select!`) avec bouton
  d'envoi animé (flèche → carré) partagé entre le chat de base et Codex.
  Périmètre Supabase précisé par l'utilisateur : lecture seule (version-check
  + site), pas de sync conversations/réglages, pas de sqlx.
- **2026-08-30** — URL et clé anon Supabase reçues. Ajout de
  `check_for_update` (Rust, jamais d'échec de l'invoke, erreurs réseau dans
  `UpdateStatus.error`), d'une section "Mises à jour" dans les Réglages, et
  d'un fetch client-side équivalent dans `site/index.html` (lien de
  téléchargement réel si une release existe, sinon message statique
  inchangé). Table `app_releases` pas encore créée côté Supabase — SQL prêt
  dans `supabase/schema.sql`, à exécuter une fois par l'utilisateur.
- **2026-08-30** — Refonte complète de `site/` : le site présente le projet
  et sert à **installer** l'app (bouton "Installer", section 3 étapes), avec
  un message explicite partout ("application de bureau Windows — pas de
  version web") pour éviter toute confusion avec une démo web hébergée. Le
  bouton reste piloté par le même fetch Supabase (une seule fonction, deux
  boutons via la classe `.js-cta`).
- **2026-08-30** — Simplification radicale de `site/` sur retour explicite de
  l'utilisateur : un paragraphe de présentation + un seul bouton de
  téléchargement, plus rien d'autre (pas de nav, pas de cartes
  fonctionnalités, pas de guide d'installation) — "0 IA dans le site web",
  page purement présentationnelle. Bug corrigé dans la foulée : le site
  déployé montrait l'app de chat elle-même au lieu de la page statique,
  parce que la racine du repo est un projet Vite/React (l'app de bureau) que
  Vercel build par défaut si le Root Directory du projet Vercel n'est pas
  positionné sur `site`. Ajout de `vercel.json` **à la racine** du repo
  (`outputDirectory: "site"`, framework/build/install désactivés) comme
  filet de sécurité indépendant de ce réglage du dashboard.
- **2026-08-30** — Téléchargement rendu fonctionnel de bout en bout :
  premier build release (`npm run tauri build`, ~22 min, NSIS + MSI),
  bucket public Supabase Storage `releases` créé par l'utilisateur, `.exe`
  NSIS uploadé, ligne insérée dans `app_releases` — vérifié avec `curl`
  (200 OK, `Content-Length` exact). Site enrichi sur demande explicite d'un
  "Comment ça marche" (2 courtes descriptions Chat/Codex) et d'un "Quel
  modèle choisir" (repris des modèles déjà recommandés par l'app elle-même
  dans son message d'erreur function-calling), plus une note sur
  l'avertissement SmartScreen. Métadonnées Cargo.toml/tauri.conf.json
  corrigées (description/publisher) pour les prochains builds — n'affecte
  pas le binaire déjà publié.
- **2026-08-30** — Découverte que `HuggingFaceBrowser.tsx` existait déjà
  (session précédente) mais n'était jamais rendu nulle part : branché sur le
  bouton Sidebar "Installer un modèle" à la place d'`InstallPanel.tsx`
  (supprimé, sa saisie manuelle de référence fusionnée dans une section
  repliable de `HuggingFaceBrowser`). Ajout de `get_system_ram_gb` (RAM
  système via PowerShell, pas de tentative de détection GPU/VRAM — peu
  fiable sous Windows) pour badger chaque résultat "Adapté à ta RAM" /
  "Volumineux pour ta RAM". `list_models` renvoie maintenant taille +
  parameter_size + quantization_level (plus juste le nom), utilisés par le
  nouveau composant `ModelSelect` (menu déroulant cherchable) qui remplace
  le `<select>` HTML natif dans le chat de base et Codex. Retrait de la
  section "Quel modèle choisir" du site (le conseil vit maintenant dans
  l'app, avec de vraies données au lieu d'une liste statique). Nettoyage des
  derniers emoji restants dans l'UI de l'app (Sidebar, FileTree, CodexView,
  AgentTranscript, HuggingFaceBrowser, écran vide du chat) — la consigne
  "pas d'emoji" n'avait jusque-là été appliquée qu'à la doc et au site.
- **2026-08-30** — Lot de fonctionnalités demandées explicitement par
  l'utilisateur : rendu Markdown réel dans le chat (`marked` + `DOMPurify`),
  édition/régénération de message, renommage + recherche de conversation
  dans la Sidebar, désinstallation de modèle, persistance taille/position de
  fenêtre (`tauri-plugin-window-state`), compteurs de tokens (conversation /
  contexte-mémoire / total global). Audit réseau documenté (section
  "Confidentialité réseau" ci-dessus) sur demande explicite de l'utilisateur
  — confirmé qu'aucune donnée utilisateur ne part ailleurs que vers
  `ollama_host`. Site : ajout d'un avertissement "app de bureau,
  consommatrice de ressources, pas pour du matériel limité" et d'un
  calculateur de config (RAM saisie manuellement — un site web ne peut pas
  lire le matériel du visiteur — calcul déterministe, pas d'IA ni d'appel
  réseau) listant les conséquences de prendre un modèle trop gros.
- **2026-08-30** — v0.2.1, correctif : `reqwest` n'avait aucun backend TLS
  (voir Limites connues et risques ci-dessus) — signalé par l'utilisateur qui
  a eu l'erreur "Impossible de contacter Supabase" en testant réellement le
  bouton de vérification de mise à jour dans l'app installée. Ajout de
  `rustls-tls` aux features de `reqwest`. Publiée via le flux CLI
  (`.env` + `service_role`, voir "Publier une release" ci-dessus). Site élargi
  (560px → 820px) et calculateur de config enrichi (menu déroulant de
  modèles GPU NVIDIA/AMD avec VRAM connue à la place d'une case à cocher,
  ajout d'un sélecteur de niveau de processeur).
- **2026-08-30** — Retours utilisateur après test réel de v0.2.1 : (1)
  `ModelSelect` s'ouvrait hors écran dans Codex, corrigé avec la prop
  `direction` ; (2) le navigateur Hugging Face "faisait bugger le PC" —
  cause probable identifiée (RAM système re-détectée en respawnant
  PowerShell à chaque ouverture de la modale, en plus d'une recherche HTTP
  sans timeout), corrigé en détectant la RAM une fois au démarrage de l'app
  et en ajoutant un timeout de 10s à `search_hf_models` ; (3) système
  anti-gel ajouté pour le chat de base, périmètre volontairement limité
  (voir section dédiée ci-dessus) — pas pour Codex, à cause du risque de
  fichier corrompu si l'app est tuée en pleine écriture.
- **2026-08-30** — Retour sur la limitation ci-dessus, sur demande explicite
  de l'utilisateur : `agent_chat` streame maintenant en interne (Ollama
  `stream: true`, parsing NDJSON comme `send_chat`, mais le contrat public de
  la commande ne change pas). Ça donne un vrai signal de progression, donc le
  système anti-gel couvre maintenant Codex aussi (le `WatchdogGuard` est
  scopé à l'appel HTTP seul, jamais actif pendant l'exécution d'un outil,
  donc toujours pas de risque de fichier corrompu). Ajouté dans la foulée :
  recherche de conversation par contenu (`search_conversations`), brouillon
  de message par conversation au lieu d'un seul brouillon global, régénérer
  avec un modèle différent de celui de la conversation, et une icône dans la
  zone de notification (fermer la fenêtre minimise au lieu de quitter).
  **Leçon** : l'API Tauri v2 pour empêcher une fermeture de fenêtre s'appelle
  `CloseRequestApi::prevent_close()`, pas `prevent_default()` (erreur de
  compilation immédiate, corrigée avant tout test — mais un rappel que les
  noms d'API Tauri v1→v2 ne se devinent pas toujours par analogie).
- **2026-08-30** — v0.3.0 : vrai auto-update en continu (`tauri-plugin-updater`),
  sur demande explicite de l'utilisateur — l'ancien bouton "Vérifier les mises
  à jour" ouvrait juste un lien Supabase dans le navigateur, il fallait
  relancer le setup soi-même. Génération d'une paire de clés de signature
  (`tauri signer generate`), migration Supabase ajoutant une colonne
  `signature` et une fonction RPC `latest_release_manifest()` (voir section
  dédiée plus haut pour le détail complet). `update.rs` et tout ce qui s'y
  rattachait côté front (`checkForUpdate`, `openExternalUrl`,
  `UpdateStatus`/`AppRelease`) supprimés, remplacés par
  `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` directement
  dans `SettingsModal`. Publié en suivant le nouveau processus de "Publier
  une release" (avec signature) ; vérifié via la clé anon que le fichier ET
  le nouvel endpoint RPC répondent correctement avant d'annoncer la release
  terminée.
- **2026-08-30** — v0.3.1 : deux changements sur demande explicite de
  l'utilisateur. (1) Correctif du bug qui rendait l'auto-update de v0.3.0
  silencieusement cassée ("Could not fetch a valid release JSON from the
  remote", signalé par l'utilisateur juste après avoir testé v0.3.0) — voir
  "Bug corrigé en v0.3.1" dans la section "Auto-update en continu" pour le
  détail complet (en-têtes `apikey`/`Authorization` jamais envoyés car
  `plugins.updater.headers` n'existe pas dans le schéma du plugin, corrigé
  en les configurant via le `Builder` Rust dans `lib.rs`). (2) Notification
  proactive : état de vérif d'update (`check`/`downloadAndInstall`/
  `relaunch`) lifté de `SettingsModal` vers `App.tsx`, avec une vérif
  silencieuse automatique 5s après le lancement puis toutes les 4h, affichée
  dans un toast non-bloquant (coin bas-droit) plutôt qu'une modale — "Plus
  tard" mémorise la version pour ne pas re-harceler pour la même version.
  Build signé, uploadé dans le bucket Storage `releases`, ligne insérée dans
  `app_releases` (avec la signature `.sig`), et vérifié via la clé **anon**
  (fichier : 200 OK, 6 618 789 octets ; `latest_release_manifest` : renvoie
  bien la v0.3.1 avec signature et URL) avant d'annoncer la release
  terminée.
- **2026-08-30** — v0.3.2 : deux retours utilisateur après test de v0.3.1.
  (1) Freeze de ~5s à chaque lancement, "depuis la v0.3.0" — deux causes
  corrigées ensemble (timeout manquant sur la vérif de mise à jour +
  `get_system_ram_gb` synchrone bloquant un thread du runtime tokio), voir
  "Freeze au démarrage" dans Architecture pour le détail complet. (2) Dans
  Codex : "on voit quelle tool il utilise", "on voit generer quand il
  parle", "j'ai pas l'impression que l'IA peut apporter des modif", et
  "quand il fait une commande ça enlève le chat, rends-le semblable à Claude
  Code dans VS Code" — refonte de `AgentTranscript`/`useAgentLoop.ts` :
  texte en direct (événement `agent-chat-chunk`), statut d'outil visible
  (`running-tool`, badge animé), sortie de commande PowerShell affichée
  ligne par ligne pendant l'exécution, approbation (diff/commande) intégrée
  **dans** la tool-card du transcript au lieu d'une modale plein écran
  (`ToolApprovalModal.tsx` supprimé), et le fichier modifié s'ouvre
  maintenant automatiquement dans l'éditeur — voir "Streaming visuel dans
  Codex" dans Architecture pour le détail complet. Root-cause du freeze pas
  reproduite en local (pas d'accès GUI dans cet environnement) — à confirmer
  par l'utilisateur après installation. Build signé, uploadé dans le bucket
  Storage `releases`, ligne insérée dans `app_releases`, et vérifié via la
  clé **anon** (fichier : 200 OK, 6 631 889 octets ; `latest_release_manifest` :
  renvoie bien la v0.3.2 avec signature et URL) avant d'annoncer la release
  terminée.
- **2026-08-30** — v0.3.3 : retour utilisateur "fais en sorte qu'il peut
  lancer des commande powershell, et que l'ia elle meme le sache" (modèle
  qwen2.5-coder dans Codex). Deux causes trouvées, voir "L'IA ne sait
  pas/ne peut pas lancer de commande" dans Architecture pour le détail
  complet : (1) `CODEX_SYSTEM_PROMPT` renforcé pour dire explicitement au
  modèle qu'il a un accès réel (pas simulé) et lui interdire de répondre
  "je ne peux pas" au lieu d'appeler l'outil ; (2) race condition réelle
  corrigée dans `runCommandAndCollect` — les listeners d'événements shell
  n'étaient pas attendus avant de lancer la commande, ce qui pouvait
  bloquer indéfiniment un tool call sur une commande très rapide. Build
  signé, uploadé dans le bucket Storage `releases`, ligne insérée dans
  `app_releases`, et vérifié via la clé **anon** (fichier : 200 OK,
  6 640 157 octets ; `latest_release_manifest` : renvoie bien la v0.3.3
  avec signature et URL) avant d'annoncer la release terminée.
- **2026-08-30** — v0.3.4 : toujours des retours sur le même sujet + un bug
  distinct signalé dans la même conversation. Voir "Toujours un souci l'IA
  ne peut pas + Ctrl+S cassé" dans Architecture pour le détail complet.
  (1) Fallback markdown : un modèle peut encore écrire une commande en
  bloc de code au lieu d'un vrai tool_call malgré le prompt renforcé de
  v0.3.3 — détecté et exécuté maintenant comme un vrai outil (même
  approbation, même carte), boucle continue automatiquement ensuite.
  (2) System prompt généralisé à tous les outils, pas seulement les
  commandes (cas "lis gg.txt et dis-moi son contenu"). (3) Ctrl+S ne
  sauvegardait rien — WebView2 interceptait le raccourci comme accélérateur
  natif de navigateur avant que Monaco ne le reçoive ; corrigé via l'API
  bas niveau `window.with_webview` + COM `ICoreWebView2Settings3`. Build
  signé, uploadé dans le bucket Storage `releases`, ligne insérée dans
  `app_releases`, et vérifié via la clé **anon** (fichier : 200 OK,
  6 636 755 octets ; `latest_release_manifest` : renvoie bien la v0.3.4
  avec signature et URL) avant d'annoncer la release terminée.
- **2026-08-30** — Control Me, première version. Demande initiale ("on vas
  ajouter control me... clé api gemini... controller purement et simplement
  mon clavier et ma souris... overlay... F5... pas de croix... arrêter
  Control Me depuis la barre des tâches") suffisamment large et sensible
  (nouvelle capacité OS-level, rupture de la confidentialité réseau) pour
  passer par plan mode avant de coder — plan validé, sauvegardé dans
  `C:\Users\userAsus\.claude\plans\memoized-jingling-platypus.md`. Avant
  de commencer, question annexe posée et mise en pause explicitement par
  l'utilisateur ("pas tout de suite") : mémoire locale de ce que l'IA
  apprend sur l'utilisateur au fil des sessions — notée pour plus tard, pas
  construite. Demande explicite suivante, plus simple que le plan d'origine :
  rendre Control Me lançable **dans l'app** (bouton Sidebar, comme Codex)
  plutôt que seulement via l'overlay séparé + F5 global prévu initialement
  — implémenté comme une troisième vue (`view: "controlme"`), l'overlay
  séparé restant une extension possible non construite. Recherche web
  nécessaire avant d'écrire le moindre code Rust : le modèle
  (`gemini-3.7-flash`) et l'API utilisée (Interactions API,
  `/v1beta/interactions`, avec l'outil intégré `computer_use`) sont sortis
  le 2026-08-13, après la coupure de connaissance de Claude — vérifié en
  plusieurs passes (existence du modèle, schéma exact de l'API, action set
  du mode desktop, protocole `safety_decision`) plutôt que deviné de
  mémoire sur l'ancien `generateContent`. Toutes les crates Rust ajoutées
  (`enigo`, `xcap`, `base64`) via `cargo add` pour résoudre les vraies
  versions actuelles ; API d'`enigo` (`Key`, `Button`, `Coordinate`,
  `Mouse`/`Keyboard` traits) et d'`xcap`/`image` (capture, encodage PNG)
  vérifiées dans le code source des crates avant d'écrire `controlme.rs`,
  qui a compilé sans erreur au premier essai. Voir "Control Me" dans
  Architecture pour le détail technique complet. Pas encore testé en
  conditions réelles (nécessite la clé API Gemini de l'utilisateur). Version
  bumpée à **0.4.0** (nouvelle capacité majeure, pas juste un correctif).
  Build signé, uploadé dans le bucket Storage `releases`, ligne insérée
  dans `app_releases`, et vérifié via la clé **anon** (fichier : 200 OK,
  6 705 128 octets ; `latest_release_manifest` : renvoie bien la v0.4.0
  avec signature et URL) avant d'annoncer la release terminée.
- **2026-08-30** — v0.4.1 : retour utilisateur immédiat après premier test
  de Control Me ("il est trop long, il prend du temps à exécuter des
  choses et à analyser l'écran"). Voir "Optimisation vitesse (v0.4.1)"
  dans Architecture > Control Me pour le détail complet : captures d'écran
  redimensionnées + JPEG (au lieu de PNG pleine résolution), 
  `thinking_level: "low"` sur les appels Gemini, délai de stabilisation
  réduit (300ms → 120ms). Détour immédiat corrigé au passage : un premier
  `cargo add image --features jpeg` sans `default-features = false` a
  ramené tout le support AVIF (`ravif`/`rav1e`/`rayon`) inutilement —
  repéré via `Cargo.lock` juste après coup, corrigé avant de builder.
  Build signé, uploadé dans le bucket Storage `releases`, ligne insérée
  dans `app_releases`, et vérifié via la clé **anon** (fichier : 200 OK,
  6 705 173 octets ; `latest_release_manifest` : renvoie bien la v0.4.1
  avec signature et URL) avant d'annoncer la release terminée. Publication
  retardée par rapport au reste de la session (le build tournait en fond
  pendant plusieurs échanges de conversation sur d'autres sujets) — bien
  vérifier `EXIT=0` et l'horodatage des fichiers `.sig`/`.exe` avant de
  publier quand un build a pu tourner longtemps sans supervision directe.
- **2026-08-30** — v0.4.2 : sélecteur de modèle Gemini dans Control Me
  (3.5 Flash-Lite/3.5 Flash/3.6 Flash/3.7 Flash), demandé explicitement.
  Voir "Sélecteur de modèle (v0.4.2)" dans Architecture > Control Me pour
  le détail complet, notamment la vérification que `gemini-3.6-flash`
  n'est pas documenté par Google comme compatible avec `computer_use` —
  laissé sélectionnable quand même (demandé explicitement), signalé dans
  le menu pour que ça ne soit pas une surprise en cas d'échec. Build signé,
  uploadé dans le bucket Storage `releases`, ligne insérée dans
  `app_releases`, et vérifié via la clé **anon** (fichier : 200 OK,
  6 704 875 octets ; `latest_release_manifest` : renvoie bien la v0.4.2
  avec signature et URL) avant d'annoncer la release terminée.
- **2026-08-30** — L'utilisateur a annulé localement (hors git, édition
  directe des fichiers — "j'ai rewind [le] code") les changements de
  vitesse d'une v0.4.3 qui avait été committée (`ce95a72`) mais dont le
  build n'avait jamais été publié : `SCREENSHOT_MAX_WIDTH`/
  `SCREENSHOT_JPEG_QUALITY`/`thinking_level` sont revenus aux valeurs de
  v0.4.1 (1280/80/"low"), la doc "deuxième passe" ajoutée à ce fichier a
  été retirée. **Le commit v0.4.3 reste dans l'historique git**, mais son
  contenu ne reflète plus l'état réel du code depuis ce rewind — ne pas
  supposer que les valeurs "minimal"/1024/65 sont actives sans vérifier le
  fichier réel. Le build v0.4.3 alors en cours a été stoppé avant
  publication pour éviter de publier un binaire étiqueté 0.4.3 mais
  content de 0.4.1/0.4.2.
- **2026-08-31** — v0.5.0 : Control Me installable séparément de l'app de
  chat, demandé explicitement ("qu'on peut installer CM séparément avec le
  même type de mise à jour et de setup, et un bouton installer Control
  Me, et un markdown pour control me..."). Assez large et avec plusieurs
  approches architecturales possibles (second projet Tauri vs Cargo
  workspace vs config alternative sur le même code) pour repasser par plan
  mode avant de coder. Voir "Control Me : produit installable séparément
  (v0.5.0)" dans Architecture > Control Me pour le détail technique
  complet. Approche retenue : config Tauri alternative
  (`tauri.controlme.conf.json`, fusion profonde RFC 7396 vérifiée dans le
  code source de `tauri-utils` avant de s'appuyer dessus) sur le même
  crate Rust/frontend Vite — zéro duplication de `controlme.rs`. Colonne
  `product` ajoutée à `app_releases` (migration
  `supabase/controlme_product_migration.sql`, **pas encore exécutée par
  l'utilisateur au moment d'écrire ceci** — le bouton de téléchargement
  existant de l'app de chat sur le site casse tant que ce n'est pas fait).
  Site (`site/index.html`) : deuxième bouton, requête filtrée par produit.
  Nouveau `CONTROLME.md` à la racine du dépôt pour une doc autonome. Idées
  supplémentaires proposées mais **pas construites** (discussion, pas
  engagement) : build standalone plus léger sans le chunk Monaco/CodexView,
  UX "tray-first" avec raccourci global (reprend l'idée de l'overlay F5 du
  tout premier plan Control Me), icône/branding distincts, lancement au
  démarrage de Windows.
- **2026-08-31** — v0.5.1 : trois pistes choisies par l'utilisateur parmi
  celles proposées ("2 3 4 type rag au final fais en sorte que l'ia
  lui-même y apporte des modif, en fonction de ce qu'il a appris sur la
  personne 5 7 déjà fait 8 j'ai pas compris") : confirmation inline,
  mémoire IA, lancement au démarrage — plan mode à nouveau vu la
  complexité (multiples approches possibles pour la mémoire, mécanisme de
  pause/reprise mi-boucle pour la confirmation). Recherche avant de
  coder : les outils `file_search`/`retrieval` de Google sont en lecture
  seule côté modèle (pas de mécanisme d'écriture), donc écartés au profit
  d'un outil `function` personnalisé `remember_fact` — confirmé aussi que
  `computer_use` peut être combiné avec un outil `function` personnalisé
  dans le même tableau `tools` (exemple documenté par Google,
  `yield_to_user`). Voir "Confirmation inline, mémoire IA, lancement au
  démarrage" dans Architecture > Control Me pour le détail technique
  complet. `tauri-plugin-autostart` : API exacte (`init(macos_launcher,
  args)`, champ `macos_launcher` de `Builder` gated `#[cfg(target_os =
  "macos")]` mais paramètre de `init` toujours requis) vérifiée dans le
  code source du plugin avant d'écrire l'appel, comme d'habitude dans ce
  projet plutôt que deviné de mémoire. Un premier `npx tauri build
  --config ...` pour le standalone Control Me avait été lancé **avant**
  d'avoir fini le code Rust (interface déjà mise à jour pour appeler des
  commandes qui n'existaient pas encore côté backend) — repéré et stoppé
  avant publication plutôt que de laisser un build cassé sortir. App de
  chat principale publiée et vérifiée via la clé **anon** (fichier : 200
  OK, 6 721 386 octets ; `latest_release_manifest` : renvoie bien la
  v0.5.1). Ligne insérée **sans** le champ `product` (la migration SQL
  n'était toujours pas appliquée à ce moment — vérifié en direct via
  `GET .../app_releases?select=product` avant de publier, colonne
  inexistante confirmée par l'erreur PostgREST `42703`) ; le build
  standalone Control Me suit dans la foulée, sa propre ligne
  `app_releases` (avec `product: "controlme"` cette fois) ne pourra être
  insérée qu'une fois la migration appliquée par l'utilisateur — sans ça,
  son endpoint de mise à jour (`?p_product=controlme`) échouerait proprement
  (fonction `latest_release_manifest` sans paramètre encore déployée), pas
  de risque de servir le mauvais manifeste entre-temps.
- **2026-08-31** — Publication du Control Me standalone découverte
  **risquée après coup** : insérer sa ligne `app_releases` sans le champ
  `product` (comme prévu en fallback si la migration n'était pas encore
  appliquée) aurait rendu cette ligne "la plus récente" pour **tout le
  monde** interrogeant l'endpoint non filtré — y compris l'auto-updater
  de l'app de chat principale elle-même, qui se serait vu proposer
  l'installeur de Control Me à la place du sien. Détecté avant d'exécuter
  l'insertion (pas après), installeur Control Me buildé et uploadé dans
  le Storage mais **ligne `app_releases` volontairement pas insérée** en
  attendant la migration — bien vérifié via la clé anon que l'endpoint
  principal continuait de renvoyer la bonne release entre-temps. Une fois
  la migration appliquée par l'utilisateur, **nouveau bug découvert en
  vérifiant** : `create or replace function` n'avait pas remplacé
  l'ancienne fonction sans paramètre (signature différente = surcharge
  distincte en Postgres, pas un remplacement) — `latest_release_manifest`
  sans argument devenait ambigu entre les deux surcharges (erreur
  PostgREST `PGRST203`), cassant l'auto-update de l'app de chat
  principale pour de vrai cette fois (tout le monde, pas juste un
  risque). Corrigé en ajoutant `drop function if exists
  public.latest_release_manifest();` avant le `create or replace` dans
  `supabase/controlme_product_migration.sql` (fichier ré-exécutable sans
  risque, redocumenté comme tel) ; l'utilisateur a réexécuté le fichier,
  revérifié en direct que les deux endpoints (avec et sans `p_product`)
  fonctionnent indépendamment avant de continuer. **Leçon** : pour toute
  future migration touchant une fonction déjà utilisée par de vrais
  clients (l'auto-updater ici), vérifier explicitement qu'un changement
  de signature ne crée pas une surcharge fantôme au lieu d'un vrai
  remplacement — `create or replace` ne le fait QUE si la liste de
  paramètres est identique.
- **2026-08-31** — Modèle recommandé changé vers `gemini-3.5-flash-lite`
  (demandé explicitement, contredit la propre recommandation de Google
  pour `computer_use` — documenté comme tel dans `CLAUDE.md`/
  `CONTROLME.md`, pas caché). v0.5.2 buildée et publiée pour les deux
  produits (app de chat : ce correctif Supabase + le changement de modèle
  n'affecte que Control Me mais partage le même binaire/version ; Control
  Me : le changement de modèle par défaut). Les deux vérifiées
  indépendamment via la clé anon (`latest_release_manifest` sans
  paramètre et avec `?p_product=controlme`) après publication — app de
  chat : 6 720 977 octets ; Control Me : 6 713 340 octets (uploadé sous
  la clé `control-me_0.5.2_x64-setup.exe`, sans espace, alors que le
  fichier NSIS local en contient un — `productName: "Control Me"` produit
  littéralement `Control Me_0.5.2_x64-setup.exe`).
- **2026-08-31** — v0.5.3 : historique des sessions Control Me, demandé
  explicitement ("les conversations Control Me disparaissent à la
  fermeture ; les sauvegarder comme le fait déjà l'app de chat
  permettrait de les relire"). Voir "Historique des sessions Control Me
  (v0.5.3)" dans Architecture > Control Me pour le détail complet — même
  pattern de persistance que `conversations.rs`, réutilisé trait pour
  trait plutôt que réinventé. App de chat principale publiée et vérifiée
  via la clé anon (fichier : 200 OK, 6 736 893 octets ;
  `latest_release_manifest` sans paramètre : renvoie bien la v0.5.3).
  Control Me standalone publié et vérifié de la même façon (fichier :
  200 OK, 6 731 186 octets sous la clé `control-me_0.5.3_x64-setup.exe` ;
  `latest_release_manifest?p_product=controlme` : renvoie bien la v0.5.3)
  — les deux endpoints confirmés indépendants l'un de l'autre après
  publication des deux, cohérent avec le correctif de la v0.5.2.
- **2026-08-31** — v0.5.4 : trois demandes explicites groupées — recherche
  dans l'historique Control Me (titre + contenu, `search_control_me_sessions`),
  renommage d'une session par double-clic (même pattern que la Sidebar du
  chat), et retrait du bouton "← Chat" dédié dans Codex/Control Me au
  profit d'un simple clic sur la Sidebar (toujours visible) pour revenir
  au chat — voir "Recherche/renommage de session, retrait du bouton retour
  (v0.5.4)" dans Architecture > Control Me pour le détail complet, y
  compris le piège évité (`customTitle` pour empêcher l'effet de
  sauvegarde automatique d'écraser un renommage manuel au message
  suivant). `npx tsc --noEmit` et `cargo check` passés à 0 erreur avant
  publication.
- **2026-08-31** — v0.5.5 : passe d'animations sur toute l'app, demandée
  explicitement ("il faut qu'il y ai des animations, dans l'app, il faut
  que ca soit impressionant en terme d'interface"). CSS uniquement,
  aucune dépendance ajoutée — voir "Animations et micro-interactions
  (v0.5.5)" dans Architecture pour le détail technique complet (système
  d'easing global, `prefers-reduced-motion`, micro-interactions de
  boutons via une seule règle globale, cascade d'entrée des bulles/cartes
  via une custom property `--i`, indicateur de frappe + curseur de
  streaming, transitions de vue/modales/dropdowns/panneaux, accent de
  navigation dans la Sidebar). `npx tsc --noEmit`, `cargo check` et
  `npm run build` passés à 0 erreur. **Pas de vérification visuelle
  possible dans cet environnement** (pas d'accès GUI) — à confirmer par
  l'utilisateur après installation.
- **2026-08-31** — v0.5.6 : Control Me plus rapide et plus fiable, sur
  discussion libre autour d'alternatives aux captures d'écran classiques
  ("plus opti", "en live") ayant abouti à un plan validé en deux parties.
  Voir "Attente adaptative et lecture de l'arbre d'accessibilité (v0.5.6)"
  dans Architecture > Control Me pour le détail technique complet :
  attente adaptative locale (miniatures niveaux de gris, remplace le délai
  fixe de 120ms) et nouvel outil `read_ui_elements` via la crate
  `uiautomation` (API vérifiée dans son vrai code source avant d'écrire
  quoi que ce soit, même discipline qu'enigo/xcap). Bug réel de la crate
  découvert en compilant (import non conditionné malgré la feature
  "input" désactivée) et corrigé en réactivant juste cette feature.
  `cargo check` passé à 0 erreur/avertissement. App de chat principale et
  Control Me standalone publiés et vérifiés indépendamment via la clé
  anon.
- **2026-08-31** — v0.5.7 : Control Me pilotable à distance depuis le
  site, demandé explicitement avec un niveau de détail élevé (jumelage par
  code, écran live, chat, bouton Arrêter, persistance côté navigateur,
  Supabase Realtime) puis complété par une exigence de protection
  anti-brute-force (code à 12 chiffres, ban après 5 tentatives échouées,
  stocké en local) suivie d'une demande d'en proposer d'autres — voir
  "Control Me à distance depuis le site (v0.5.7)" dans Architecture >
  Control Me pour le détail technique complet. Passé par plan mode vu
  l'ampleur (nouvelle brique d'infra temps réel, plusieurs décisions
  d'architecture) avec deux clarifications tranchées via `AskUserQuestion`
  avant de coder : pas de Prisma (ORM Node/TS incompatible avec l'app
  Rust et le site statique) au profit d'appels directs Supabase, et un
  client Realtime Rust écrit à la main (`tokio-tungstenite` + protocole
  Phoenix Channels vérifié contre la doc officielle) plutôt qu'une crate
  communautaire peu éprouvée. Découverte notable pendant la conception :
  aucune table Postgres n'est nécessaire, Broadcast + Presence suffisent
  entièrement (le code de jumelage est directement le nom du salon).
  `cargo check` passé à 0 erreur ni avertissement dès la première
  tentative pour tout le client WebSocket. Réglages entièrement refaits
  en page pleine dans la même passe (demande groupée) — voir "Réglages en
  page pleine (v0.5.7)", bouton "Installer un modèle" déplacé de la
  Sidebar vers Réglages sur demande explicite ultérieure. Mémoire Control
  Me étendue au site distant dans la foulée (discussion libre), avec un
  vrai refactor du mirroring d'événements pour couvrir aussi les sessions
  déclenchées localement, pas seulement à distance — voir "Mémoire
  visible depuis le site distant (v0.5.7)". Deux retours utilisateur
  traités dans la même session : `key_down` qui ne faisait rien (vrai bug
  d'enigo trouvé en lisant son code source — `release_keys_when_dropped`)
  et `read_ui_elements` qui capturait quand même un screenshot inutile
  après coup, annulant son propre gain de vitesse — voir "Correctifs de
  vitesse et de fiabilité (v0.5.7)". Demande de suivi immédiate, dans le
  prolongement direct : un vrai bouton pour basculer entre captures
  d'écran et UI Automation plutôt que les deux qui coexistent seulement
  — nouveau mode `windows_ui` retirant entièrement `computer_use` au
  profit d'outils `function` personnalisés reproduisant le même jeu
  d'actions (mêmes noms de paramètres qu'`execute_action`, aucun
  changement nécessaire côté exécution), avec la contrepartie affichée
  explicitement dans l'UI (perte du garde-fou `require_confirmation`,
  propre au protocole `computer_use`) — voir "Mode de perception Windows
  UI (v0.5.7)". `cargo check`/`npx tsc --noEmit` passés à 0 erreur ni
  avertissement. **Aucune vérification de bout en bout possible dans cet
  environnement** (nécessite l'app lancée ET un navigateur sur le site
  déployé en même temps, et pour ce dernier ajout, aucun moyen de
  confirmer que Gemini se comporte bien sans `computer_use` — combinaison
  jamais documentée par Google) — à tester explicitement par
  l'utilisateur après build et déploiement Vercel du site.
- **2026-09-01** — "DB ready for Control Me", demandé explicitement dans
  le prolongement de la discussion sur les extensions : un dossier local
  caché (`.txt`/`.json`/`.sql` uniquement, validation tout-ou-rien) que
  Control Me lit comme base de connaissances, présenté comme une
  extension nommée/décrite dans une nouvelle section Réglages >
  Extensions, avec un flux de publication publique. Passé par plan mode
  vu l'ampleur et surtout l'implication de sécurité (première écriture
  anon de tout ce projet) — clarifiée via `AskUserQuestion` avant de
  coder : l'utilisateur a choisi explicitement le partage public réel via
  Supabase plutôt qu'un simple interrupteur local ou un partage limité au
  contrôle à distance, en connaissance des implications (n'importe qui
  avec la clé anon peut publier, tout contenu publié est lisible par
  n'importe qui indéfiniment, pas de dépublication possible dans cette
  version — ce projet n'ayant aucun système de comptes). Voir "Base de
  connaissances Control Me (v0.5.7)" dans Architecture pour le détail
  technique complet. `SetFileAttributesW`/`FILE_ATTRIBUTE_HIDDEN` pour
  l'attribut caché Windows — API vérifiée par compilation réelle (feature
  `Win32_Storage_FileSystem` ajoutée à la dépendance `windows` déjà
  présente), a compilé du premier coup. `cargo check`/`npx tsc --noEmit`
  passés à 0 erreur ni avertissement. **Aucune vérification de bout en
  bout possible dans cet environnement** — à tester explicitement par
  l'utilisateur après build et exécution de la migration SQL
  (`supabase/knowledge_base_migration.sql`).
- **2026-09-01** — v0.5.8, publiée quelques heures après la v0.5.7 :
  correctif critique signalé immédiatement par l'utilisateur (l'app ne se
  relançait plus du tout après avoir généré un code de jumelage à
  distance) — `remote.rs` utilisait `tokio::spawn` brut au lieu de
  `tauri::async_runtime::spawn`, ce qui panique quand c'est appelé depuis
  le thread principal (hook `setup()`, au démarrage) faute de runtime
  Tokio "entré" sur ce thread ; un panic sur le thread principal tue tout
  le processus, et comme le code de jumelage reste dans `settings.json`,
  ça se reproduisait à chaque lancement — voir "Panic de démarrage sur le
  thread principal (v0.5.8)" dans Architecture pour le détail complet et
  la procédure de déblocage manuelle donnée à l'utilisateur en attendant
  le correctif (éditer `settings.json`, mettre `remote_code` à `null`).
  Groupées dans la même version, deux demandes explicites supplémentaires
  de l'utilisateur : Extensions restructuré en hub léger (Codex/Control
  Me listés comme cartes avec bouton Ouvrir + interrupteur
  Activer/Désactiver réversible, un seul bouton "Tout mettre à jour" —
  clarifié via `AskUserQuestion`, l'utilisateur a choisi les deux options
  recommandées plutôt que de construire un vrai système de plugins
  indépendants) et un correctif CSS global (plusieurs boutons ajoutés au
  fil des dernières versions n'étaient couverts par aucun sélecteur et
  s'affichaient avec le chrome brut du navigateur) — voir "Extensions :
  hub léger (v0.5.8)" et "Correctif CSS boutons non stylés (v0.5.8)"
  dans Architecture. `cargo check`/`npx tsc --noEmit` passés à 0 erreur.
  **Aucune reproduction ni vérification visuelle possible dans cet
  environnement** pour le bug de crash (root-cause déterminée par lecture
  de code, aucun `settings.json` avec `remote_code` renseigné sur cette
  machine) ni pour le rendu des boutons — à confirmer par l'utilisateur
  après installation.
- **2026-09-01** — v0.6.0, session de nuit autonome : l'utilisateur a
  envoyé une longue liste de demandes groupées ("attention ya des
  failles..." puis un très long message listant une dizaine de
  changements distincts) et est allé se coucher en demandant
  explicitement de poser toute question tout de suite plutôt qu'après —
  aucun point n'a semblé assez ambigu/risqué pour justifier de bloquer
  sur une question (contrairement à d'autres sessions comme le partage
  public de la base de connaissances en v0.5.7), donc travail lancé
  directement avec des décisions de scope documentées au fil de l'eau
  plutôt que devinées en silence, dans l'ordre de priorité : (1) un vrai
  **bug critique signalé en urgence en cours de route** — générer un
  code de jumelage plantait l'app définitivement — traité immédiatement
  hors de l'ordre prévu, publié seul en v0.5.8 (voir son entrée
  ci-dessus) avant de reprendre le reste de la liste ; (2) 404 du site
  distant (routage Vercel) ; (3) vrai bug Ctrl+S dans Codex (closure
  périmée, distinct du correctif WebView2 de la v0.3.4) ; (4) flash de
  console au démarrage (`CREATE_NO_WINDOW` manquant sur les process
  PowerShell spawnés) ; (5) Réglages/Extensions restructurés (Control Me
  sous une icône réglages, "Tout mettre à jour" déplacé, recherche
  ajoutée, popup de mise à jour désactivable) ; (6) refonte complète de
  "DB ready" en "DB skill for Control Me" (skills multiples nommés/
  décrits, sélection avant session, extraction automatique depuis une
  session passée, navigateur de skills publics) ; (7) refonte du contrôle
  à distance en un seul code donnant accès à un chat Ollama **et** à
  Control Me depuis le même onglet du site, mode Windows UI forcé pour
  les sessions distantes avec vérification explicite qu'aucune image
  n'est jamais envoyée dans ce mode ; (8) markdown rendu dans les entrées
  "étape" de Control Me. Voir "Ctrl+S enregistrait du contenu périmé
  (v0.6.0)", "Réglages/Extensions restructurés (v0.6.0)", "DB skill for
  Control Me (v0.6.0)" et "Chat distant unifié avec Control Me (v0.6.0)"
  dans Architecture pour le détail technique complet de chaque point.
  Scope volontairement réduit sur deux points, documenté explicitement
  plutôt que construit à moitié : pas de vrai système générique
  d'espace Sidebar par extension installée (l'espace Skills existant
  suffit et reste bien séparé de l'installation) ; pas de système de
  skills pour Codex (la demande nommait "DB skill for **Control Me**"
  explicitement). `cargo check`/`npx tsc --noEmit` passés à 0 erreur sur
  l'ensemble des changements. **Aucune vérification de bout en bout
  possible dans cet environnement** pour la quasi-totalité de ces points
  (accès GUI, clé API Gemini réelle, et site déployé + app lancée
  simultanément tous absents ici) — à tester explicitement par
  l'utilisateur au réveil, point par point (chaque section Architecture
  liste précisément quoi vérifier).
- **2026-09-01** — v0.6.1 : retour utilisateur juste après le réveil et
  premier vrai test du contrôle à distance ("ya un bug meme si je mets
  le bon code, ca mets comme quoi le code est incorrect") — a mené à la
  découverte que **cette fonctionnalité entière n'avait jamais
  fonctionné depuis son introduction en v0.5.7**, malgré plusieurs
  passes de "vérification" par lecture de documentation à chaque
  version qui l'a touchée depuis. Cette fois, vérification empirique
  réelle : installation d'une vraie instance de `@supabase/supabase-js`
  dans le scratchpad pour servir de référence de comportement, client
  WebSocket brut en Node reproduisant `remote.rs`, les deux tournés
  côte à côte contre le vrai serveur Realtime en sniffant chaque trame.
  Quatre bugs distincts trouvés et corrigés : mauvaise version de
  protocole (`vsn=1.0.0` au lieu de `2.0.0`), payload de join
  incomplet, absence de message de présence "track" explicite après le
  join, et le plus gros — les broadcasts utilisent un format binaire
  propriétaire que ni l'envoi ni la réception ne géraient (tout passait
  en JSON texte, silencieusement ignoré par le serveur). Voir "Le vrai
  bug du contrôle à distance : protocole Realtime jamais fonctionnel
  (v0.6.1)" dans Architecture pour le détail technique complet et la
  méthode de découverte. Vérifié de bout en bout pour de vrai cette
  fois (présence + broadcast dans les deux sens, contre le vrai
  serveur) — pas juste "ça compile". Deux demandes complémentaires
  traitées dans la même passe : "DB skill for Control Me" a gagné son
  propre espace Sidebar (`SkillsView.tsx`, extrait d'`ExtensionsView.tsx`)
  au lieu d'être une carte parmi d'autres — retour utilisateur direct
  sur ce point, même leçon déjà apprise une fois avec "DB ready" ; et
  la sélection de skill(s) avant une session Control Me fonctionne
  maintenant aussi depuis le site (jusque-là local-app-only par
  décision de scope explicite en v0.6.0, révisée ici sur demande).
  `cargo check`/`npx tsc --noEmit` passés à 0 erreur. **Seule la partie
  protocole Realtime a pu être vérifiée empiriquement dans cet
  environnement** (via le harnais Node) — l'espace Skills et le
  panneau de sélection sur le site restent non testés visuellement
  (pas d'accès GUI) — à confirmer par l'utilisateur : jumelage réussi
  avec le bon code, écran/chat/Control Me fonctionnels sur le site,
  sélection de skill(s) visible et effective depuis le site.
- **2026-09-01** — v0.6.2 : lot de retours après le tout premier test réel
  du site distant et de Codex par l'utilisateur. Le plus important :
  **deuxième vrai bug Codex trouvé et corrigé, vérifié contre Ollama
  réellement installé sur cette machine** (`qwen2.5-coder:3b`, tools+
  streaming) plutôt que patché à l'aveugle une troisième fois — le modèle
  écrit l'appel d'outil en JSON brut mal formé dans le texte de sa
  réponse, jamais dans le champ structuré `tool_calls`, et sans le
  moindre bloc markdown — donc aucun des deux correctifs précédents
  (v0.3.3/v0.3.4) ne pouvait l'attraper. Nouveau filet de secours
  JSON, voir "Deuxième bug réel de Codex : tool_calls jamais structuré
  (v0.6.2)" dans Architecture pour le détail complet et la preuve
  empirique. Reste du lot : texte illisible dans le chat du site (noir
  sur noir en mode clair), écran distant à 10 img/s au lieu d'1 (60
  demandé mais expliqué comme irréaliste en bande passante/CPU soutenus),
  bouton Envoyer bleu/rouge partout (au lieu de gris), Windows UI par
  défaut pour Control Me, flash de petite fenêtre au démarrage corrigé
  (fenêtre cachée jusqu'à être prête, avec filet de sécurité anti-
  blocage), Codex légèrement plus "VS Code" (badges de fichiers, barre
  de statut bleue), page d'accueil du site avec une vraie section
  explicative au lieu d'un simple lien, Skills réordonné au-dessus
  d'Extensions. `cargo check`/`npx tsc --noEmit` passés à 0 erreur.
  Publié comme lot séparé, avant d'attaquer la demande suivante de
  l'utilisateur (comptes/profils/marketplace d'extensions avec examen de
  sécurité par IA) — chantier bien plus large, pas mélangé à ces
  correctifs.
- **2026-09-01** — v0.6.3 : premier système de comptes de ce projet
  (Google OAuth via Supabase Auth, configuré par l'utilisateur lui-même
  côté dashboard pendant cette session), demandé en réponse directe à
  `AskUserQuestion` sur la portée du "vrai système de plugins" — choix
  explicite du chemin le plus large plutôt que la version allégée
  proposée en option recommandée. Décision de scope tranchée avant de
  coder, communiquée plutôt que devinée en silence : pas d'exécution de
  code arbitraire dans cette version (aucun bac à sable n'existe dans ce
  projet, un vrai le serait un chantier de plusieurs semaines à lui
  seul) — une extension reste un ajout déclaratif au prompt système,
  revu par Gemini 3.7 avant publication, dans le même esprit que les
  skills déjà en place. Construit : profils (pseudo public unique, photo
  recadrée), appareils multiples (nommables, changeables depuis le
  site), bascule développeur animée, espace développeur (`/dev`) avec
  publication+revue de sécurité, marketplace publique (`/extensions`),
  pont app-side pour installer une extension Control Me comme skill
  local avec double confirmation. Voir "Comptes et marketplace
  d'extensions (v0.6.3)" dans Architecture pour le détail technique
  complet. Deux vrais bugs trouvés et corrigés **avant** publication
  (relecture systématique du SQL/JS écrit, pas juste "ça compile") :
  jointure PostgREST `extensions → profiles` qui aurait échoué faute de
  clé étrangère directe, et policy Storage d'avatar mal alignée avec le
  chemin de fichier utilisé (upload aurait toujours été rejeté).
  `cargo check`/`npx tsc --noEmit` passés à 0 erreur. **Aucune
  vérification de bout en bout possible dans cet environnement** — flux
  OAuth Google, upload Storage, appel de revue Gemini, aucun testable
  sans navigateur — à tester explicitement par l'utilisateur après
  exécution de `supabase/accounts_marketplace_migration.sql`.
- **2026-09-01** — v0.7.0 : refonte du site façon GitHub + installation
  d'extension en un clic, demande la plus détaillée du projet à ce jour
  (compte enrichi avec avatar Google réel/panneau "Notre compte"/bascule
  développeur dans le menu, landing avec compteur temps réel, marketplace
  en grille à deux colonnes, page dédiée par extension avec galerie et
  bouton "Ajouter" qui installe automatiquement via un lien
  `ollamachat://`, documentation extensive avec une bibliothèque de
  fonctions nommées pour décrire des actions Control Me). Voir
  "Marketplace v0.7" dans Architecture pour le détail technique complet
  — mécanisme de deep link (`tauri-plugin-deep-link` +
  `tauri-plugin-single-instance`, la partie la plus risquée, validée en
  premier), nouvelle migration `supabase/marketplace_v2_migration.sql`.
  Un vrai bug trouvé et corrigé en relisant `extension.html` avant de le
  considérer fini (pas après) : le lien "tableau de bord développeur"
  vérifiait `getProfile()` une seule fois, juste après le chargement de
  la page — une vraie course possible entre la vérification de session
  (asynchrone, côté `account.js`) et le chargement de l'extension
  elle-même pouvait laisser ce lien absent pour un propriétaire
  pourtant connecté ; corrigé en s'abonnant à `onProfileChange` pour
  réévaluer dès que l'état de connexion se stabilise, plutôt qu'une
  lecture synchrone unique. **Deuxième vrai piège rencontré, cette
  fois en publiant plutôt qu'en codant** : `source .env && npm run
  tauri build` ne suffit *pas* à propager les variables d'environnement
  de signature aux sous-processus (`cargo`/le bundler) — `source` seul
  ne fait qu'assigner des variables shell, pas les exporter ; sans
  `export` explicite dans `.env` (aucun ici) ou un `set -a` autour du
  `source`, le build réussit quand même (comme documenté) mais publie
  un installeur non signé. Repéré aux DEUX builds de cette version
  (l'app principale d'abord, puis Control Me — même erreur reproduite
  deux fois de suite avant de la corriger pour de bon) : plutôt que de
  relancer un build de 40+ minutes, signature après coup via
  `npx tauri signer sign -k "$TAURI_SIGNING_PRIVATE_KEY" -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" <fichier>`
  (sous-commande CLI dédiée, découverte à cette occasion) — **à
  retenir pour toute future publication** : soit `set -a && source
  .env && set +a` avant le build, soit accepter de re-signer
  séparément après coup plutôt que de re-builder. `npx tsc --noEmit`
  et `cargo check` passés à 0 erreur avant le build (21 min pour
  `cargo check` avec les deux nouveaux plugins, jamais compilés avant
  sur cette machine). App de chat principale publiée et vérifiée via
  la clé **anon** (fichier : 200 OK, 7 019 349 octets ;
  `latest_release_manifest` sans paramètre : renvoie bien la v0.7.0
  avec signature et URL). Control Me standalone publié et vérifié de
  la même façon (fichier : 200 OK, 7 015 266 octets ;
  `latest_release_manifest?p_product=controlme` : renvoie bien la
  v0.7.0) — les deux endpoints reconfirmés indépendants l'un de
  l'autre après les deux publications. **Aucune vérification de bout
  en bout possible dans cet environnement** pour la partie site/deep
  link elle-même (nécessite un vrai clic "Ajouter" depuis un
  navigateur sur le site déployé, avec l'app installée en face) — à
  tester explicitement par l'utilisateur après déploiement Vercel et
  exécution de `supabase/marketplace_v2_migration.sql`.

- **2026-09-06** — v0.9.1 : lot de retours après le premier vrai essai du
  mode vocal. **Cause racine du bug micro trouvée côté Rust, pas côté JS** :
  WebView2 conditionne l'accès au micro à sa propre invite de permission,
  et une fois celle-ci refusée ou simplement ignorée la page ne peut plus
  jamais la redemander — corrigé par un `PermissionRequestedEventHandler`
  scopé au micro uniquement. Deux défauts JS corrigés au passage : le code
  d'erreur de `SpeechRecognition` était jeté (micro bloqué indistinguable
  de « tu n'as rien dit »), et `onerror`+`onend` relançaient l'écoute deux
  fois par échec. Le mode vocal ne devient plus muet : après 3 échecs l'IA
  **dit à voix haute** pourquoi elle n'entend plus et une saisie clavier de
  secours apparaît. Boutons haut-parleur par message retirés. Skills
  gérés depuis Control Me (créer depuis la conversation, enrichir,
  renommer, supprimer). Cinq actions à durée (`hold_key`,
  `press_key_repeat`, `hold_mouse`, `move_relative`, `scroll_at`) dans les
  deux modes de perception. Voir "Micro, skills dans Control Me et actions
  à durée (v0.9.1)" dans Architecture. Deux vrais défauts trouvés en
  relisant **avant** de builder : le mode vocal sautait sa fonction de
  nettoyage sur un chemin (la voix continuait après fermeture), et
  `site/docs.html` documentait `lit_base_connaissances()`, correspondant à
  l'outil `read_knowledge_base` **retiré en v0.6.0** — un auteur
  d'extension qui suivait la doc écrivait une fonction sans le moindre
  effet ; retirée, et les nouvelles actions documentées à la place.
  **Piquet de mémoire notable** : deux `vite build` fantômes de builds
  stoppés occupaient encore 3,3 Go, ne laissant que 0,4 Go libres sur 7,5
  — exactement ce qui faisait planter esbuild sur Monaco ; les tuer a
  suffi à faire passer le build du premier coup (5 min 1 s). **Vérification
  du binaire, méthode à retenir** : chercher un nom d'outil brut dans
  l'`.exe` donne de **faux zéros** — le compilateur inline les
  comparaisons de chaînes de 8 octets ou moins directement dans les
  instructions (`movabs rax, "hold_key"`) et coupe les plus longues, d'où
  `scroll_a` trouvé mais pas `scroll_at`, et `remember_fact` à zéro alors
  qu'il fonctionne depuis des versions ; chercher les **descriptions**
  d'outils (qui vivent en rodata) est la vérification fiable, et elle a
  confirmé les cinq nouvelles actions dans le binaire. `cargo check`/
  `npx tsc --noEmit` à 0 erreur. Publiée et vérifiée via la clé **anon**
  (fichier : 200 OK, 7 055 138 octets ; `latest_release_manifest` : renvoie
  bien la v0.9.1, URL correcte, signature de 432 octets présente dans
  l'objet `platforms["windows-x86_64"]`, là où l'updater la cherche).
  **Control Me standalone non construit ni publié** — l'utilisateur a
  demandé explicitement d'arrêter le produit séparé. **Le micro reste à
  confirmer par l'utilisateur** : aucun accès GUI ici, et si le message
  affiché est « n'a pas pu joindre son service » (code `network`), la
  cause est le service de reconnaissance de Chromium et non la
  permission — il faudra alors un enregistrement local transcrit par
  Gemini, non construit.

- **2026-09-06** — v0.9.2 publiée et vérifiée via la clé **anon** (fichier :
  200 OK, 7 074 419 octets ; `latest_release_manifest` : 0.9.2, URL
  correcte, signature de 432 octets présente dans l'objet
  `platforms["windows-x86_64"]`). Contenu : enregistrement dans un skill
  pendant la conversation, panneau Réglages > Audio, transcription de
  secours par Gemini + liens vers les réglages Windows, et trois
  correctifs Codex mesurés. Control Me standalone toujours non construit
  (produit séparé abandonné sur demande).
  **Deux leçons de procédure de cette session, à réutiliser :**
  (1) *un échantillon ne prouve rien avec un LLM* — un test unique avait
  laissé croire que l'absence de `tool_name` faisait boucler le modèle,
  annoncé comme "le vrai bug décisif" ; le comptage sur 5 exécutions donne
  5/5 des deux côtés. Toujours compter, jamais conclure sur un run.
  (2) *vérifier l'horodatage de l'installeur avant de publier* — un
  installeur d'un build précédent traînait dans `bundle/nsis` avec le bon
  numéro de version ; sans comparer son heure à celle de `dist/`, c'est
  lui qui serait parti en ligne. Même famille de piqure de rappel que la
  signature manquante en v0.7.0.
  **Piquet mémoire récurrent** : des `vite build` fantômes de builds
  stoppés retiennent plusieurs Go et font échouer esbuild sur Monaco ;
  `llama-server` en retient 2 de plus après un test Ollama (le décharger
  proprement via `keep_alive: 0` plutôt que tuer le process).

## Prochaines étapes (dans l'ordre du fichier de passation d'origine)

Voir aussi `NEXT_STEPS_FOR_CLAUDE.md` (note de passation d'une session
précédente sans accès `git push`) pour le détail d'origine.

1. ~~Git + GitHub~~ — fait.
2. ~~CLAUDE.md~~ — ce fichier.
3. ~~Supabase (lecture seule)~~ — branché le 2026-08-30, table `app_releases`
   créée et peuplée.
4. ~~Installeur (premier build)~~ — `npm run tauri build` exécuté le
   2026-08-30, NSIS (`ollama-chat-react_0.1.0_x64-setup.exe`, 5,57 Mo) et MSI
   produits. Le `.exe` NSIS est uploadé dans le bucket public Supabase
   Storage `releases`, `download_url` renseigné dans `app_releases` — lien
   de téléchargement vérifié fonctionnel (200 OK, taille exacte) de bout en
   bout côté app et site.
4bis. ~~Auto-update en continu~~ — `tauri-plugin-updater` branché le
   2026-08-30 (v0.3.0), voir la section dédiée "Auto-update en continu"
   plus haut pour le détail complet (signature, endpoint RPC, `.env`).
5. **Vercel** : connecter `site/` (voir `site/README.md`) — pas encore fait
   côté utilisateur à cette date. `vercel.json` racine déjà en place pour
   éviter que Vercel ne build l'app à la place du site (voir Journal des
   changements).
6. **Signature de code** : pas fait, SmartScreen avertit "Éditeur inconnu"
   au premier lancement (voir Limites connues). Nécessite l'achat d'un
   certificat — décision à prendre par l'utilisateur, pas de blocage
   fonctionnel en attendant.
7. **[FAIT, première version] Control Me** : demandé le 2026-08-30. Plan
   initial (validé via plan mode) décrivait un overlay séparé toujours
   au-dessus invoqué par un raccourci global F5 — voir
   `C:\Users\userAsus\.claude\plans\memoized-jingling-platypus.md` pour ce
   plan d'origine. Ce qui a réellement été construit, sur une demande
   explicite ultérieure plus simple ("qu'on peut la lancer dans l'app, un
   espace Control Me") : une troisième vue dans la fenêtre principale,
   même pattern que Codex — voir la section "Control Me" dans Architecture
   pour le détail technique complet (Interactions API de Google, outil
   `computer_use` intégré, `enigo`/`xcap`, clé API utilisateur, rupture
   documentée de la confidentialité réseau). L'overlay séparé + F5 global
   du plan d'origine reste une extension possible, pas construite. Pas
   encore testé en conditions réelles par l'utilisateur (nécessite sa
   propre clé API Gemini).
   **Idée notée pour plus tard, explicitement mise en pause par
   l'utilisateur ("pas tout de suite")** : un système de mémoire locale
   (JSON, même convention que `settings.json`/les conversations) où l'IA de
   Control Me enregistrerait ce qu'elle apprend sur l'utilisateur au fil des
   sessions (son rôle, ses habitudes, les logiciels qu'il utilise) pour ne
   pas repartir de zéro à chaque fois — ne pas construire sans qu'on te le
   redemande explicitement.

## Ce qu'il faut demander à l'utilisateur avant d'agir

- Toute action irréversible ou visible publiquement (push, création de
  ressources externes, publication du site, rendre le dépôt public) doit être
  confirmée explicitement avant exécution.
