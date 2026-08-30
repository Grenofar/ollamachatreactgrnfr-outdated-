import { useEffect, useRef, useState } from "react";
import {
  installModel,
  onInstallDone,
  onInstallError,
  onInstallProgress,
} from "../api";

const DEFAULT_REFERENCE = "hf.co/bartowski/Qwen2.5-Coder-14B-Instruct-abliterated-GGUF:Q4_K_M";

function formatBytes(n: number): string {
  if (!n) return "";
  const gb = n / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} Go`;
  const mb = n / 1024 / 1024;
  return `${mb.toFixed(0)} Mo`;
}

export default function InstallPanel({
  host,
  onClose,
  onInstalled,
}: {
  host: string;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [reference, setReference] = useState(DEFAULT_REFERENCE);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const unlistenProgress = onInstallProgress((payload) => {
      setStatus(payload.status);
      if (payload.total > 0) {
        setProgress({ completed: payload.completed, total: payload.total });
      }
      setLog((prev) => {
        const last = prev[prev.length - 1];
        if (last === payload.status) return prev;
        return [...prev, payload.status].slice(-30);
      });
    });
    const unlistenDone = onInstallDone(() => {
      setInstalling(false);
      setDone(true);
      onInstalled();
    });
    const unlistenError = onInstallError((message) => {
      setInstalling(false);
      setError(message);
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenDone.then((f) => f());
      unlistenError.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  async function handleInstall() {
    if (!reference.trim() || installing) return;
    setInstalling(true);
    setError(null);
    setDone(false);
    setLog([]);
    setProgress(null);
    try {
      await installModel(host, reference.trim());
    } catch (e) {
      setInstalling(false);
      setError(String(e));
    }
  }

  const pct =
    progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Installer un modèle</h2>
        <p className="modal-hint">
          Récupère un modèle GGUF directement depuis Hugging Face via Ollama. Par défaut :
          Qwen2.5-Coder 14B, version non censurée (abliterated), quantization Q4_K_M — un bon
          compromis pour 8 Go de VRAM.
        </p>

        <label>Référence du modèle (hf.co/utilisateur/repo:quant)</label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          disabled={installing}
          spellCheck={false}
        />

        <button className="primary-btn" onClick={handleInstall} disabled={installing}>
          {installing ? "Installation en cours…" : "Installer"}
        </button>

        {installing && (
          <div className="install-progress">
            <div className="install-progress-bar">
              <div
                className="install-progress-fill"
                style={{ width: pct !== null ? `${pct}%` : "20%" }}
              />
            </div>
            <div className="install-status">
              {status || "Démarrage…"}
              {pct !== null && progress
                ? ` — ${pct}% (${formatBytes(progress.completed)} / ${formatBytes(progress.total)})`
                : ""}
            </div>
          </div>
        )}

        {done && !error && <div className="install-success">Modèle installé avec succès.</div>}
        {error && <div className="install-error">Erreur : {error}</div>}

        {log.length > 0 && (
          <div className="install-log" ref={logRef}>
            {log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
