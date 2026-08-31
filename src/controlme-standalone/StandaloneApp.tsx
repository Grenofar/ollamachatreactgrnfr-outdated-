import { useEffect, useState } from "react";
import "../App.css";
import ControlMeView from "../components/controlme/ControlMeView";
import { loadSettings, saveSettings } from "../api";
import type { Settings } from "../types";

export default function StandaloneApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  function handlePersistModel(model: string) {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, gemini_model: model };
      saveSettings(next);
      return next;
    });
  }

  function openKeyInput() {
    setKeyDraft(settings?.gemini_api_key ?? "");
    setShowKeyInput(true);
  }

  function saveApiKey() {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, gemini_api_key: keyDraft.trim() };
      saveSettings(next);
      return next;
    });
    setShowKeyInput(false);
  }

  if (!settings) return null;

  return (
    <div className="standalone-shell">
      <div className="standalone-topbar">
        <span className="standalone-title">Control Me</span>
        <button onClick={openKeyInput}>Clé API Gemini</button>
      </div>
      {showKeyInput && (
        <div className="standalone-key-row">
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="Clé obtenue sur Google AI Studio"
            autoFocus
          />
          <button onClick={() => setShowKeyInput(false)}>Annuler</button>
          <button className="primary-btn" onClick={saveApiKey}>
            Enregistrer
          </button>
        </div>
      )}
      <ControlMeView settings={settings} onPersistModel={handlePersistModel} />
    </div>
  );
}
