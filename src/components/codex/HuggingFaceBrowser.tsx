import { useEffect, useState } from "react";
import { installModel, onInstallDone, onInstallError, onInstallProgress, searchHfModels } from "../../api";
import type { HfModel } from "../../types";

function formatBytes(n: number): string {
  if (!n) return "";
  const gb = n / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} Go`;
  const mb = n / 1024 / 1024;
  return `${mb.toFixed(0)} Mo`;
}

export default function HuggingFaceBrowser({
  host,
  onClose,
  onInstalled,
}: {
  host: string;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [query, setQuery] = useState("qwen2.5-coder");
  const [results, setResults] = useState<HfModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [installingRef, setInstallingRef] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const unlistenProgress = onInstallProgress((payload) => {
      setStatus(payload.status);
      if (payload.total > 0) setProgress({ completed: payload.completed, total: payload.total });
    });
    const unlistenDone = onInstallDone(() => {
      setInstallingRef(null);
      setDone(true);
      onInstalled();
    });
    const unlistenError = onInstallError((message) => {
      setInstallingRef(null);
      setInstallError(message);
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenDone.then((f) => f());
      unlistenError.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSearch() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await searchHfModels(query.trim()));
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }

  async function handleInstall(id: string) {
    if (installingRef) return;
    setInstallingRef(id);
    setInstallError(null);
    setDone(false);
    setProgress(null);
    setStatus("");
    try {
      await installModel(host, `hf.co/${id}`);
    } catch (e) {
      setInstallingRef(null);
      setInstallError(String(e));
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Modèles Hugging Face</h2>
        <p className="modal-hint">
          Recherche des modèles GGUF compatibles Ollama et installe-les en un clic (téléchargement direct
          via <code>hf.co/&lt;repo&gt;</code>).
        </p>

        <div className="hf-search-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="ex. qwen2.5-coder, llama-3.1..."
          />
          <button className="primary-btn" onClick={handleSearch} disabled={searching}>
            {searching ? "…" : "Rechercher"}
          </button>
        </div>

        {searchError && <div className="install-error">Erreur : {searchError}</div>}

        <div className="hf-results">
          {results.map((m) => (
            <div key={m.id} className="tool-card">
              <div className="tool-card-name">{m.id}</div>
              <div className="tool-card-body">
                ⬇ {m.downloads.toLocaleString()} · ♥ {m.likes.toLocaleString()}
              </div>
              <div className="tool-card-footer">
                <button className="primary-btn" onClick={() => handleInstall(m.id)} disabled={installingRef !== null}>
                  {installingRef === m.id ? "Installation…" : "Installer"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {installingRef && (
          <div className="install-progress">
            <div className="install-progress-bar">
              <div className="install-progress-fill" style={{ width: pct !== null ? `${pct}%` : "20%" }} />
            </div>
            <div className="install-status">
              {status || "Démarrage…"}
              {pct !== null && progress
                ? ` — ${pct}% (${formatBytes(progress.completed)} / ${formatBytes(progress.total)})`
                : ""}
            </div>
          </div>
        )}
        {done && !installError && <div className="install-success">Modèle installé avec succès.</div>}
        {installError && <div className="install-error">Erreur : {installError}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
