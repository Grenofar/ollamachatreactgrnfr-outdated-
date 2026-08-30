import { useState } from "react";
import { checkForUpdate, openExternalUrl } from "../api";
import type { Settings, UpdateStatus } from "../types";

export default function SettingsModal({
  settings,
  onClose,
  onSave,
  onRefreshModels,
}: {
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
  onRefreshModels: () => void;
}) {
  const [form, setForm] = useState<Settings>({ ...settings });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  function handleSave() {
    onSave(form);
    onClose();
  }

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    try {
      setUpdateStatus(await checkForUpdate());
    } finally {
      setCheckingUpdate(false);
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

        <label>Mises à jour</label>
        <button onClick={handleCheckUpdate} disabled={checkingUpdate}>
          {checkingUpdate ? "Vérification…" : "Vérifier les mises à jour"}
        </button>
        {updateStatus && (
          <div className="update-status">
            <div className="modal-hint">Version installée : {updateStatus.current_version}</div>
            {updateStatus.error && <div className="install-error">{updateStatus.error}</div>}
            {!updateStatus.error && !updateStatus.update_available && (
              <div className="install-success">À jour.</div>
            )}
            {!updateStatus.error && updateStatus.update_available && updateStatus.latest && (
              <div className="update-available">
                <span>Nouvelle version disponible : {updateStatus.latest.version}</span>
                {updateStatus.latest.notes && <p className="modal-hint">{updateStatus.latest.notes}</p>}
                {updateStatus.latest.download_url && (
                  <button
                    className="primary-btn"
                    onClick={() => openExternalUrl(updateStatus.latest!.download_url!)}
                  >
                    Télécharger
                  </button>
                )}
              </div>
            )}
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
