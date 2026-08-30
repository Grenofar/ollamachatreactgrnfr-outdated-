import { useEffect, useState } from "react";
import { getSystemRamGb, installModel, onInstallDone, onInstallError, onInstallProgress, searchHfModels } from "../../api";
import type { HfModel } from "../../types";

// Rule of thumb consistent with this app's own prior guidance (the old
// manual-install default was "14B Q4_K_M — bon compromis pour 8 Go") :
// recommended max parameter count (in billions) ≈ RAM(Go) × 1.75, assuming
// a Q4 quantization (~0.55 Go/milliard de paramètres, generously rounded).
const PARAMS_PER_GB = 1.75;

function formatBytes(n: number): string {
  if (!n) return "";
  const gb = n / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} Go`;
  const mb = n / 1024 / 1024;
  return `${mb.toFixed(0)} Mo`;
}

function parseParamsB(id: string): number | null {
  const match = id.match(/(\d+(?:\.\d+)?)\s*[bB](?:illion)?(?:[-_.]|$)/);
  return match ? Number(match[1]) : null;
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HfModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [ramGb, setRamGb] = useState<number | null>(null);

  const [installingRef, setInstallingRef] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualRef, setManualRef] = useState("hf.co/bartowski/Qwen2.5-Coder-14B-Instruct-abliterated-GGUF:Q4_K_M");

  useEffect(() => {
    getSystemRamGb()
      .then(setRamGb)
      .catch(() => setRamGb(null));
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (searching) return;
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

  async function handleInstall(reference: string) {
    if (installingRef) return;
    setInstallingRef(reference);
    setInstallError(null);
    setDone(false);
    setProgress(null);
    setStatus("");
    try {
      await installModel(host, reference);
    } catch (e) {
      setInstallingRef(null);
      setInstallError(String(e));
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : null;
  const maxRecommendedB = ramGb !== null ? ramGb * PARAMS_PER_GB : null;

  const annotated = results
    .map((m) => ({ model: m, paramsB: parseParamsB(m.id) }))
    .sort((a, b) => {
      if (maxRecommendedB === null) return 0;
      const aFits = a.paramsB === null || a.paramsB <= maxRecommendedB;
      const bFits = b.paramsB === null || b.paramsB <= maxRecommendedB;
      return aFits === bFits ? 0 : aFits ? -1 : 1;
    });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Modèles Hugging Face</h2>
        <p className="modal-hint">
          Parcourt les modèles GGUF compatibles Ollama et installe-les en un clic (téléchargement direct
          via <code>hf.co/&lt;repo&gt;</code>).
        </p>

        <div className="hf-ram-hint">
          {ramGb !== null
            ? `Ta config : ${ramGb.toFixed(0)} Go de RAM — modèles jusqu'à ~${Math.round(
                maxRecommendedB ?? 0,
              )} milliards de paramètres recommandés (quantization Q4). Estimation, pas une garantie.`
            : "RAM système non détectée — pas de recommandation possible, tous les modèles sont affichés pareil."}
        </div>

        <div className="hf-search-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Filtrer (ex. qwen2.5-coder, llama-3.1…) — laisser vide pour voir les plus populaires"
          />
          <button className="primary-btn" onClick={handleSearch} disabled={searching}>
            {searching ? "…" : "Rechercher"}
          </button>
        </div>

        {searchError && <div className="install-error">Erreur : {searchError}</div>}

        <div className="hf-results">
          {annotated.map(({ model: m, paramsB }) => {
            const fits = maxRecommendedB === null || paramsB === null || paramsB <= maxRecommendedB;
            return (
              <div key={m.id} className="tool-card">
                <div className="tool-card-name">{m.id}</div>
                <div className="tool-card-body">
                  {m.downloads.toLocaleString()} téléchargements · {m.likes.toLocaleString()} likes
                  {paramsB !== null && maxRecommendedB !== null && (
                    <span className={fits ? "hf-fit-badge hf-fit-ok" : "hf-fit-badge hf-fit-warn"}>
                      {fits ? "Adapté à ta RAM" : "Volumineux pour ta RAM"}
                    </span>
                  )}
                </div>
                <div className="tool-card-footer">
                  <button
                    className="primary-btn"
                    onClick={() => handleInstall(`hf.co/${m.id}`)}
                    disabled={installingRef !== null}
                  >
                    {installingRef === `hf.co/${m.id}` ? "Installation…" : "Installer"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button className="hf-manual-toggle" onClick={() => setManualOpen((o) => !o)}>
          {manualOpen ? "Masquer l'installation manuelle" : "Installer via une référence exacte"}
        </button>
        {manualOpen && (
          <div className="hf-manual">
            <label>Référence du modèle (hf.co/utilisateur/repo:quant)</label>
            <input value={manualRef} onChange={(e) => setManualRef(e.target.value)} spellCheck={false} />
            <button
              className="primary-btn"
              onClick={() => handleInstall(manualRef.trim())}
              disabled={installingRef !== null || !manualRef.trim()}
            >
              Installer cette référence
            </button>
          </div>
        )}

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
