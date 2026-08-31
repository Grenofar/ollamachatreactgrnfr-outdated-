import { useEffect, useState } from "react";
import {
  getKnowledgeBaseStatus,
  importKnowledgeBase,
  openKnowledgeBaseFolder,
  publishKnowledgeBase,
} from "../api";
import type { KnowledgeBaseStatus } from "../types";

// Dedicated space for extensions, next to Codex/Control Me/Paramètres in
// the Sidebar — the functional interface for each extension lives here;
// Réglages > Extensions only ever shows the name/description of what's
// installed, never the interactive parts (open folder, publish, import).
export default function ExtensionsView() {
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

  return (
    <div className="extensions-view">
      <div className="extensions-header">
        <span className="extensions-header-title">Extensions</span>
      </div>

      <div className="extensions-content">
        <div className="extension-card">
          <div className="extension-card-header">
            <strong>DB ready for Control Me</strong>
            <span className="modal-hint">
              Une base de connaissances locale que tu remplis toi-même (fichiers .txt/.json/.sql dans
              un dossier caché) — Control Me peut la lire pendant une session, en local ou à distance.
              Différent de la mémoire auto-apprise : ici, c'est toi qui décides quoi y mettre.
            </span>
          </div>

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
