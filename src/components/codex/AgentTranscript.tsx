import type { Ref } from "react";
import MessageBubble from "../MessageBubble";
import { MUTATING_TOOLS } from "../../agentTools";
import type { AgentMessage } from "../../types";

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
}: {
  messages: AgentMessage[];
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: () => void;
}) {
  return (
    <div className="codex-transcript-scroll" ref={scrollRef} onScroll={onScroll}>
      {messages
        .filter((m) => m.role !== "system")
        .map((m, i) => (
          <div key={i}>
            {m.content.trim() && (m.role === "user" || m.role === "assistant") && (
              <MessageBubble role={m.role} content={m.content} />
            )}

            {m.role === "assistant" &&
              m.tool_calls?.map((tc) => (
                <div key={tc.id} className={`tool-card ${MUTATING_TOOLS.has(tc.name) ? "tool-card-mutating" : ""}`}>
                  <div className="tool-card-name">{tc.name}</div>
                  <div className="tool-card-body">{formatArgs(tc.arguments)}</div>
                </div>
              ))}

            {m.role === "tool" && (
              <div className="tool-card">
                <div className="tool-card-name">↩ {m.toolName ?? "résultat"}</div>
                <div className="tool-card-body">{m.content}</div>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
