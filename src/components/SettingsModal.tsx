import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { deleteModel } from "../api";
import type { OllamaModel, Settings } from "../types";

function formatBytes(n: number): string {
  if (!n) return "";
  const gb = n / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} Go`;
  const mb = n / 1024 / 1024;
  return `${mb.toFixed(0)} Mo`;
}

export default function SettingsModal({
  settings,
  models,
  onClose,
  onSave,
  onRefreshModels,
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
  onClose: () => void;
  onSave: (settings: Settings) => void;
  onRefreshModels: () => void;
  checkingUpdate: boolean;
  upToDate: boolean;
  updateError: string | null;
  availableUpdate: Update | null;
  installingUpdate: boolean;
  updateInstallPct: number | null;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  const [form, setForm] = useState<Settings>({ ...settings });
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  function handleSave() {
    onSave(form);
    onClose();
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Paramètres</h2>

        <button onClick={onRefreshModels}>Recharger les modèles depuis Ollama</button>

        <label>Adresse du serveur Ollama</label>
        <input
          value={form.ollama_host}
          onChange={(e) => setForm({ ...form, ollama_host: e.target.value })}
        />

        <label>Contexte max (tokens)</label>
        <input
          type="number"
          value={form.max_context_tokens}
          onChange={(e) =>
            setForm({ ...form, max_context_tokens: Number(e.target.value) || 8192 })
          }
        />

        <label>Instructions système</label>
        <textarea
          rows={4}
          value={form.system_prompt}
          onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
        />

        <label>Modèles installés</label>
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

        <label>Mises à jour</label>
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

        <div className="modal-actions">
          <button onClick={onClose}>Annuler</button>
          <button className="primary-btn" onClick={handleSave}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
