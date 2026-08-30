import { useState } from "react";
import type { ConversationMeta } from "../types";

export default function Sidebar({
  conversations,
  currentId,
  onNew,
  onSelect,
  onDelete,
  onRename,
  onOpenSettings,
  onOpenInstall,
  onOpenCodex,
}: {
  conversations: ConversationMeta[];
  currentId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onOpenSettings: () => void;
  onOpenInstall: () => void;
  onOpenCodex: () => void;
}) {
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const filtered = search.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(search.trim().toLowerCase()))
    : conversations;

  function startRename(conv: ConversationMeta) {
    setRenamingId(conv.id);
    setRenameText(conv.title);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameText("");
  }

  function confirmRename() {
    const title = renameText.trim();
    if (renamingId && title) onRename(renamingId, title);
    cancelRename();
  }

  return (
    <div className="sidebar">
      <button className="sidebar-new-btn" onClick={onNew}>
        +  Nouvelle discussion
      </button>

      {conversations.length > 0 && (
        <input
          className="sidebar-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
        />
      )}

      <div className="sidebar-list">
        {filtered.map((conv) => (
          <div
            key={conv.id}
            className={`sidebar-item ${conv.id === currentId ? "sidebar-item-active" : ""}`}
          >
            {renamingId === conv.id ? (
              <input
                autoFocus
                className="sidebar-item-rename"
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmRename();
                  else if (e.key === "Escape") cancelRename();
                }}
                onBlur={cancelRename}
              />
            ) : (
              <button
                className="sidebar-item-title"
                onClick={() => onSelect(conv.id)}
                onDoubleClick={() => startRename(conv)}
                title="Double-clic pour renommer"
              >
                {conv.title.length > 28 ? conv.title.slice(0, 28) + "…" : conv.title}
              </button>
            )}
            <button
              className="sidebar-item-delete"
              onClick={() => onDelete(conv.id)}
              title="Supprimer"
            >
              ✕
            </button>
          </div>
        ))}
        {conversations.length > 0 && filtered.length === 0 && (
          <div className="sidebar-empty">Aucun résultat.</div>
        )}
      </div>

      <button className="sidebar-install-btn" onClick={onOpenCodex}>
        Codex
      </button>
      <button className="sidebar-install-btn" onClick={onOpenInstall}>
        Installer un modèle
      </button>
      <button className="sidebar-settings-btn" onClick={onOpenSettings}>
        Paramètres
      </button>
    </div>
  );
}
