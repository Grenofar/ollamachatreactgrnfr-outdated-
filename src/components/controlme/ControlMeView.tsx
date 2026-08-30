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

// gemini-3.6-flash isn't in Google's documented list of computer_use-compatible
// models (verified 2026-08-30) — kept selectable since it was explicitly
// requested, but flagged so a failed run isn't a mystery.
const GEMINI_MODELS = [
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash (recommandé)" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (compatibilité non confirmée)" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (rapide, économique)" },
];

export default function ControlMeView({
  settings,
  onBack,
  onPersistModel,
}: {
  settings: Settings;
  onBack: () => void;
  onPersistModel: (model: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [model, setModel] = useState(settings.gemini_model || "gemini-3.7-flash");
  const scrollRef = useRef<HTMLDivElement>(null);

  const apiKey = settings.gemini_api_key?.trim() ?? "";

  function handleModelChange(next: string) {
    setModel(next);
    onPersistModel(next);
  }

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
    runControlMe(apiKey, model, text).catch((e) => {
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
        <div className="controlme-header-spacer" />
        <select
          className="controlme-model-select"
          value={model}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={running}
        >
          {GEMINI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
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
