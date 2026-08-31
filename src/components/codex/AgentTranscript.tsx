import type { CSSProperties, Ref } from "react";
import { DiffEditor } from "@monaco-editor/react";
import "../../monacoSetup";
import MessageBubble from "../MessageBubble";
import { MUTATING_TOOLS } from "../../agentTools";
import { languageForPath } from "../../fileLang";
import type { ApprovalRequest } from "../../hooks/useAgentLoop";
import type { AgentMessage } from "../../types";

const TOOL_LABELS: Record<string, string> = {
  read_file: "Lecture",
  list_dir: "Exploration du dossier",
  write_file: "Écriture de fichier",
  edit_file: "Modification de fichier",
  run_powershell_command: "Commande PowerShell",
  ask_user_question: "Question",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => {
      const text = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${text.length > 100 ? text.slice(0, 100) + "…" : text}`;
    })
    .join("\n");
}

export default function AgentTranscript({
  messages,
  scrollRef,
  onScroll,
  streamingText,
  isThinking,
  runningToolId,
  runningOutput,
  pendingApproval,
  onResolveApproval,
}: {
  messages: AgentMessage[];
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: () => void;
  streamingText?: string;
  isThinking?: boolean;
  runningToolId?: string | null;
  runningOutput?: string;
  pendingApproval?: ApprovalRequest | null;
  onResolveApproval?: (accepted: boolean) => void;
}) {
  return (
    <div className="codex-transcript-scroll" ref={scrollRef} onScroll={onScroll}>
      {messages
        .filter((m) => m.role !== "system")
        .map((m, i) => (
          <div key={i} style={{ "--i": i } as CSSProperties}>
            {m.content.trim() && (m.role === "user" || m.role === "assistant") && (
              <MessageBubble role={m.role} content={m.content} />
            )}

            {m.role === "assistant" &&
              m.tool_calls?.map((tc) => {
                const isRunning = tc.id === runningToolId;
                const isPendingApproval = isRunning && pendingApproval?.toolCall.id === tc.id;
                return (
                  <div
                    key={tc.id}
                    className={`tool-card ${MUTATING_TOOLS.has(tc.name) ? "tool-card-mutating" : ""} ${isRunning ? "tool-card-running" : ""}`}
                  >
                    <div className="tool-card-head">
                      <span className="tool-card-name">{toolLabel(tc.name)}</span>
                      {isPendingApproval && <span className="tool-card-badge tool-card-badge-approval">Approbation requise</span>}
                      {isRunning && !isPendingApproval && <span className="tool-card-badge tool-card-badge-running">En cours…</span>}
                    </div>
                    <div className="tool-card-body">{formatArgs(tc.arguments)}</div>

                    {isPendingApproval && pendingApproval && (
                      <div className="tool-approval-inline">
                        {pendingApproval.kind === "command" ? (
                          <div className="command-preview">{pendingApproval.command}</div>
                        ) : (
                          <div className="diff-container diff-container-inline">
                            <DiffEditor
                              original={pendingApproval.oldContent ?? ""}
                              modified={pendingApproval.newContent ?? ""}
                              language={languageForPath(pendingApproval.path)}
                              theme="vs-dark"
                              options={{ readOnly: true, fontSize: 12, minimap: { enabled: false }, renderSideBySide: true }}
                            />
                          </div>
                        )}
                        <div className="modal-actions">
                          <button onClick={() => onResolveApproval?.(false)}>Refuser</button>
                          <button className="primary-btn" onClick={() => onResolveApproval?.(true)}>
                            Accepter
                          </button>
                        </div>
                      </div>
                    )}

                    {isRunning && !isPendingApproval && tc.name === "run_powershell_command" && runningOutput && (
                      <div className="tool-card-live-output">{runningOutput}</div>
                    )}
                  </div>
                );
              })}

            {m.role === "tool" && (
              <div className="tool-card">
                <div className="tool-card-head">
                  <span className="tool-card-name">↩ {toolLabel(m.toolName ?? "")}</span>
                </div>
                <div className="tool-card-body">{m.content}</div>
              </div>
            )}
          </div>
        ))}

      {isThinking && <MessageBubble role="assistant" content={streamingText || "· · ·"} streaming />}
    </div>
  );
}
