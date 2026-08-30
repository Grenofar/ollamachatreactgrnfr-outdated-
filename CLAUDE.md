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

## Architecture

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
- `tauri-plugin-updater` + `tauri-plugin-process` : auto-update en continu, voir la section dédiée "Auto-update en continu" plus bas pour le détail complet (signature, endpoint RPC Supabase). Câblé uniquement dans `SettingsModal.tsx` (`check()`/`downloadAndInstall()`/`relaunch()` de `@tauri-apps/plugin-updater`/`plugin-process`) — pas de vérification silencieuse au démarrage, reste un bouton explicite.
- `src-tauri/src/commands/hardware.rs` : `get_system_ram_gb`, RAM totale via une commande PowerShell one-shot (pas de crate `sysinfo` ajoutée pour ça) — volontairement pas de détection GPU/VRAM, peu fiable sous Windows (drivers rapportent souvent des valeurs plafonnées/fausses).
- `src/components/ModelSelect.tsx` : menu déroulant de modèle (recherche, affiche parameter_size/quantization/taille), partagé entre le chat de base et Codex, remplace le `<select>` HTML natif. Prop `direction` (`"up"` par défaut pour la barre du bas du chat, `"down"` pour l'en-tête de Codex) — sans elle le panneau s'ouvre hors écran quand le déclencheur est en haut de page.
- `src-tauri/src/commands/watchdog.rs` : système anti-gel, voir section dédiée plus bas.
- `src-tauri/src/commands/conversations.rs` : persistance JSON locale des conversations.
- `src-tauri/src/commands/settings.rs` : réglages persistés en JSON local (`Settings` : host Ollama, contexte max, prompt système, modèle par défaut, mode Codex, dernier dossier Codex).
- `src-tauri/src/commands/huggingface.rs` : recherche publique sur le Hub Hugging Face (filtrée GGUF, 50 résultats, recherche vide acceptée → tendances par téléchargements) ; l'installation réutilise `install_model` avec la référence `hf.co/<repo>`.
- `src/components/codex/HuggingFaceBrowser.tsx` : modale "Installer un modèle" (bouton Sidebar) — charge les modèles tendance au montage, badge "Adapté à ta RAM"/"Volumineux pour ta RAM" par modèle (règle : paramètres max recommandés ≈ RAM(Go) × 1,75, cohérent avec l'ancien conseil par défaut d'`InstallPanel`), section repliable pour installer une référence exacte. Remplace `InstallPanel.tsx` (supprimé) qui n'offrait que la saisie manuelle.

### Codex (agent de codage local)
- `src/agentTools.ts` : schémas des 6 outils exposés au modèle + `CODEX_SYSTEM_PROMPT`.
- `src/hooks/useAgentLoop.ts` : boucle agentique — appelle le modèle, exécute les tool_calls un par un, rappelle le modèle avec les résultats, jusqu'à une réponse sans tool_calls (plafond `MAX_AGENT_ITERATIONS = 25`, avec une confirmation utilisateur pour continuer au-delà).
- `src-tauri/src/commands/agent.rs` : `agent_chat`, appel à `/api/chat` d'Ollama avec le paramètre `tools` (function calling façon OpenAI). Envoie `stream: true` à Ollama et lit la réponse chunk par chunk (NDJSON, même format que `send_chat`), mais **le contrat public ne change pas** : la commande ne renvoie qu'une seule fois le `AgentChatResponse` complet (content accumulé + tool_calls) — le streaming interne sert uniquement à donner un signal de progression réel au watchdog anti-gel (voir plus bas), `useAgentLoop.ts` n'a rien eu à changer. Le contenu se concatène chunk par chunk ; pour `tool_calls`, Ollama envoie le tableau complet d'un coup (pas construit incrémentalement token par token), donc c'est "le dernier tableau non-vide vu gagne", pas une fusion. Async + annulable via `AgentCancelFlag`/`cancel_agent_chat` (voir Décisions techniques) — l'annulation est vérifiée à chaque chunk maintenant, pas juste avant le premier octet. Ollama n'assigne pas d'id aux tool_calls ; un id positionnel est synthétisé côté Rust uniquement pour corréler les promesses d'approbation côté front, jamais renvoyé à Ollama.
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
- `agent_chat` streame maintenant en interne côté Rust (voir Architecture >
  Codex et Système anti-gel), mais **le frontend ne montre toujours rien au
  fil de l'eau** pendant le raisonnement de l'agent — `useAgentLoop.ts`
  attend toujours la réponse complète de la promesse `agentChat(...)`, les
  chunks internes ne servent qu'au watchdog anti-gel pour l'instant. Afficher
  la réponse de Codex au fil de l'eau comme le chat simple serait la suite
  logique si demandé (émettre un événement par chunk depuis `agent_chat`,
  l'écouter côté front) mais n'a pas été fait.

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

Aucune autre destination réseau n'existe dans le code (pas de télémétrie, pas
d'analytics, pas d'appel automatique à un service tiers). Si tu ajoutes un
nouvel appel réseau, vérifie qu'il tombe dans un de ces trois cas — sinon,
demande confirmation avant d'envoyer quoi que ce soit qui ressemble à des
données utilisateur (conversations, contenu de fichiers, réglages) vers autre
chose que `ollama_host`.

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
`{SUPABASE_URL}/rest/v1/rpc/latest_release_manifest`, avec la clé anon en
en-têtes (`plugins.updater.headers`).

**Transition ponctuelle** : les installs jusqu'à la v0.2.3 n'ont pas du tout
le plugin updater — elles ne peuvent pas détecter automatiquement la v0.3.0.
Un utilisateur doit récupérer celle-ci manuellement une fois (site ou lien
Supabase Storage direct) ; à partir de là, les mises à jour suivantes se
font vraiment en un clic depuis l'app.

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

## Ce qu'il faut demander à l'utilisateur avant d'agir

- Toute action irréversible ou visible publiquement (push, création de
  ressources externes, publication du site, rendre le dépôt public) doit être
  confirmée explicitement avant exécution.
