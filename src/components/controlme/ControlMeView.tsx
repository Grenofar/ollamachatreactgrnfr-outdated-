import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import MessageBubble from "../MessageBubble";
import SendButton from "../SendButton";
import {
  cancelControlMe,
  onControlMeCancelled,
  onControlMeConfirmationRequired,
  onControlMeDone,
  onControlMeError,
  onControlMeLimit,
  onControlMeMessage,
  onControlMeStep,
  runControlMe,
} from "../../api";
import type { Settings } from "../../types";

interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  content: string;
}

export default function ControlMeView({ settings, onBack }: { settings: Settings; onBack: () => void }) {
  const [instruction, setInstruction] = useState("");
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const apiKey = settings.gemini_api_key?.trim() ?? "";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  useEffect(() => {
    const unlistens = [
      onControlMeStep((step) => {
        const intentText = step.thought ? `${step.thought} — ` : "";
        setEntries((prev) => [...prev, { role: "system", content: `${intentText}${step.args.label ?? step.action}` }]);
      }),
      onControlMeMessage((text) => {
        setEntries((prev) => [...prev, { role: "assistant", content: text }]);
      }),
      onControlMeDone((summary) => {
        setEntries((prev) => [...prev, { role: "assistant", content: summary }]);
        setRunning(false);
      }),
      onControlMeError((message) => {
        setEntries((prev) => [...prev, { role: "system", content: `Erreur : ${message}` }]);
        setRunning(false);
      }),
      onControlMeCancelled(() => {
        setEntries((prev) => [...prev, { role: "system", content: "Arrêté." }]);
        setRunning(false);
      }),
      onControlMeLimit(() => {
        setEntries((prev) => [
          ...prev,
          { role: "system", content: "Limite d'actions atteinte pour cette instruction — envoie un nouveau message pour continuer." },
        ]);
        setRunning(false);
      }),
      onControlMeConfirmationRequired(({ action, explanation }) => {
        setEntries((prev) => [
          ...prev,
          {
            role: "system",
            content: `Action mise en pause (${action}) : ${explanation}. Gemini juge cette action sensible — envoie un nouveau message pour confirmer et continuer.`,
          },
        ]);
        setRunning(false);
      }),
    ];
    return () => {
      unlistens.forEach((p) => p.then((f) => f()));
    };
  }, []);

  function handleSend() {
    const text = instruction.trim();
    if (!text || !apiKey) return;
    setEntries((prev) => [...prev, { role: "user", content: text }]);
    setInstruction("");
    setRunning(true);
    runControlMe(apiKey, text).catch((e) => {
      setEntries((prev) => [...prev, { role: "system", content: `Erreur : ${String(e)}` }]);
      setRunning(false);
    });
  }

  function handleStop() {
    cancelControlMe().catch(() => {});
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="controlme">
      <div className="controlme-header">
        <button onClick={onBack}>← Chat</button>
        <span className="controlme-header-title">Control Me</span>
      </div>

      {!apiKey && (
        <div className="banner banner-error">
          Aucune clé API Gemini configurée. Ajoute-la dans Réglages pour utiliser Control Me.
        </div>
      )}

      <div className="controlme-scroll" ref={scrollRef}>
        {entries.length === 0 && (
          <div className="empty-state">
            <p>
              Décris ce que tu veux que l'IA fasse sur ton PC. Elle contrôle directement la souris et le clavier —
              regarde ce qui se passe, un bouton Stop est toujours disponible.
            </p>
          </div>
        )}
        {entries.map((entry, i) =>
          entry.role === "system" ? (
            <div key={i} className="controlme-step">
              {entry.content}
            </div>
          ) : (
            <MessageBubble key={i} role={entry.role} content={entry.content} />
          ),
        )}
      </div>

      <div className="input-area">
        <div className="input-pill">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Demande à l'IA de faire quelque chose sur ton PC…"
            rows={2}
            disabled={running || !apiKey}
          />
          <div className="input-controls">
            <SendButton
              busy={running}
              disabled={!instruction.trim() || !apiKey}
              onSend={handleSend}
              onStop={handleStop}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
