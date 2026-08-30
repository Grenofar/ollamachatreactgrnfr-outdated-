import { useState } from "react";
import type { Settings } from "../types";

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

  function handleSave() {
    onSave(form);
    onClose();
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
