import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
}: {
  settings: Settings;
  models: OllamaModel[];
  onClose: () => void;
  onSave: (settings: Settings) => void;
  onRefreshModels: () => void;
}) {
  const [form, setForm] = useState<Settings>({ ...settings });
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [upToDate, setUpToDate] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installPct, setInstallPct] = useState<number | null>(null);
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

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    setUpdateError(null);
    setUpToDate(false);
    setPendingUpdate(null);
    try {
      const update = await check();
      if (update) {
        setPendingUpdate(update);
      } else {
        setUpToDate(true);
      }
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  }

  // Downloads and installs in place, then restarts the app with the new
  // build — no browser, no manually re-running a setup file.
  async function handleInstallUpdate() {
    if (!pendingUpdate) return;
    setInstalling(true);
    setUpdateError(null);
    let downloaded = 0;
    let total: number | undefined;
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setInstallPct(total ? Math.round((downloaded / total) * 100) : null);
        }
      });
      await relaunch();
    } catch (e) {
      setInstalling(false);
      setUpdateError(String(e));
    }
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
        <button onClick={handleCheckUpdate} disabled={checkingUpdate || installing}>
          {checkingUpdate ? "Vérification…" : "Vérifier les mises à jour"}
        </button>
        {updateError && <div className="install-error">{updateError}</div>}
        {upToDate && !updateError && <div className="install-success">À jour.</div>}
        {pendingUpdate && !installing && (
          <div className="update-available">
            <span>Nouvelle version disponible : {pendingUpdate.version}</span>
            {pendingUpdate.body && <p className="modal-hint">{pendingUpdate.body}</p>}
            <button className="primary-btn" onClick={handleInstallUpdate}>
              Installer et redémarrer
            </button>
          </div>
        )}
        {installing && (
          <div className="install-progress">
            <div className="install-progress-bar">
              <div className="install-progress-fill" style={{ width: `${installPct ?? 20}%` }} />
            </div>
            <div className="install-status">
              Téléchargement et installation…{installPct !== null ? ` ${installPct}%` : ""}
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
