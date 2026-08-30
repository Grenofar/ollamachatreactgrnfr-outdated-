import type { ConversationMeta } from "../types";

export default function Sidebar({
  conversations,
  currentId,
  onNew,
  onSelect,
  onDelete,
  onOpenSettings,
  onOpenInstall,
  onOpenCodex,
}: {
  conversations: ConversationMeta[];
  currentId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onOpenInstall: () => void;
  onOpenCodex: () => void;
}) {
  return (
    <div className="sidebar">
      <button className="sidebar-new-btn" onClick={onNew}>
        +  Nouvelle discussion
      </button>

      <div className="sidebar-list">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`sidebar-item ${conv.id === currentId ? "sidebar-item-active" : ""}`}
          >
            <button className="sidebar-item-title" onClick={() => onSelect(conv.id)}>
              {conv.title.length > 28 ? conv.title.slice(0, 28) + "…" : conv.title}
            </button>
            <button
              className="sidebar-item-delete"
              onClick={() => onDelete(conv.id)}
              title="Supprimer"
            >
              ✕
            </button>
          </div>
        ))}
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
