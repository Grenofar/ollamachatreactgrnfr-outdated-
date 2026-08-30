# Prompt de passation — à coller dans une nouvelle session Claude Code

Colle ce fichier entier comme premier message d'une session Claude Code **ouverte directement dans ce dossier** (`ollama-chat-react`). Cette session-ci n'a pas accès à `gh`/push depuis son propre environnement (choix explicite de l'utilisateur), d'où cette passation.

## Où en est le projet

`ollama-chat-react` est une app **Tauri v2 + React 19 + TypeScript** : un client de chat pour Ollama (local) qui vient d'être étendu avec une fonctionnalité **"Codex"** — un éditeur de code façon VS Code où un modèle Ollama peut agir en agent (façon Claude Code) : lire/lister/écrire/modifier des fichiers **n'importe où sur le PC** de l'utilisateur (choix explicite, pas de sandbox), exécuter des commandes PowerShell, et poser des questions à l'utilisateur via un outil dédié — avec un bascule **Auto / Approbation** (comme le mode d'édition de Claude Code) qui contrôle si les actions mutantes (écriture fichier, édition, commande) s'exécutent directement ou après validation humaine via un diff Monaco.

**`npm run build` (tsc + vite) et `cargo check` passent tous les deux à 0 erreur** au moment de cette passation. Un `npm run tauri dev` a été lancé pour un smoke test de démarrage.

### Fichiers clés ajoutés/modifiés pour Codex

- `src-tauri/src/commands/` — `lib.rs` a été éclaté en modules (`chat.rs`, `conversations.rs`, `settings.rs`, `fsops.rs`, `shell.rs`, `agent.rs`, `huggingface.rs`).
- `fsops.rs` : `list_dir` (un niveau, paresseux), `read_file_text` (limite 5 Mo), `write_file_text`, `edit_file_text` (remplacement exact, unique sauf `replace_all`).
- `shell.rs` : `run_powershell_command` (streaming live via events `shell-output`/`shell-done`/`shell-error`/`shell-timeout`, timeout 120s par défaut, annulable).
- `agent.rs` : `agent_chat` — appel **non-streaming** à `/api/chat` d'Ollama avec le paramètre `tools` (function calling façon OpenAI). Retourne `{ content, tool_calls }`.
- `huggingface.rs` : `search_hf_models` (recherche publique Hugging Face Hub, filtrée GGUF) ; l'installation réutilise `install_model` existant avec la référence `hf.co/<repo>`.
- `src/agentTools.ts` : schémas des 6 outils (`read_file`, `list_dir`, `write_file`, `edit_file`, `run_powershell_command`, `ask_user_question`) + prompt système `CODEX_SYSTEM_PROMPT`.
- `src/hooks/useAgentLoop.ts` : boucle agentique (appel modèle → dispatch outils → re-appel jusqu'à réponse sans tool_calls, cap 25 itérations).
- `src/components/codex/` : `CodexView` (page principale), `FileTree`, `EditorPane` (Monaco), `ToolApprovalModal` (DiffEditor), `AskQuestionModal`, `AgentTranscript`, `HuggingFaceBrowser`.
- `src/monacoSetup.ts` : config des web workers Monaco **sans CDN** — attention si tu changes la version de `monaco-editor`, sa map `exports` dans `package.json` dicte le chemin d'import correct (vérifié empiriquement pour la 0.56.0 : `monaco-editor/editor/editor.worker`, PAS `monaco-editor/esm/vs/editor/editor.worker`).
- `Settings` (Rust ET TypeScript) a deux nouveaux champs : `codex_mode` (`"auto"|"approve"`, défaut `"approve"`) et `codex_last_folder`.
- `tauri.conf.json` : fenêtre passée de fixe 800×600 à redimensionnable 1280×800 (min 900×560).
- `capabilities/default.json` : ajout de `dialog:default` (pour le sélecteur de dossier natif).

### Risque à garder en tête

L'accès fichiers est **volontairement non-sandboxé** (tout le PC) et l'exécution de commandes PowerShell est **volontairement autorisée** — ce sont des choix explicites de l'utilisateur après avoir été prévenu des risques. Le mode Approbation (diff avant écriture, confirmation avant commande) est le seul filet de sécurité ; ne l'affaiblis pas sans qu'on te le demande explicitement.

## Ce qu'il reste à faire (dans cet ordre)

### 1. Git + GitHub
Initialise git si pas déjà fait, crée le dépôt GitHub **`ollamachatreactgrnfr`** (demande à l'utilisateur si le dépôt doit être public ou privé, et sous quel compte/org s'il y a un doute), pousse le code. Le `.gitignore` racine existe déjà et couvre `node_modules`/`dist`/etc. ; vérifie que `src-tauri/target` est bien ignoré aussi (via `src-tauri/.gitignore`) avant de committer quoi que ce soit.

### 2. CLAUDE.md vivant pour ce projet
Rédige un `CLAUDE.md` à la racine, dans le même esprit que celui du projet sœur **OmniDeck** de l'utilisateur (feuille de route vivante, checklist ✅/🚧/⛔, journal des changements daté, section décisions techniques avec le *pourquoi*). Documente l'architecture actuelle (chat + Codex), les 6 outils de l'agent, le bascule Auto/Approbation, et les limites connues (accès PC libre, PowerShell autorisé).

### 3. Supabase + sqlx (PAS Prisma)
L'utilisateur a un projet Supabase existant mais n'a pas encore donné l'URL/clé — demande-les-lui avant de commencer. **Ne pas utiliser Prisma** : c'est un ORM Node.js, or le backend ici est Rust (même raisonnement que documenté dans le `CLAUDE.md` du projet OmniDeck de l'utilisateur, qui a écarté Prisma pour la même raison). Utilise **sqlx** (requêtes paramétrées, protection injection SQL par construction) directement contre le Postgres Supabase. Périmètre suggéré par défaut (à confirmer avec l'utilisateur) : synchroniser les conversations et les réglages, en gardant le JSON local existant comme cache/fallback hors-ligne plutôt que de le supprimer.

### 4. Installeur + auto-update
Construis un installeur/setup (qui installe les prérequis puis l'app) avec mise à jour automatique au démarrage. Base-toi sur `tauri-plugin-updater` (officiel Tauri) + GitHub Releases comme canal de distribution. Le projet sœur OmniDeck de l'utilisateur a déjà un installeur C# (`installer/`) avec un pattern de snapshot/rollback avant modification système — pas forcément transposable tel quel ici (app utilisateur classique, pas un remplacement de shell Windows), mais utile comme référence de rigueur (toujours prévoir un chemin de retour en arrière).

### 5. Site de téléchargement
Page sombre et moderne, hébergée sur **GitHub Pages** (le plus simple une fois le dépôt GitHub en place), qui pointe vers le dernier binaire publié en GitHub Release.

## Ce que tu dois demander à l'utilisateur avant d'agir

- Visibilité du dépôt GitHub (public/privé) et compte/org cible si ambigu.
- URL + clé du projet Supabase existant, et confirmation du périmètre de sync (conversations + réglages par défaut, proposé ci-dessus).
- Toute action irréversible ou visible publiquement (premier push, création du dépôt, publication du site) doit être confirmée explicitement avant exécution, comme pour n'importe quelle action de cette nature.
