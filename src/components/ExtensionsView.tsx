import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  getKnowledgeBaseStatus,
  importKnowledgeBase,
  openKnowledgeBaseFolder,
  publishKnowledgeBase,
} from "../api";
import type { KnowledgeBaseStatus, Settings } from "../types";

// Dedicated space for extensions, next to Codex/Control Me/Paramètres in
// the Sidebar — the functional interface for each extension lives here;
// Réglages > Extensions only ever shows the name/description of what's
// installed, never the interactive parts (open folder, publish, import,
// enable/disable, open).
//
// Codex and Control Me are listed as cards here too, alongside their own
// dedicated Sidebar entries (both paths stay available, on request) —
// "désinstaller" here only ever means hiding the Sidebar entry
// (disabled_extensions in Settings), never actually removing code: every
// feature ships compiled into the same single binary, there is no real
// per-feature module system. "Mettre à jour" is the same reasoning taken
// further — there's only one real update (the whole app, one .exe), so
// this view exposes exactly one "Tout mettre à jour" action reusing the
// same updater state as Réglages > Mises à jour, rather than pretending
// each card can be updated independently.
export default function ExtensionsView({
  settings,
  onOpenCodex,
  onOpenControlMe,
  onToggleExtension,
  checkingUpdate,
  availableUpdate,
  installingUpdate,
  updateInstallPct,
  onCheckUpdate,
  onInstallUpdate,
}: {
  settings: Settings;
  onOpenCodex: () => void;
  onOpenControlMe: () => void;
  onToggleExtension: (id: string) => void;
  checkingUpdate: boolean;
  availableUpdate: Update | null;
  installingUpdate: boolean;
  updateInstallPct: number | null;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeBaseStatus | null>(null);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedCode, setPublishedCode] = useState<string | null>(null);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [importCode, setImportCode] = useState("");
  const [importing, setImporting] = useState(false);

  function refreshKnowledgeStatus() {
    getKnowledgeBaseStatus()
      .then(setKnowledgeStatus)
      .catch(() => setKnowledgeStatus(null));
  }

  useEffect(() => {
    refreshKnowledgeStatus();
  }, []);

  async function handleOpenKnowledgeFolder() {
    try {
      await openKnowledgeBaseFolder();
      // Files are added outside the app (Explorer) — refresh shortly after
      // giving the user a moment to drop something in, harmless no-op if
      // they don't.
      window.setTimeout(refreshKnowledgeStatus, 3000);
    } catch (e) {
      setKnowledgeError(String(e));
    }
  }

  async function handlePublishKnowledge() {
    if (
      !window.confirm(
        "Ce contenu sera visible publiquement par n'importe qui, sans limite de durée, et ne peut pas être retiré depuis cette version de l'app — ne publie rien de sensible. Continuer ?",
      )
    ) {
      return;
    }
    setPublishing(true);
    setKnowledgeError(null);
    setPublishedCode(null);
    try {
      const code = await publishKnowledgeBase(knowledgeTitle.trim() || "Base de connaissances");
      setPublishedCode(code);
    } catch (e) {
      setKnowledgeError(String(e));
    } finally {
      setPublishing(false);
    }
  }

  async function handleImportKnowledge() {
    const code = importCode.trim();
    if (!code) return;
    setImporting(true);
    setKnowledgeError(null);
    try {
      await importKnowledgeBase(code);
      setImportCode("");
      refreshKnowledgeStatus();
    } catch (e) {
      setKnowledgeError(String(e));
    } finally {
      setImporting(false);
    }
  }

  const codexEnabled = !settings.disabled_extensions.includes("codex");
  const controlMeEnabled = !settings.disabled_extensions.includes("controlme");
  const knowledgeBaseEnabled = !settings.disabled_extensions.includes("knowledge_base");

  return (
    <div className="extensions-view">
      <div className="extensions-header">
        <span className="extensions-header-title">Extensions</span>
        <div className="extensions-header-spacer" />
        <button onClick={onCheckUpdate} disabled={checkingUpdate || installingUpdate}>
          {checkingUpdate ? "Vérification…" : "Tout mettre à jour"}
        </button>
      </div>

      {(availableUpdate || installingUpdate) && (
        <div className="extensions-update-banner">
          {installingUpdate ? (
            <>
              <div className="install-progress-bar">
                <div className="install-progress-fill" style={{ width: `${updateInstallPct ?? 20}%` }} />
              </div>
              <span>Installation…{updateInstallPct !== null ? ` ${updateInstallPct}%` : ""}</span>
            </>
          ) : (
            availableUpdate && (
              <>
                <span>Nouvelle version disponible : {availableUpdate.version}</span>
                <button className="primary-btn" onClick={onInstallUpdate}>
                  Installer et redémarrer
                </button>
              </>
            )
          )}
        </div>
      )}

      <div className="extensions-content">
        <div className="extension-card">
          <div className="extension-card-header">
            <strong>Codex</strong>
            <span className="modal-hint">
              Éditeur de code façon VS Code où un modèle Ollama agit en agent sur ton PC (lecture/
              écriture de fichiers, commandes PowerShell).
            </span>
          </div>
          <div className="extension-card-actions">
            <button className="primary-btn" onClick={onOpenCodex} disabled={!codexEnabled}>
              Ouvrir
            </button>
            <button onClick={() => onToggleExtension("codex")}>
              {codexEnabled ? "Désactiver" : "Réactiver"}
            </button>
          </div>
          {!codexEnabled && (
            <div className="modal-hint">Masqué de la Sidebar. Rien n'est supprimé, réactivable à tout moment.</div>
          )}
        </div>

        <div className="extension-card">
          <div className="extension-card-header">
            <strong>Control Me</strong>
            <span className="modal-hint">
              Une IA (Gemini) contrôle ta souris et ton clavier à partir de captures d'écran ou de
              l'accessibilité Windows — en local ou à distance depuis le site.
            </span>
          </div>
          <div className="extension-card-actions">
            <button className="primary-btn" onClick={onOpenControlMe} disabled={!controlMeEnabled}>
              Ouvrir
            </button>
            <button onClick={() => onToggleExtension("controlme")}>
              {controlMeEnabled ? "Désactiver" : "Réactiver"}
            </button>
          </div>
          {!controlMeEnabled && (
            <div className="modal-hint">Masqué de la Sidebar. Rien n'est supprimé, réactivable à tout moment.</div>
          )}
        </div>

        <div className="extension-card">
          <div className="extension-card-header">
            <strong>DB ready for Control Me</strong>
            <span className="modal-hint">
              Une base de connaissances locale que tu remplis toi-même (fichiers .txt/.json/.sql dans
              un dossier caché) — Control Me peut la lire pendant une session, en local ou à distance.
              Différent de la mémoire auto-apprise : ici, c'est toi qui décides quoi y mettre.
            </span>
          </div>
          <div className="extension-card-actions">
            <button onClick={() => onToggleExtension("knowledge_base")}>
              {knowledgeBaseEnabled ? "Désactiver" : "Réactiver"}
            </button>
          </div>
          {!knowledgeBaseEnabled && (
            <div className="modal-hint">
              Désactivée : Control Me n'a plus accès à cette base pendant une session (les fichiers restent
              sur le disque).
            </div>
          )}

          {knowledgeStatus && (
            <div className="modal-hint">
              {knowledgeStatus.valid_files.length === 0
                ? "Dossier vide pour l'instant."
                : `${knowledgeStatus.valid_files.length} fichier(s) valide(s) (${knowledgeStatus.valid_files.join(", ")}).`}
              {knowledgeStatus.invalid_files.length > 0 && (
                <div className="install-error">
                  Fichiers non autorisés (seuls .txt/.json/.sql sont acceptés, retire-les pour que
                  l'IA puisse lire le reste) : {knowledgeStatus.invalid_files.join(", ")}
                </div>
              )}
            </div>
          )}

          <button onClick={handleOpenKnowledgeFolder}>Ouvrir le dossier</button>

          <label>Publier en public</label>
          <input
            value={knowledgeTitle}
            onChange={(e) => setKnowledgeTitle(e.target.value)}
            placeholder="Titre (optionnel)"
          />
          <button onClick={handlePublishKnowledge} disabled={publishing}>
            {publishing ? "Publication…" : "Publier en public"}
          </button>
          {publishedCode && (
            <div className="install-success">
              Publié — code à partager : <strong>{publishedCode}</strong>
            </div>
          )}

          <label>Importer via un code</label>
          <div className="modal-actions">
            <input value={importCode} onChange={(e) => setImportCode(e.target.value)} placeholder="Code partagé" />
            <button onClick={handleImportKnowledge} disabled={importing || !importCode.trim()}>
              {importing ? "Import…" : "Importer"}
            </button>
          </div>

          {knowledgeError && <div className="install-error">{knowledgeError}</div>}
        </div>
      </div>
    </div>
  );
}
