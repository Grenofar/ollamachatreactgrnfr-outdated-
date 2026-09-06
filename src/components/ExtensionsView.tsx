import { useState } from "react";
import Marketplace from "./Marketplace";
import type { Settings } from "../types";

// Dedicated space for extensions, next to Codex/Control Me/Skills/
// Paramètres in the Sidebar — the functional interface for each extension
// lives here; Réglages > Extensions only ever shows the name/description
// of what's installed plus a settings shortcut, never the interactive
// parts (this file). "Tout mettre à jour" lives in Réglages > Extensions,
// not here — see SettingsView.tsx.
//
// Skills used to live here too as a third card, but got their own
// dedicated space (SkillsView.tsx) instead — a card buried among the
// Codex/Control Me toggle cards made the actual skill-creation UI hard to
// find, same lesson the "DB ready" predecessor already taught once.
//
// "Désinstaller" only ever means hiding the Sidebar entry
// (disabled_extensions in Settings), never actually removing code: every
// feature ships compiled into the same single binary, there is no real
// per-feature module system.
export default function ExtensionsView({
  settings,
  onOpenCodex,
  onOpenControlMe,
  onToggleExtension,
}: {
  settings: Settings;
  onOpenCodex: () => void;
  onOpenControlMe: () => void;
  onToggleExtension: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"installed" | "market">("installed");

  const query = search.trim().toLowerCase();
  const matches = (name: string, description: string) =>
    !query || name.toLowerCase().includes(query) || description.toLowerCase().includes(query);

  const codexEnabled = !settings.disabled_extensions.includes("codex");
  const controlMeEnabled = !settings.disabled_extensions.includes("controlme");
  const showCodexCard = matches(
    "Codex",
    "Éditeur de code façon VS Code où un modèle Ollama agit en agent sur ton PC",
  );
  const showControlMeCard = matches(
    "Control Me",
    "Une IA contrôle ta souris et ton clavier à partir de captures d'écran ou de l'accessibilité Windows",
  );

  return (
    <div className="extensions-view">
      <div className="extensions-header">
        <span className="extensions-header-title">Extensions</span>
        <div className="mode-toggle">
          <button className={tab === "installed" ? "mode-toggle-active" : ""} onClick={() => setTab("installed")}>
            Installées
          </button>
          <button className={tab === "market" ? "mode-toggle-active" : ""} onClick={() => setTab("market")}>
            Marketplace
          </button>
        </div>
        <div className="extensions-header-spacer" />
        {tab === "installed" && (
          <input
            className="extensions-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une extension…"
          />
        )}
      </div>

      {tab === "market" && <Marketplace />}

      <div className="extensions-content" hidden={tab !== "installed"}>
        {showCodexCard && (
          <div className="extension-card">
            <div className="extension-card-header">
              <strong>Codex</strong>
              <span className="modal-hint">
                Éditeur de code façon VS Code où un modèle Ollama agit en agent sur ton PC (lecture/
                écriture de fichiers, commandes PowerShell).
              </span>
            </div>
            <div className="extension-card-actions">
              <button className="primary-btn" onClick={onOpenCodex} disabled={!codexEnabled}>
                Ouvrir
              </button>
              <button onClick={() => onToggleExtension("codex")}>{codexEnabled ? "Désactiver" : "Réactiver"}</button>
            </div>
            {!codexEnabled && (
              <div className="modal-hint">Masqué de la Sidebar. Rien n'est supprimé, réactivable à tout moment.</div>
            )}
          </div>
        )}

        {showControlMeCard && (
          <div className="extension-card">
            <div className="extension-card-header">
              <strong>Control Me</strong>
              <span className="modal-hint">
                Une IA (Gemini) contrôle ta souris et ton clavier à partir de captures d'écran ou de
                l'accessibilité Windows — en local ou à distance depuis le site.
              </span>
            </div>
            <div className="extension-card-actions">
              <button className="primary-btn" onClick={onOpenControlMe} disabled={!controlMeEnabled}>
                Ouvrir
              </button>
              <button onClick={() => onToggleExtension("controlme")}>
                {controlMeEnabled ? "Désactiver" : "Réactiver"}
              </button>
            </div>
            {!controlMeEnabled && (
              <div className="modal-hint">Masqué de la Sidebar. Rien n'est supprimé, réactivable à tout moment.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
