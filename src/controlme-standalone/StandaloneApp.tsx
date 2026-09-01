import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import "../App.css";
import ControlMeView from "../components/controlme/ControlMeView";
import { loadSettings, saveSettings } from "../api";
import type { Settings } from "../types";

export default function StandaloneApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    // Same reasoning as App.tsx (including the load-bearing `finally`,
    // not decorative — see its comment for why): the window starts hidden
    // (tauri.controlme.conf.json's visible: false) so it only ever
    // appears once already correctly sized and rendered.
    (async () => {
      try {
        setSettings(await loadSettings());
      } finally {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().show();
      }
    })();
    isEnabled()
      .then(setAutostart)
      .catch(() => {});
  }, []);

  async function toggleAutostart() {
    try {
      if (autostart) {
        await disable();
      } else {
        await enable();
      }
      setAutostart(await isEnabled());
    } catch {
      // best-effort — leave the checkbox reflecting the last known state
    }
  }

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
        <label className="standalone-autostart">
          <input type="checkbox" checked={autostart} onChange={toggleAutostart} />
          Lancer au démarrage de Windows
        </label>
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
