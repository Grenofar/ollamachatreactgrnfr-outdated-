import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import MessageBubble from "../MessageBubble";
import SendButton from "../SendButton";
import {
  cancelControlMe,
  clearControlMeMemory,
  deleteControlMeSession,
  listControlMeMemory,
  listControlMeSessions,
  loadControlMeSession,
  onControlMeCancelled,
  onControlMeConfirmationRequired,
  onControlMeDone,
  onControlMeError,
  onControlMeLimit,
  onControlMeMessage,
  onControlMeStep,
  resolveControlMeConfirmation,
  runControlMe,
  saveControlMeSession,
  searchControlMeSessions,
} from "../../api";
import type { ControlMeMemoryEntry, ControlMeSessionMeta, Settings } from "../../types";

interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  content: string;
}

// gemini-3.6-flash isn't in Google's documented list of computer_use-compatible
// models (verified 2026-08-30) — kept selectable since it was explicitly
// requested, but flagged so a failed run isn't a mystery.
// Note: Google's own docs call gemini-3.7-flash "the recommended model for
// computer use" specifically — marking 3.5 Flash-Lite as recommended here
// is a deliberate user choice, not Google's guidance.
const GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (recommandé)" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (compatibilité non confirmée)" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
];

const NEW_SESSION_TITLE = "Nouvelle session";

export default function ControlMeView({
  settings,
  onPersistModel,
}: {
  settings: Settings;
  onPersistModel: (model: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [model, setModel] = useState(settings.gemini_model || "gemini-3.5-flash-lite");
  const [pendingConfirmation, setPendingConfirmation] = useState<{ action: string; explanation: string } | null>(
    null,
  );
  const [showMemory, setShowMemory] = useState(false);
  const [memory, setMemory] = useState<ControlMeMemoryEntry[] | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [sessionCreatedAt, setSessionCreatedAt] = useState(() => Date.now() / 1000);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<ControlMeSessionMeta[] | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameSessionText, setRenameSessionText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const apiKey = settings.gemini_api_key?.trim() ?? "";

  function handleModelChange(next: string) {
    setModel(next);
    onPersistModel(next);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  // Persists the whole running transcript under one session id, the same
  // "save on every change" pattern App.tsx uses for chat conversations —
  // so a Control Me session survives closing the app instead of vanishing.
  // customTitle overrides the auto-computed title once the session has been
  // renamed — without it, this effect re-firing on every new entry would
  // silently stomp a manual rename back to the auto-generated one.
  useEffect(() => {
    if (entries.length === 0) return;
    const firstUser = entries.find((e) => e.role === "user");
    const title = customTitle ?? (firstUser ? firstUser.content.slice(0, 40) : NEW_SESSION_TITLE);
    saveControlMeSession({ id: sessionId, title, created_at: sessionCreatedAt, entries }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, customTitle]);

  // Debounced history search — mirrors Sidebar.tsx's conversation search:
  // an empty query loads the plain list immediately, a typed query waits
  // 200ms before hitting search_control_me_sessions (title + entry content).
  useEffect(() => {
    if (!showHistory) return;
    const query = historyQuery.trim();
    if (!query) {
      listControlMeSessions()
        .then(setSessions)
        .catch(() => setSessions([]));
      return;
    }
    const handle = window.setTimeout(() => {
      searchControlMeSessions(query)
        .then(setSessions)
        .catch(() => setSessions([]));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [historyQuery, showHistory]);

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
        // Stays "running": the Rust loop is paused mid-flight waiting on
        // resolveControlMeConfirmation, not stopped — accepting or
        // refusing resumes the same run instead of requiring a new message.
        setPendingConfirmation({ action, explanation });
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

  function resolveConfirmation(accept: boolean) {
    setEntries((prev) => [
      ...prev,
      {
        role: "system",
        content: accept
          ? `Action confirmée (${pendingConfirmation?.action}).`
          : `Action refusée (${pendingConfirmation?.action}).`,
      },
    ]);
    setPendingConfirmation(null);
    resolveControlMeConfirmation(accept).catch(() => {});
  }

  function toggleMemory() {
    if (showMemory) {
      setShowMemory(false);
      return;
    }
    setShowMemory(true);
    listControlMeMemory()
      .then(setMemory)
      .catch(() => setMemory([]));
  }

  function handleClearMemory() {
    if (!window.confirm("Effacer tout ce que l'IA a retenu sur toi ?")) return;
    clearControlMeMemory()
      .then(() => setMemory([]))
      .catch(() => {});
  }

  function toggleHistory() {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setSessions(null);
    setHistoryQuery("");
    setShowHistory(true);
  }

  function handleNewSession() {
    setEntries([]);
    setSessionId(crypto.randomUUID());
    setSessionCreatedAt(Date.now() / 1000);
    setCustomTitle(null);
    setShowHistory(false);
  }

  function handleLoadSession(id: string) {
    loadControlMeSession(id)
      .then((session) => {
        setEntries(session.entries as TranscriptEntry[]);
        setSessionId(session.id);
        setSessionCreatedAt(session.created_at);
        setCustomTitle(session.title);
        setShowHistory(false);
      })
      .catch(() => {});
  }

  function handleDeleteSession(id: string) {
    deleteControlMeSession(id)
      .then(() => {
        setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null);
        if (renamingSessionId === id) cancelRenameSession();
        if (id === sessionId) handleNewSession();
      })
      .catch(() => {});
  }

  function startRenameSession(session: ControlMeSessionMeta) {
    setRenamingSessionId(session.id);
    setRenameSessionText(session.title);
  }

  function cancelRenameSession() {
    setRenamingSessionId(null);
    setRenameSessionText("");
  }

  // Renaming the currently-active session just updates customTitle — the
  // auto-save effect above picks it up and persists it. Renaming a
  // different, non-active session has to load it, patch its title, and
  // save it back directly, since it's not reflected in `entries`.
  function confirmRenameSession() {
    const title = renameSessionText.trim();
    const id = renamingSessionId;
    cancelRenameSession();
    if (!id || !title) return;
    setSessions((prev) => prev?.map((s) => (s.id === id ? { ...s, title } : s)) ?? null);
    if (id === sessionId) {
      setCustomTitle(title);
    } else {
      loadControlMeSession(id)
        .then((session) => saveControlMeSession({ ...session, title }))
        .catch(() => {});
    }
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
        <span className="controlme-header-title">Control Me</span>
        <div className="controlme-header-spacer" />
        <button onClick={handleNewSession}>Nouvelle session</button>
        <button onClick={toggleHistory}>Historique</button>
        <button onClick={toggleMemory}>Mémoire</button>
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

      {showHistory && (
        <div className="controlme-memory-panel">
          <input
            className="controlme-session-search"
            type="text"
            placeholder="Rechercher dans l'historique…"
            value={historyQuery}
            onChange={(e) => setHistoryQuery(e.target.value)}
          />
          {sessions === null ? (
            <div className="controlme-memory-empty">Chargement…</div>
          ) : sessions.length === 0 ? (
            <div className="controlme-memory-empty">Aucune session enregistrée pour l'instant.</div>
          ) : (
            <div className="controlme-memory-list">
              {sessions.map((s) => (
                <div key={s.id} className="controlme-session-entry">
                  {renamingSessionId === s.id ? (
                    <input
                      autoFocus
                      className="controlme-session-rename"
                      value={renameSessionText}
                      onChange={(e) => setRenameSessionText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmRenameSession();
                        else if (e.key === "Escape") cancelRenameSession();
                      }}
                      onBlur={cancelRenameSession}
                    />
                  ) : (
                    <button
                      className={`controlme-session-title ${s.id === sessionId ? "controlme-session-active" : ""}`}
                      onClick={() => handleLoadSession(s.id)}
                      onDoubleClick={() => startRenameSession(s)}
                      title="Double-clic pour renommer"
                    >
                      {s.title}
                    </button>
                  )}
                  <button className="controlme-session-delete" onClick={() => handleDeleteSession(s.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showMemory && (
        <div className="controlme-memory-panel">
          {memory === null ? (
            <div className="controlme-memory-empty">Chargement…</div>
          ) : memory.length === 0 ? (
            <div className="controlme-memory-empty">Rien de retenu pour l'instant.</div>
          ) : (
            <>
              <div className="controlme-memory-list">
                {memory.map((entry, i) => (
                  <div key={i} className="controlme-memory-entry">
                    {entry.category && <span className="controlme-memory-category">{entry.category}</span>}
                    {entry.fact}
                  </div>
                ))}
              </div>
              <button className="controlme-memory-clear" onClick={handleClearMemory}>
                Tout effacer
              </button>
            </>
          )}
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
            <div key={i} className="controlme-step" style={{ "--i": i } as CSSProperties}>
              {entry.content}
            </div>
          ) : (
            <MessageBubble key={i} role={entry.role} content={entry.content} style={{ "--i": i } as CSSProperties} />
          ),
        )}
        {pendingConfirmation && (
          <div className="controlme-confirm">
            <div className="controlme-confirm-text">
              <strong>Confirmation demandée : {pendingConfirmation.action}</strong>
              <span>{pendingConfirmation.explanation}</span>
            </div>
            <div className="modal-actions">
              <button onClick={() => resolveConfirmation(false)}>Refuser</button>
              <button className="primary-btn" onClick={() => resolveConfirmation(true)}>
                Confirmer
              </button>
            </div>
          </div>
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
