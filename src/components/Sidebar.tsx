import { useEffect, useState, type CSSProperties } from "react";
import { searchConversations } from "../api";
import type { ConversationMeta } from "../types";

export default function Sidebar({
  conversations,
  currentId,
  view,
  disabledExtensions,
  onNew,
  onSelect,
  onDelete,
  onRename,
  onOpenSettings,
  onOpenCodex,
  onOpenControlMe,
  onOpenExtensions,
  onOpenGame,
  onOpenSkills,
}: {
  conversations: ConversationMeta[];
  currentId: string | null;
  view: "chat" | "codex" | "controlme" | "game" | "settings" | "extensions" | "skills";
  disabledExtensions: string[];
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onOpenSettings: () => void;
  onOpenCodex: () => void;
  onOpenControlMe: () => void;
  onOpenExtensions: () => void;
  onOpenGame: () => void;
  onOpenSkills: () => void;
}) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ConversationMeta[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // Searches title AND message content (server-side, see search_conversations)
  // rather than just filtering the loaded list client-side — titles are
  // auto-generated from the first message, so most of what's in an older
  // conversation wouldn't be findable by title alone.
  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = window.setTimeout(() => {
      searchConversations(query)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [search]);

  const filtered = searchResults ?? conversations;

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
        {filtered.map((conv, i) => (
          <div
            key={conv.id}
            className={`sidebar-item ${conv.id === currentId ? "sidebar-item-active" : ""}`}
            style={{ "--i": i } as CSSProperties}
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
        {searching && <div className="sidebar-empty">Recherche…</div>}
        {!searching && conversations.length > 0 && filtered.length === 0 && (
          <div className="sidebar-empty">Aucun résultat.</div>
        )}
      </div>

      {!disabledExtensions.includes("codex") && (
        <button
          className={`sidebar-install-btn ${view === "codex" ? "sidebar-nav-active" : ""}`}
          onClick={onOpenCodex}
        >
          Codex
        </button>
      )}
      {!disabledExtensions.includes("controlme") && (
        <button
          className={`sidebar-install-btn ${view === "controlme" ? "sidebar-nav-active" : ""}`}
          onClick={onOpenControlMe}
        >
          Control Me
        </button>
      )}
      <button
        className={`sidebar-install-btn ${view === "game" ? "sidebar-nav-active" : ""}`}
        onClick={onOpenGame}
      >
        Jeu
      </button>
      <button
        className={`sidebar-install-btn ${view === "skills" ? "sidebar-nav-active" : ""}`}
        onClick={onOpenSkills}
      >
        Skills
      </button>
      <button
        className={`sidebar-install-btn ${view === "extensions" ? "sidebar-nav-active" : ""}`}
        onClick={onOpenExtensions}
      >
        Extensions
      </button>
      <button
        className={`sidebar-settings-btn ${view === "settings" ? "sidebar-nav-active" : ""}`}
        onClick={onOpenSettings}
      >
        Paramètres
      </button>
    </div>
  );
}
