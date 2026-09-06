import { useEffect, useState } from "react";
import AudioSettings from "./AudioSettings";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { clearRemoteCode, deleteModel, generateRemoteCode } from "../api";
import type { OllamaModel, Settings } from "../types";

// Réglages > Extensions only ever lists name + description (+ a settings
// gear for the ones that have any) — the actual interactive UI (open,
// create, publish...) lives in its own dedicated Sidebar space
// (ExtensionsView.tsx). Codex has nothing configurable at the Settings
// level yet (its Auto/Approbation toggle lives inside CodexView itself),
// so it gets no gear here.
const EXTENSIONS = [
  { id: "codex", name: "Codex", description: "Éditeur de code agentique — agit sur ton PC via un modèle Ollama.", hasSettings: false },
  {
    id: "controlme",
    name: "Control Me",
    description: "Contrôle autonome souris/clavier via Gemini, en local ou à distance.",
    hasSettings: true,
  },
  {
    id: "skills",
    name: "DB skill for Control Me",
    description: "Skills nommés et décrits, gérés depuis leur propre espace Skills (Sidebar).",
    hasSettings: false,
  },
];

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

const SECTIONS = ["general", "models", "audio", "extensions", "devices", "updates"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_LABELS: Record<Section, string> = {
  general: "Général",
  audio: "Audio",
  models: "Modèles installés",
  extensions: "Extensions",
  devices: "Appareils connectés",
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
  const [openGear, setOpenGear] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

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
    if (!window.confirm("Désactiver le jumelage à distance ? Le site ne pourra plus se reconnecter avec ce code.")) {
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

        {section === "audio" && <AudioSettings />}

        {section === "extensions" && (
          <div className="settings-section">
            <h2>Extensions</h2>

            <div className="extensions-update-row">
              <button onClick={onCheckUpdate} disabled={checkingUpdate || installingUpdate}>
                {checkingUpdate ? "Vérification…" : "Tout mettre à jour"}
              </button>
              {availableUpdate && !installingUpdate && (
                <button className="primary-btn" onClick={onInstallUpdate}>
                  Installer {availableUpdate.version}
                </button>
              )}
            </div>
            <div className="modal-hint">
              Une seule vraie mise à jour existe (l'app entière) — ce bouton couvre Codex, Control Me et les
              skills en même temps.
            </div>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={form.update_popup_enabled}
                onChange={(e) => setForm({ ...form, update_popup_enabled: e.target.checked })}
              />
              Afficher une notification quand une mise à jour est disponible
            </label>

            <div className="modal-hint">
              Liste des extensions installées — ouvre l'espace Extensions (Sidebar) pour les utiliser.
            </div>

            {EXTENSIONS.map((ext) => (
              <div key={ext.id} className="extension-card">
                <div className="extension-card-header">
                  <strong>
                    {ext.name}
                    {ext.hasSettings && (
                      <button
                        className="extension-gear"
                        onClick={() => setOpenGear(openGear === ext.id ? null : ext.id)}
                        title="Réglages"
                      >
                        ⚙
                      </button>
                    )}
                  </strong>
                  <span className="modal-hint">{ext.description}</span>
                </div>

                {ext.id === "controlme" && openGear === "controlme" && (
                  <div className="extension-gear-panel">
                    <label>Modèle Gemini</label>
                    <select
                      value={form.gemini_model}
                      onChange={(e) => {
                        setForm({ ...form, gemini_model: e.target.value });
                        onPersistModel(e.target.value);
                      }}
                    >
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
                          Windows (texte, jamais d'image). Plus rapide et plus privé, mais ne fonctionne pas
                          pour une interface dessinée directement (jeu, canvas), et perd le signal de sécurité
                          intégré de Gemini pour les actions sensibles (propre à l'outil de capture d'écran).
                        </>
                      ) : (
                        "Comportement actuel : captures d'écran envoyées à Gemini à chaque étape, comme aujourd'hui."
                      )}
                      {" "}Enregistre pour appliquer.
                    </div>

                    <label>Comment l'IA planifie ses actions</label>
                    <div className="mode-toggle">
                      <button
                        className={form.control_me_action_mode === "live" ? "mode-toggle-active" : ""}
                        onClick={() => setForm({ ...form, control_me_action_mode: "live" })}
                      >
                        En direct
                      </button>
                      <button
                        className={form.control_me_action_mode === "predefined" ? "mode-toggle-active" : ""}
                        onClick={() => setForm({ ...form, control_me_action_mode: "predefined" })}
                      >
                        Prédéfini
                      </button>
                    </div>
                    <div className="modal-hint">
                      {form.control_me_action_mode === "predefined" ? (
                        <>
                          L'IA peut décider plusieurs actions d'un coup (ex. cliquer un champ puis y taper du
                          texte) sans revoir l'écran entre chacune — moins d'allers-retours vers Gemini, donc
                          plus rapide, mais une action peut rater sa cible si l'écran ne réagit pas comme prévu
                          en plein milieu de la séquence.
                        </>
                      ) : (
                        "Comportement actuel : une action à la fois, l'écran est revérifié après chacune — le plus fiable."
                      )}
                      {" "}Enregistre pour appliquer.
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {section === "devices" && (
          <div className="settings-section">
            <h2>Appareils connectés</h2>
            <div className="modal-hint">
              Un seul code contrôle l'accès depuis le site (chat avec le modèle qui tourne sur ce PC, et
              Control Me si activé) — génère-le ici, saisis-le une fois sur le site, il s'y reconnecte
              automatiquement ensuite.
            </div>
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
                Toute personne connaissant ce code peut voir ton écran, discuter avec le modèle qui tourne
                sur ce PC et contrôler ton PC (si Control Me est activé) depuis le site — traite-le comme un
                mot de passe.
              </div>
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
