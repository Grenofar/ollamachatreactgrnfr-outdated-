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
- [FAIT] Landing page statique dans `site/` (présentation du projet, pas encore de bouton de téléchargement actif)
- [FAIT] Création de fichier inline dans Codex (toolbar + par dossier), génération annulable (chat et Codex) avec bouton animé
- [À FAIRE] Connecter `site/` à Vercel (étape manuelle côté utilisateur, voir `site/README.md`)
- [À FAIRE] Supabase en lecture seule : vérif de version dans l'app + données affichées sur le site (voir Décisions techniques — périmètre revu le 2026-08-30, ni sqlx ni sync conversations/réglages)
- [À FAIRE] Installeur + auto-update (tauri-plugin-updater + GitHub Releases)
- [À FAIRE] Brancher le vrai lien de téléchargement sur le site une fois l'installeur publié (Vercel — décision prise le 2026-08-30, remplace l'idée initiale de GitHub Pages)

## Architecture

### Chat (base)
- `src/api.ts` : appels Tauri (`invoke`) vers les commandes Rust.
- `src-tauri/src/commands/chat.rs` : liste des modèles, envoi de message (streaming), annulation, installation de modèle.
- `src-tauri/src/commands/conversations.rs` : persistance JSON locale des conversations.
- `src-tauri/src/commands/settings.rs` : réglages persistés en JSON local (`Settings` : host Ollama, contexte max, prompt système, modèle par défaut, mode Codex, dernier dossier Codex).
- `src-tauri/src/commands/huggingface.rs` : recherche publique sur le Hub Hugging Face (filtrée GGUF) ; l'installation réutilise `install_model` avec la référence `hf.co/<repo>`.

### Codex (agent de codage local)
- `src/agentTools.ts` : schémas des 6 outils exposés au modèle + `CODEX_SYSTEM_PROMPT`.
- `src/hooks/useAgentLoop.ts` : boucle agentique — appelle le modèle, exécute les tool_calls un par un, rappelle le modèle avec les résultats, jusqu'à une réponse sans tool_calls (plafond `MAX_AGENT_ITERATIONS = 25`, avec une confirmation utilisateur pour continuer au-delà).
- `src-tauri/src/commands/agent.rs` : `agent_chat`, appel à `/api/chat` d'Ollama avec le paramètre `tools` (function calling façon OpenAI), toujours `stream: false` (une seule réponse, pas de tokens au fil de l'eau). Async + annulable via `AgentCancelFlag`/`cancel_agent_chat` (voir Décisions techniques). Ollama n'assigne pas d'id aux tool_calls ; un id positionnel est synthétisé côté Rust uniquement pour corréler les promesses d'approbation côté front, jamais renvoyé à Ollama.
- `src-tauri/src/commands/fsops.rs` : `list_dir` (un niveau, paresseux), `read_file_text` (limite 5 Mo), `write_file_text`, `edit_file_text` (remplacement exact, unique sauf `replace_all`).
- `src-tauri/src/commands/shell.rs` : `run_powershell_command`, streaming live via événements Tauri (`shell-output`/`shell-done`/`shell-error`/`shell-timeout`), timeout 120 s par défaut, annulable via `cancel_shell_command`.
- `src/components/codex/` : `CodexView` (page principale), `FileTree`, `EditorPane` (Monaco), `ToolApprovalModal` (DiffEditor), `AskQuestionModal`, `AgentTranscript`, `HuggingFaceBrowser`.
- `src/monacoSetup.ts` : configuration des web workers Monaco sans CDN.
- `FileTree` : création de fichier inline (bouton toolbar pour la racine, icône "+" au survol d'un dossier). Le nom est saisi *avant* la création (input inline) ; Entrée avec un nom vide, Échap ou perte de focus annule sans rien écrire sur disque.
- `src/components/SendButton.tsx` : bouton d'envoi partagé (chat de base + Codex) — l'icône flèche se transforme en carré (transition opacity/scale/border-radius) pendant que l'IA génère, et le clic devient alors "Arrêter".

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

## Limites connues et risques

- **Accès fichiers non-sandboxé** : l'agent peut lire/écrire n'importe où sur
  le PC de l'utilisateur, pas seulement dans le dossier ouvert. Choix
  explicite de l'utilisateur après avoir été prévenu des risques.
- **Exécution PowerShell autorisée** sans sandbox. Même choix explicite.
- Le mode Approbation est le seul garde-fou : ne l'affaiblis pas (l'assouplir,
  ajouter des exceptions, etc.) sans qu'on te le demande explicitement.
- `agent_chat` est **non-streaming** : un appel modèle avec des outils
  bloque jusqu'à la réponse complète (pas de tokens affichés au fil de l'eau
  pendant le raisonnement de l'agent, contrairement au chat simple).

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
  appel HTTP suffit pour une lecture publique).
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

## Prochaines étapes (dans l'ordre du fichier de passation d'origine)

Voir aussi `NEXT_STEPS_FOR_CLAUDE.md` (note de passation d'une session
précédente sans accès `git push`) pour le détail d'origine.

1. ~~Git + GitHub~~ — fait.
2. ~~CLAUDE.md~~ — ce fichier.
3. **Supabase (lecture seule)** : URL + clé anon du projet Supabase existant
   de l'utilisateur pas encore fournies (demandées le 2026-08-30) — à
   récupérer avant de commencer. Périmètre confirmé : uniquement vérif de
   version dans l'app + données affichées sur le site, aucune donnée ne part
   de l'app vers Supabase. Une fois les identifiants reçus : créer une table
   publique en lecture seule (ex. `app_releases` : version, url de
   téléchargement, notes, date de publication), l'app et `site/` la lisent
   via l'API REST (clé anon, RLS avec policy SELECT uniquement).
4. **Installeur + auto-update** : `tauri-plugin-updater` + GitHub Releases
   comme canal de distribution. Toujours prévoir un chemin de retour en
   arrière (cf. rigueur du pattern snapshot/rollback de l'installeur C# du
   projet sœur OmniDeck, pas forcément transposable tel quel ici).
5. **Site de téléchargement sur Vercel** : page sombre et moderne pointant
   vers le dernier binaire publié en GitHub Release. À clarifier avec
   l'utilisateur : contenu de la page tant qu'aucune release n'existe encore
   (page de présentation du projet en attendant, ou on attend d'avoir un
   binaire avant de publier le site ?).

## Ce qu'il faut demander à l'utilisateur avant d'agir

- URL + clé anon du projet Supabase (périmètre déjà confirmé : lecture seule).
- Contenu du site de téléchargement Vercel tant qu'il n'y a pas encore de
  release publiée.
- Toute action irréversible ou visible publiquement (push, création de
  ressources externes, publication du site) doit être confirmée explicitement
  avant exécution.
