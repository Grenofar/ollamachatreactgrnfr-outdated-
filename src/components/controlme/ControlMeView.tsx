import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import MessageBubble, { renderMarkdown } from "../MessageBubble";
import SendButton from "../SendButton";
import MicButton from "../MicButton";
import VoiceMode from "../VoiceMode";
import { startLiveControl, type LiveControlSession } from "../../liveControl";
import {
  cancelControlMe,
  clearControlMeMemory,
  deleteControlMeSession,
  listControlMeMemory,
  listControlMeSessions,
  deleteSkill,
  extractSkillFromTranscript,
  listSkills,
  loadControlMeSession,
  loadSkill,
  saveNewSkill,
  updateSkill,
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
import type { ControlMeMemoryEntry, ControlMeSessionMeta, Settings, SkillMeta } from "../../types";

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
  const [voiceMode, setVoiceMode] = useState(false);
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
  const [showSkills, setShowSkills] = useState(false);
  const [skills, setSkills] = useState<SkillMeta[] | null>(null);
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);
  const [renamingSkillId, setRenamingSkillId] = useState<string | null>(null);
  const [renameSkillText, setRenameSkillText] = useState("");
  // One shared status line for the skill panel — a Gemini extraction takes
  // several seconds, and without it the buttons look inert.
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  // Skill currently being recorded into. Armed from the Skills panel — valid
  // before a single word has been said, which is the point: the model writes
  // into it as it goes rather than only at the end.
  const [recording, setRecording] = useState<{ id: string; name: string; wasNew: boolean; snapshot: string; teaching: boolean } | null>(
    null,
  );
  const liveRef = useRef<LiveControlSession | null>(null);
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
    saveControlMeSession({
      id: sessionId,
      title,
      created_at: sessionCreatedAt,
      entries,
      // Recorded so the settings panel can later show which skills a
      // conversation used, and offer to improve exactly those.
      skill_ids: Array.from(new Set([...activeSkillIds, ...(recording ? [recording.id] : [])])),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, customTitle, activeSkillIds, recording]);

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
    if (!text) return;
    setInstruction("");
    sendInstruction(text);
  }

  // Same path as handleSend but with the text passed in — voice mode has no
  // input box to read from.
  function sendInstruction(raw: string) {
    const text = raw.trim();
    if (!text || !apiKey || running) return;
    setEntries((prev) => [...prev, { role: "user", content: text }]);
    setRunning(true);
    // Mode Live : une session ouverte remplace la boucle REST. Si elle
    // tourne déjà, on lui parle au lieu d'en relancer une.
    if (settings.control_me_live && apiKey) {
      if (liveRef.current) {
        liveRef.current.say(text);
        return;
      }
      startLiveControl({
        apiKey,
        model: settings.live_model ?? undefined,
        instruction: text,
        perception: settings.control_me_perception_mode === "windows_ui" ? "windows_ui" : "capture",
        fps: settings.control_me_live_fps ?? 1,
        recordingSkillId: recording?.id ?? null,
        onStep: (label) => setEntries((prev) => [...prev, { role: "system", content: label }]),
        onMessage: (msg) => setEntries((prev) => [...prev, { role: "assistant", content: msg }]),
        onError: (msg) => {
          setEntries((prev) => [...prev, { role: "system", content: `Erreur : ${msg}` }]);
          // Une erreur de setup arrive avant toute action : dans ce cas la
          // session ne servira à rien, autant relancer en classique.
          if (!liveRef.current) {
            setEntries((prev) => [...prev, { role: "system", content: "Bascule sur le mode classique." }]);
            runClassic(text);
          }
        },
        onClose: () => {
          liveRef.current = null;
          setRunning(false);
        },
      })
        .then((session) => {
          liveRef.current = session;
        })
        .catch((e) => {
          // La session temps réel a échoué : on exécute quand même
          // l'instruction avec la boucle classique. Rester bloqué sur une
          // erreur serait pire que d'être simplement plus lent.
          setEntries((prev) => [
            ...prev,
            { role: "system", content: `Temps réel indisponible (${e}) — bascule sur le mode classique.` },
          ]);
          runClassic(text);
        });
      return;
    }
    runClassic(text);
  }

  function runClassic(text: string) {
    runControlMe(apiKey, model, text, activeSkillIds, recording?.id ?? null, recording?.teaching ?? false).catch((e) => {
      setEntries((prev) => [...prev, { role: "system", content: `Erreur : ${String(e)}` }]);
      setRunning(false);
    });
  }

  function handleStop() {
    liveRef.current?.stop();
    liveRef.current = null;
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

  function toggleSkills() {
    if (showSkills) {
      setShowSkills(false);
      return;
    }
    setShowSkills(true);
    if (skills === null) {
      listSkills()
        .then(setSkills)
        .catch(() => setSkills([]));
    }
  }

  function toggleActiveSkill(id: string) {
    setActiveSkillIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  // The conversation itself IS the source material: Gemini re-reads the
  // whole transcript and writes down what it learned, either as a brand new
  // skill or folded into one that already exists (existingContent is what
  // makes it an update rather than a replacement).
  function transcriptText(): string {
    return entries.map((e) => `${e.role}: ${e.content}`).join("\n");
  }

  // Arming is deliberately allowed before the conversation starts: the model
  // then writes into the skill as it learns, rather than the user having to
  // remember to extract everything at the end.
  async function handleStartRecording(teaching: boolean) {
    const name = window.prompt("Nom du skill à enregistrer pendant cette conversation :", "")?.trim();
    if (!name) return;
    try {
      const created = await saveNewSkill(
        name,
        `Enregistré pendant une conversation Control Me du ${new Date().toLocaleDateString("fr-FR")}`,
        "",
      );
      setSkills((prev) => [
        {
          id: created.id,
          name: created.name,
          description: created.description,
          is_public: created.is_public,
          created_at: created.created_at,
        },
        ...(prev ?? []),
      ]);
      setRecording({ id: created.id, name: created.name, wasNew: true, snapshot: "", teaching });
      setSkillBusy(null);
    } catch (e) {
      setSkillBusy(`Échec : ${e}`);
    }
  }

  async function handleRecordInto(meta: SkillMeta) {
    try {
      const skill = await loadSkill(meta.id);
      // Snapshot so "Annuler" can put an existing skill back exactly as it
      // was, instead of leaving half-written notes behind.
      setRecording({ id: skill.id, name: skill.name, wasNew: false, snapshot: skill.content, teaching: false });
      setSkillBusy(null);
    } catch (e) {
      setSkillBusy(`Échec : ${e}`);
    }
  }

  function handleStopRecording() {
    if (!recording) return;
    setSkillBusy(`Enregistrement terminé — « ${recording.name} » conservé.`);
    setRecording(null);
  }

  async function handleCancelRecording() {
    if (!recording) return;
    const label = recording.wasNew
      ? `Annuler l'enregistrement et supprimer le skill « ${recording.name} » ?`
      : `Annuler l'enregistrement et remettre « ${recording.name} » comme il était ?`;
    if (!window.confirm(label)) return;
    const target = recording;
    setRecording(null);
    try {
      if (target.wasNew) {
        await deleteSkill(target.id);
        setSkills((prev) => (prev ?? []).filter((s) => s.id !== target.id));
        setActiveSkillIds((prev) => prev.filter((s) => s !== target.id));
      } else {
        const skill = await loadSkill(target.id);
        await updateSkill({ ...skill, content: target.snapshot });
      }
      setSkillBusy("Enregistrement annulé.");
    } catch (e) {
      setSkillBusy(`Échec de l'annulation : ${e}`);
    }
  }

  async function handleCreateSkillFromSession() {
    if (!apiKey) {
      setSkillBusy("Ajoute d'abord ta clé API Gemini dans Réglages.");
      return;
    }
    if (entries.length === 0) {
      setSkillBusy("Cette session est vide — parle d'abord avec Control Me.");
      return;
    }
    // One dialog, not two: the description is filled in automatically and
    // both fields stay editable afterwards (double-click to rename here,
    // full editor in the Skills space).
    const name = window.prompt("Nom du nouveau skill :", "")?.trim();
    if (!name) return;
    setSkillBusy("L'IA relit la conversation et note ce qu'elle a appris…");
    try {
      const content = await extractSkillFromTranscript(apiKey, model, "", transcriptText());
      const created = await saveNewSkill(
        name,
        `Appris automatiquement depuis une conversation Control Me du ${new Date().toLocaleDateString("fr-FR")}`,
        content,
      );
      setSkills((prev) => [
        {
          id: created.id,
          name: created.name,
          description: created.description,
          is_public: created.is_public,
          created_at: created.created_at,
        },
        ...(prev ?? []),
      ]);
      setActiveSkillIds((prev) => [...prev, created.id]);
      setSkillBusy(`Skill « ${created.name} » créé.`);
    } catch (e) {
      setSkillBusy(`Échec de la création : ${e}`);
    }
  }

  async function handleEnrichSkill(id: string) {
    if (!apiKey) {
      setSkillBusy("Ajoute d'abord ta clé API Gemini dans Réglages.");
      return;
    }
    if (entries.length === 0) {
      setSkillBusy("Cette session est vide — rien à ajouter au skill.");
      return;
    }
    setSkillBusy("L'IA ajoute ce qu'elle vient d'apprendre au skill…");
    try {
      const skill = await loadSkill(id);
      const content = await extractSkillFromTranscript(apiKey, model, skill.content, transcriptText());
      await updateSkill({ ...skill, content });
      setSkillBusy(`Skill « ${skill.name} » mis à jour.`);
    } catch (e) {
      setSkillBusy(`Échec de la mise à jour : ${e}`);
    }
  }

  async function handleDeleteSkill(id: string, name: string) {
    if (!window.confirm(`Supprimer définitivement le skill « ${name} » ?`)) return;
    try {
      await deleteSkill(id);
      setSkills((prev) => (prev ?? []).filter((s) => s.id !== id));
      setActiveSkillIds((prev) => prev.filter((s) => s !== id));
      setSkillBusy(null);
    } catch (e) {
      setSkillBusy(`Échec de la suppression : ${e}`);
    }
  }

  function startRenameSkill(s: SkillMeta) {
    setRenamingSkillId(s.id);
    setRenameSkillText(s.name);
  }

  async function confirmRenameSkill() {
    const id = renamingSkillId;
    const name = renameSkillText.trim();
    setRenamingSkillId(null);
    if (!id || !name) return;
    try {
      const skill = await loadSkill(id);
      await updateSkill({ ...skill, name });
      setSkills((prev) => (prev ?? []).map((s) => (s.id === id ? { ...s, name } : s)));
    } catch (e) {
      setSkillBusy(`Échec du renommage : ${e}`);
    }
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

  // Spoken back in voice mode. Only assistant entries — the "step" ones
  // (system role) are running commentary on what's being clicked, not
  // something worth reading aloud mid-conversation.
  const lastAssistantReply =
    [...entries].reverse().find((e) => e.role === "assistant")?.content ?? null;

  return (
    <div className="controlme">
      <div className="controlme-header">
        <span className="controlme-header-title">Control Me</span>
        <div className="controlme-header-spacer" />
        <button onClick={handleNewSession}>Nouvelle session</button>
        <button onClick={toggleHistory}>Historique</button>
        <button onClick={toggleMemory}>Mémoire</button>
        <button onClick={toggleSkills}>
          Skills{activeSkillIds.length > 0 ? ` (${activeSkillIds.length})` : ""}
        </button>
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

      {recording && (
        <div className="controlme-recording">
          <span className="controlme-recording-dot" />
          <span className="controlme-recording-text">
            {recording.teaching ? (
              <>
                Apprentissage de <strong>{recording.name}</strong> — explique-lui la marche à suivre, elle
                pose des questions et note chaque étape. Elle n'agit pas sur le PC sauf si tu le demandes.
              </>
            ) : (
              <>
                Enregistrement dans <strong>{recording.name}</strong> — l'IA y note ce qu'elle juge important.
              </>
            )}
          </span>
          <button onClick={handleStopRecording}>Arrêter</button>
          <button className="controlme-recording-cancel" onClick={handleCancelRecording}>
            Annuler
          </button>
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

      {showSkills && (
        <div className="controlme-memory-panel">
          <div className="controlme-skill-toolbar">
            <span className="modal-hint">
              Coche autant de skills que tu veux : ils sont tous fournis à l'IA dans la même conversation.
            </span>
            <button onClick={() => void handleStartRecording(true)} disabled={recording !== null}>
              Apprendre un nouveau skill
            </button>
            <button onClick={() => void handleStartRecording(false)} disabled={recording !== null}>
              Enregistrer dans un nouveau skill
            </button>
            <button onClick={handleCreateSkillFromSession}>Créer un skill depuis cette conversation</button>
          </div>
          {skillBusy && <div className="controlme-skill-status">{skillBusy}</div>}
          {skills === null ? (
            <div className="controlme-memory-empty">Chargement…</div>
          ) : skills.length === 0 ? (
            <div className="controlme-memory-empty">
              Aucun skill pour l'instant. Discute avec Control Me, puis clique « Créer un skill depuis cette
              conversation » pour qu'elle note ce qu'elle a appris.
            </div>
          ) : (
            <div className="controlme-memory-list">
              {skills.map((s) => (
                <div key={s.id} className="controlme-skill-row">
                  <input
                    type="checkbox"
                    checked={activeSkillIds.includes(s.id)}
                    onChange={() => toggleActiveSkill(s.id)}
                  />
                  {renamingSkillId === s.id ? (
                    <input
                      autoFocus
                      className="controlme-session-rename"
                      value={renameSkillText}
                      onChange={(e) => setRenameSkillText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmRenameSkill();
                        else if (e.key === "Escape") setRenamingSkillId(null);
                      }}
                      onBlur={() => setRenamingSkillId(null)}
                    />
                  ) : (
                    <span
                      className="controlme-skill-name"
                      onDoubleClick={() => startRenameSkill(s)}
                      title="Double-clic pour renommer"
                    >
                      <strong>{s.name}</strong>
                      <span className="modal-hint">{s.description}</span>
                    </span>
                  )}
                  <button
                    className="controlme-skill-action"
                    onClick={() => handleRecordInto(s)}
                    disabled={recording !== null}
                    title="L'IA écrira dans ce skill au fil de la conversation"
                  >
                    Enregistrer ici
                  </button>
                  <button
                    className="controlme-skill-action"
                    onClick={() => handleEnrichSkill(s.id)}
                    title="Ajouter à ce skill ce que l'IA a appris dans cette conversation"
                  >
                    Enrichir
                  </button>
                  <button className="controlme-session-delete" onClick={() => handleDeleteSkill(s.id, s.name)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {voiceMode ? (
        <VoiceMode
          title="Control Me — conversation vocale"
          subtitle="Dis à l'IA ce qu'elle doit faire sur ton PC"
          assistantName="Control Me"
          busy={running}
          reply={lastAssistantReply}
          onUserMessage={sendInstruction}
          onClose={() => setVoiceMode(false)}
          geminiApiKey={apiKey}
          geminiModel={model}
          geminiVoice={settings.gemini_voice ?? ""}
          micDeviceId={settings.preferred_microphone ?? ""}
          liveMode={settings.voice_live_mode ?? false}
          liveModel={settings.live_model ?? ""}
          liveInstruction="Tu discutes avec la personne de ce qu'elle veut faire sur son PC. Réponds brièvement, comme à l'oral."
        />
      ) : (
      <>
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
            <div
              key={i}
              className="controlme-step"
              style={{ "--i": i } as CSSProperties}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.content) }}
            />
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
            <MicButton onTranscript={setInstruction} disabled={running || !apiKey} />
            <button
              className="voice-mode-btn"
              onClick={() => setVoiceMode(true)}
              disabled={!apiKey}
              title="Conversation vocale (mains libres)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="10" x2="4" y2="14" />
                <line x1="8" y1="7" x2="8" y2="17" />
                <line x1="12" y1="4" x2="12" y2="20" />
                <line x1="16" y1="7" x2="16" y2="17" />
                <line x1="20" y1="10" x2="20" y2="14" />
              </svg>
            </button>
            <SendButton
              busy={running}
              disabled={!instruction.trim() || !apiKey}
              onSend={handleSend}
              onStop={handleStop}
            />
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
