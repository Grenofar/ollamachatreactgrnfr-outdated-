import { DiffEditor } from "@monaco-editor/react";
import "../../monacoSetup";
import { languageForPath } from "../../fileLang";
import type { ApprovalRequest } from "../../hooks/useAgentLoop";

export default function ToolApprovalModal({
  request,
  onResolve,
}: {
  request: ApprovalRequest;
  onResolve: (accepted: boolean) => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>{request.kind === "command" ? "Exécuter une commande ?" : "Approuver la modification ?"}</h2>
        {request.path && <p className="modal-hint">{request.path}</p>}

        {request.kind === "command" ? (
          <div className="command-preview">{request.command}</div>
        ) : (
          <div className="diff-container">
            <DiffEditor
              original={request.oldContent ?? ""}
              modified={request.newContent ?? ""}
              language={languageForPath(request.path)}
              theme="vs-dark"
              options={{ readOnly: true, fontSize: 12, minimap: { enabled: false }, renderSideBySide: true }}
            />
          </div>
        )}

        <div className="modal-actions">
          <button onClick={() => onResolve(false)}>Refuser</button>
          <button className="primary-btn" onClick={() => onResolve(true)}>
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}
