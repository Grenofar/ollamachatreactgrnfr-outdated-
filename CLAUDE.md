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
- [FAIT] Supabase en lecture seule branché ET table `app_releases` créée + peuplée (app : `check_for_update` + Réglages ; site : fetch client-side)
- [FAIT] Premier installeur construit (`npm run tauri build`, NSIS+MSI) et publié : v0.1.0 hébergée sur Supabase Storage (bucket public `releases`), lien de téléchargement fonctionnel de bout en bout
- [À FAIRE] Auto-update en continu (`tauri-plugin-updater`) — pour l'instant la vérification de version est manuelle (bouton dans Réglages), pas de mise à jour silencieuse au démarrage
- [À FAIRE] Signature de code (SmartScreen affiche "Éditeur inconnu" tant que ce n'est pas fait)

## Architecture

### Chat (base)
- `src/api.ts` : appels Tauri (`invoke`) vers les commandes Rust.
- `src-tauri/src/commands/chat.rs` : liste des modèles (nom + taille + parameter_size + quantization_level, pas juste le nom), envoi de message (streaming), annulation, installation de modèle.
- `src-tauri/src/commands/hardware.rs` : `get_system_ram_gb`, RAM totale via une commande PowerShell one-shot (pas de crate `sysinfo` ajoutée pour ça) — volontairement pas de détection GPU/VRAM, peu fiable sous Windows (drivers rapportent souvent des valeurs plafonnées/fausses).
- `src/components/ModelSelect.tsx` : menu déroulant de modèle (recherche, affiche parameter_size/quantization/taille), partagé entre le chat de base et Codex, remplace le `<select>` HTML natif.
- `src-tauri/src/commands/conversations.rs` : persistance JSON locale des conversations.
- `src-tauri/src/commands/settings.rs` : réglages persistés en JSON local (`Settings` : host Ollama, contexte max, prompt système, modèle par défaut, mode Codex, dernier dossier Codex).
- `src-tauri/src/commands/huggingface.rs` : recherche publique sur le Hub Hugging Face (filtrée GGUF, 50 résultats, recherche vide acceptée → tendances par téléchargements) ; l'installation réutilise `install_model` avec la référence `hf.co/<repo>`.
- `src/components/codex/HuggingFaceBrowser.tsx` : modale "Installer un modèle" (bouton Sidebar) — charge les modèles tendance au montage, badge "Adapté à ta RAM"/"Volumineux pour ta RAM" par modèle (règle : paramètres max recommandés ≈ RAM(Go) × 1,75, cohérent avec l'ancien conseil par défaut d'`InstallPanel`), section repliable pour installer une référence exacte. Remplace `InstallPanel.tsx` (supprimé) qui n'offrait que la saisie manuelle.

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
   bout côté app et site. **Reste pour une vraie mise en place d'auto-update
   en continu** : `tauri-plugin-updater` (vérif + install silencieuse au
   démarrage) n'est pas branché — aujourd'hui c'est un check manuel
   (bouton dans Réglages). Toujours prévoir un chemin de retour en arrière
   si tu ajoutes l'auto-update (cf. rigueur du pattern snapshot/rollback de
   l'installeur C# du projet sœur OmniDeck, pas forcément transposable tel
   quel ici).
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
