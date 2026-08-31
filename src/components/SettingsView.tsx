import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  clearRemoteCode,
  deleteModel,
  generateRemoteCode,
  getKnowledgeBaseStatus,
  importKnowledgeBase,
  openKnowledgeBaseFolder,
  publishKnowledgeBase,
} from "../api";
import type { KnowledgeBaseStatus, OllamaModel, Settings } from "../types";

// gemini-3.6-flash isn't in Google's documented list of computer_use-compatible
// models — kept selectable since it was explicitly requested elsewhere in
// this app (ControlMeView), same list duplicated here for the same reason:
// a single source of truth (settings.gemini_model) with two edit points.
const GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (recommandé)" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (compatibilité non confirmée)" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
];

const SECTIONS = ["general", "models", "controlme", "extensions", "updates"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_LABELS: Record<Section, string> = {
  general: "Général",
  models: "Modèles installés",
  controlme: "Control Me",
  extensions: "Extensions",
  updates: "Mises à jour",
};

function formatBytes(n: number): string {
  if (!n) return "";
  const gb = n / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} Go`;
  const mb = n / 1024 / 1024;
  return `${mb.toFixed(0)} Mo`;
}

export default function SettingsView({
  settings,
  models,
  remoteConnected,
  onSave,
  onRefreshModels,
  onOpenInstall,
  onPersistModel,
  onRemoteCodeChanged,
  checkingUpdate,
  upToDate,
  updateError,
  availableUpdate,
  installingUpdate,
  updateInstallPct,
  onCheckUpdate,
  onInstallUpdate,
}: {
  settings: Settings;
  models: OllamaModel[];
  remoteConnected: boolean;
  onSave: (settings: Settings) => void;
  onRefreshModels: () => void;
  onOpenInstall: () => void;
  onPersistModel: (model: string) => void;
  onRemoteCodeChanged: (code: string | null) => void;
  checkingUpdate: boolean;
  upToDate: boolean;
  updateError: string | null;
  availableUpdate: Update | null;
  installingUpdate: boolean;
  updateInstallPct: number | null;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  const [section, setSection] = useState<Section>("general");
  const [form, setForm] = useState<Settings>({ ...settings });
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeBaseStatus | null>(null);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedCode, setPublishedCode] = useState<string | null>(null);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [importCode, setImportCode] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  function refreshKnowledgeStatus() {
    getKnowledgeBaseStatus()
      .then(setKnowledgeStatus)
      .catch(() => setKnowledgeStatus(null));
  }

  useEffect(() => {
    if (section === "extensions") refreshKnowledgeStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  function handleSave() {
    onSave(form);
  }

  async function handleDeleteModel(name: string) {
    if (!window.confirm(`Supprimer définitivement le modèle ${name} ?`)) return;
    setDeletingModel(name);
    try {
      await deleteModel(form.ollama_host, name);
      onRefreshModels();
    } catch (e) {
      window.alert(`Impossible de supprimer ${name} : ${String(e)}`);
    } finally {
      setDeletingModel(null);
    }
  }

  async function handleGenerateCode() {
    setGeneratingCode(true);
    setRemoteError(null);
    try {
      const code = await generateRemoteCode();
      onRemoteCodeChanged(code);
    } catch (e) {
      setRemoteError(String(e));
    } finally {
      setGeneratingCode(false);
    }
  }

  async function handleClearCode() {
    if (!window.confirm("Désactiver le contrôle à distance ? Le site ne pourra plus se reconnecter avec ce code.")) {
      return;
    }
    setGeneratingCode(true);
    setRemoteError(null);
    try {
      await clearRemoteCode();
      onRemoteCodeChanged(null);
    } catch (e) {
      setRemoteError(String(e));
    } finally {
      setGeneratingCode(false);
    }
  }

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
    <div className="settings-view">
      <div className="settings-nav">
        <div className="settings-nav-title">Paramètres</div>
        {SECTIONS.map((s) => (
          <button
            key={s}
            className={`settings-nav-item ${section === s ? "settings-nav-item-active" : ""}`}
            onClick={() => setSection(s)}
          >
            {SECTION_LABELS[s]}
          </button>
        ))}
        <div className="settings-nav-spacer" />
        <button className="primary-btn settings-nav-save" onClick={handleSave}>
          Enregistrer
        </button>
      </div>

      <div className="settings-content">
        {section === "general" && (
          <div className="settings-section">
            <h2>Général</h2>

            <label>Adresse du serveur Ollama</label>
            <input
              value={form.ollama_host}
              onChange={(e) => setForm({ ...form, ollama_host: e.target.value })}
            />
            <button onClick={onRefreshModels}>Recharger les modèles depuis Ollama</button>

            <label>Contexte max (tokens)</label>
            <input
              type="number"
              value={form.max_context_tokens}
              onChange={(e) => setForm({ ...form, max_context_tokens: Number(e.target.value) || 8192 })}
            />

            <label>Instructions système</label>
            <textarea
              rows={4}
              value={form.system_prompt}
              onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
            />
          </div>
        )}

        {section === "models" && (
          <div className="settings-section">
            <h2>Modèles installés</h2>
            <button className="primary-btn" onClick={onOpenInstall}>
              Installer un modèle
            </button>
            {models.length === 0 ? (
              <div className="modal-hint">Aucun modèle installé.</div>
            ) : (
              <div className="installed-models">
                {models.map((m) => (
                  <div key={m.name} className="installed-model-row">
                    <span className="installed-model-name">{m.name}</span>
                    <span className="installed-model-size">{formatBytes(m.size)}</span>
                    <button
                      className="installed-model-delete"
                      onClick={() => handleDeleteModel(m.name)}
                      disabled={deletingModel !== null}
                    >
                      {deletingModel === m.name ? "Suppression…" : "Supprimer"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {section === "controlme" && (
          <div className="settings-section">
            <h2>Control Me</h2>

            <label>Modèle Gemini</label>
            <select value={form.gemini_model} onChange={(e) => { setForm({ ...form, gemini_model: e.target.value }); onPersistModel(e.target.value); }}>
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>

            <label>Clé API Gemini</label>
            <input
              type="password"
              value={form.gemini_api_key ?? ""}
              onChange={(e) => setForm({ ...form, gemini_api_key: e.target.value })}
              placeholder="Clé obtenue sur Google AI Studio"
            />
            <div className="modal-hint">
              Ta propre clé, jamais fournie par l'app — nécessaire pour utiliser Control Me.
            </div>

            <label>Comment l'IA perçoit ton écran</label>
            <div className="mode-toggle">
              <button
                className={form.control_me_perception_mode === "capture" ? "mode-toggle-active" : ""}
                onClick={() => setForm({ ...form, control_me_perception_mode: "capture" })}
              >
                Capture d'écran
              </button>
              <button
                className={form.control_me_perception_mode === "windows_ui" ? "mode-toggle-active" : ""}
                onClick={() => setForm({ ...form, control_me_perception_mode: "windows_ui" })}
              >
                Windows UI
              </button>
            </div>
            <div className="modal-hint">
              {form.control_me_perception_mode === "windows_ui" ? (
                <>
                  Aucune capture d'écran envoyée — l'IA lit uniquement la structure d'accessibilité
                  Windows (texte). Plus rapide et plus privé, mais ne fonctionne pas pour une
                  interface dessinée directement (jeu, canvas), et perd le signal de sécurité
                  intégré de Gemini pour les actions sensibles (propre à l'outil de capture
                  d'écran).
                </>
              ) : (
                "Comportement actuel : captures d'écran envoyées à Gemini à chaque étape, comme aujourd'hui."
              )}
              {" "}Enregistre pour appliquer.
            </div>

            <label>Contrôle à distance depuis le site</label>
            <div className="remote-pairing">
              {settings.remote_code ? (
                <>
                  <div className="remote-pairing-code">{settings.remote_code}</div>
                  <div className={`remote-pairing-status ${remoteConnected ? "remote-pairing-connected" : ""}`}>
                    {remoteConnected ? "Connecté" : "En attente de connexion…"}
                  </div>
                  <div className="modal-actions">
                    <button onClick={handleGenerateCode} disabled={generatingCode}>
                      Régénérer
                    </button>
                    <button onClick={handleClearCode} disabled={generatingCode}>
                      Désactiver
                    </button>
                  </div>
                </>
              ) : (
                <button className="primary-btn" onClick={handleGenerateCode} disabled={generatingCode}>
                  {generatingCode ? "Génération…" : "Générer un code"}
                </button>
              )}
              {remoteError && <div className="install-error">{remoteError}</div>}
              <div className="modal-hint">
                Toute personne connaissant ce code peut voir ton écran et contrôler ton PC depuis le site
                — traite-le comme un mot de passe. Saisi une fois sur le site, il s'y reconnecte
                automatiquement ensuite.
              </div>
            </div>
          </div>
        )}

        {section === "extensions" && (
          <div className="settings-section">
            <h2>Extensions</h2>

            <div className="extension-card">
              <div className="extension-card-header">
                <strong>DB ready for Control Me</strong>
                <span className="modal-hint">
                  Une base de connaissances locale que tu remplis toi-même (fichiers .txt/.json/.sql
                  dans un dossier caché) — Control Me peut la lire pendant une session, en local ou à
                  distance. Différent de la mémoire auto-apprise : ici, c'est toi qui décides quoi y
                  mettre.
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
        )}

        {section === "updates" && (
          <div className="settings-section">
            <h2>Mises à jour</h2>
            <div className="modal-hint">Version installée : {appVersion ?? "…"}</div>
            <button onClick={onCheckUpdate} disabled={checkingUpdate || installingUpdate}>
              {checkingUpdate ? "Vérification…" : "Vérifier les mises à jour"}
            </button>
            {updateError && <div className="install-error">{updateError}</div>}
            {upToDate && !updateError && <div className="install-success">À jour.</div>}
            {availableUpdate && !installingUpdate && (
              <div className="update-available">
                <span>Nouvelle version disponible : {availableUpdate.version}</span>
                {availableUpdate.body && <p className="modal-hint">{availableUpdate.body}</p>}
                <button className="primary-btn" onClick={onInstallUpdate}>
                  Installer et redémarrer
                </button>
              </div>
            )}
            {installingUpdate && (
              <div className="install-progress">
                <div className="install-progress-bar">
                  <div className="install-progress-fill" style={{ width: `${updateInstallPct ?? 20}%` }} />
                </div>
                <div className="install-status">
                  Téléchargement et installation…{updateInstallPct !== null ? ` ${updateInstallPct}%` : ""}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
