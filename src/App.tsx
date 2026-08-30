import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import MessageBubble from "./components/MessageBubble";
import SettingsModal from "./components/SettingsModal";
import HuggingFaceBrowser from "./components/codex/HuggingFaceBrowser";
import SendButton from "./components/SendButton";
import ModelSelect from "./components/ModelSelect";

const CodexView = lazy(() => import("./components/codex/CodexView"));
import {
  listModels,
  listConversations,
  loadConversation,
  saveConversation,
  deleteConversation,
  loadSettings,
  saveSettings,
  sendChat,
  cancelChat,
  getSystemRamGb,
  closeApp,
  onChatChunk,
  onChatDone,
  onChatCancelled,
  onChatError,
  onFreezeWarning,
  onFreezeResolved,
} from "./api";
import { estimateTokens, trimMessagesToBudget } from "./memory";
import type { ChatMessage, Conversation, ConversationMeta, OllamaModel, Settings, StoredMessage } from "./types";

const NEW_CONV_TITLE = "Nouvelle discussion";
const FREEZE_GRACE_SECS = 20;

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [currentConv, setCurrentConv] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [connError, setConnError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [view, setView] = useState<"chat" | "codex">("chat");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [ramGb, setRamGb] = useState<number | null>(null);
  const [freezeWarning, setFreezeWarning] = useState<{ stalledSecs: number } | null>(null);
  const [graceRemaining, setGraceRemaining] = useState(FREEZE_GRACE_SECS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const graceTimeoutRef = useRef<number | null>(null);
  const graceIntervalRef = useRef<number | null>(null);

  async function refreshModels(host: string): Promise<OllamaModel[]> {
    try {
      const list = await listModels(host);
      setModels(list);
      setConnError(null);
      setSelectedModel((prev) => (list.some((m) => m.name === prev) ? prev : list[0]?.name ?? ""));
      return list;
    } catch {
      setConnError(
        `Ollama injoignable sur ${host}. Vérifie que "ollama serve" tourne, ou change l'adresse dans Paramètres.`,
      );
      return [];
    }
  }

  async function refreshConversations() {
    const list = await listConversations();
    setConversations(list);
  }

  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setSettings(s);
      const list = await refreshModels(s.ollama_host);
      await refreshConversations();
      if (list.length === 0) setShowInstall(true);
    })();
    // Fire-and-forget, off the critical startup path: spawns a PowerShell
    // process (WMI query), noticeably slower than everything else above.
    getSystemRamGb()
      .then(setRamGb)
      .catch(() => setRamGb(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function finishAssistantMessage(content: string, tokens: number) {
      setSending(false);
      setStreamingText("");
      if (!content) return;
      setCurrentConv((prev) => {
        if (!prev) return prev;
        const msg: StoredMessage = { role: "assistant", content, tokens };
        return { ...prev, messages: [...prev.messages, msg] };
      });
    }

    const unlistenChunk = onChatChunk((content) => {
      setStreamingText((prev) => prev + content);
    });
    const unlistenDone = onChatDone((payload) => {
      finishAssistantMessage(payload.content, payload.eval_count);
    });
    const unlistenCancelled = onChatCancelled((payload) => {
      finishAssistantMessage(payload.content, estimateTokens(payload.content));
    });
    const unlistenError = onChatError((message) => {
      setSending(false);
      setStreamingText("");
      setCurrentConv((prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, { role: "system", content: `Erreur : ${message}` }],
            }
          : prev,
      );
    });

    return () => {
      unlistenChunk.then((f) => f());
      unlistenDone.then((f) => f());
      unlistenCancelled.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!currentConv) return;
    saveConversation(currentConv).then(refreshConversations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConv]);

  function clearFreezeTimers() {
    if (graceTimeoutRef.current !== null) {
      window.clearTimeout(graceTimeoutRef.current);
      graceTimeoutRef.current = null;
    }
    if (graceIntervalRef.current !== null) {
      window.clearInterval(graceIntervalRef.current);
      graceIntervalRef.current = null;
    }
  }

  function startGraceCountdown() {
    clearFreezeTimers();
    setGraceRemaining(FREEZE_GRACE_SECS);
    graceTimeoutRef.current = window.setTimeout(() => closeApp(), FREEZE_GRACE_SECS * 1000);
    graceIntervalRef.current = window.setInterval(() => {
      setGraceRemaining((s) => Math.max(0, s - 1));
    }, 1000);
  }

  useEffect(() => {
    // Watches only the basic chat's streaming generation — see
    // src-tauri/src/commands/watchdog.rs for why Codex is excluded.
    const unlistenWarning = onFreezeWarning((stalledSecs) => {
      setFreezeWarning({ stalledSecs });
      startGraceCountdown();
    });
    const unlistenResolved = onFreezeResolved(() => {
      clearFreezeTimers();
      setFreezeWarning(null);
    });
    return () => {
      unlistenWarning.then((f) => f());
      unlistenResolved.then((f) => f());
      clearFreezeTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [currentConv?.messages, streamingText]);

  function handleChatScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function handleNewConversation() {
    if (!selectedModel) return;
    setCurrentConv({
      id: crypto.randomUUID(),
      title: NEW_CONV_TITLE,
      model: selectedModel,
      created_at: Date.now() / 1000,
      messages: [],
    });
  }

  async function handleSelectConversation(id: string) {
    const conv = await loadConversation(id);
    setCurrentConv(conv);
    if (models.some((m) => m.name === conv.model)) setSelectedModel(conv.model);
  }

  async function handleDeleteConversation(id: string) {
    if (!window.confirm("Supprimer définitivement cette discussion ?")) return;
    await deleteConversation(id);
    if (currentConv?.id === id) setCurrentConv(null);
    await refreshConversations();
  }

  async function handleRenameConversation(id: string, title: string) {
    if (currentConv?.id === id) {
      // The currentConv effect below already saves + refreshes on change.
      setCurrentConv({ ...currentConv, title });
      return;
    }
    const conv = await loadConversation(id);
    await saveConversation({ ...conv, title });
    await refreshConversations();
  }

  async function submitToOllama(messages: StoredMessage[], model: string) {
    if (!settings) return;
    const history = trimMessagesToBudget(messages, settings.max_context_tokens);
    const apiMessages: ChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
    if (settings.system_prompt.trim()) {
      apiMessages.unshift({ role: "system", content: settings.system_prompt.trim() });
    }

    setSending(true);
    setStreamingText("");
    try {
      await sendChat(settings.ollama_host, model, apiMessages);
    } catch (e) {
      setSending(false);
      setConnError(String(e));
    }
  }

  async function handleSend() {
    if (sending || !input.trim() || !settings || !selectedModel) return;
    const text = input.trim();
    setInput("");

    const base: Conversation =
      currentConv ?? {
        id: crypto.randomUUID(),
        title: NEW_CONV_TITLE,
        model: selectedModel,
        created_at: Date.now() / 1000,
        messages: [],
      };

    const userMsg: StoredMessage = { role: "user", content: text, tokens: estimateTokens(text) };
    const title = base.title === NEW_CONV_TITLE && base.messages.length === 0 ? text.slice(0, 40) : base.title;
    const updated: Conversation = { ...base, title, messages: [...base.messages, userMsg] };
    setCurrentConv(updated);
    await submitToOllama(updated.messages, updated.model);
  }

  function handleRegenerate() {
    if (!currentConv || sending) return;
    const msgs = currentConv.messages;
    if (msgs.length === 0 || msgs[msgs.length - 1].role !== "assistant") return;
    const truncated = msgs.slice(0, -1);
    setCurrentConv({ ...currentConv, messages: truncated });
    submitToOllama(truncated, currentConv.model);
  }

  function startEdit(index: number, content: string) {
    if (sending) return;
    setEditingIndex(index);
    setEditText(content);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditText("");
  }

  async function submitEdit(index: number) {
    if (!currentConv || !editText.trim()) return;
    const truncated = currentConv.messages.slice(0, index);
    const userMsg: StoredMessage = { role: "user", content: editText.trim(), tokens: estimateTokens(editText.trim()) };
    const updated: Conversation = { ...currentConv, messages: [...truncated, userMsg] };
    setCurrentConv(updated);
    setEditingIndex(null);
    setEditText("");
    await submitToOllama(updated.messages, updated.model);
  }

  function handleKeepWaiting() {
    startGraceCountdown();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleSaveSettings(newSettings: Settings) {
    setSettings(newSettings);
    await saveSettings(newSettings);
    await refreshModels(newSettings.ollama_host);
  }

  async function handlePersistCodexPrefs(mode: "auto" | "approve", lastFolder: string) {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, codex_mode: mode, codex_last_folder: lastFolder };
      saveSettings(next);
      return next;
    });
  }

  const messages = currentConv?.messages ?? [];
  const conversationTokens = messages.reduce((sum, m) => sum + (m.tokens ?? estimateTokens(m.content)), 0);
  const contextTokens = settings
    ? trimMessagesToBudget(messages, settings.max_context_tokens).reduce(
        (sum, m) => sum + (m.tokens ?? estimateTokens(m.content)),
        0,
      )
    : 0;
  const totalTokens = conversations.reduce((sum, c) => sum + c.total_tokens, 0);

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentId={currentConv?.id ?? null}
        onNew={handleNewConversation}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
        onOpenSettings={() => setShowSettings(true)}
        onOpenInstall={() => setShowInstall(true)}
        onOpenCodex={() => setView("codex")}
      />

      {view === "codex" && settings ? (
        <Suspense fallback={<div className="codex-editor-empty">Chargement de l'éditeur…</div>}>
          <CodexView
            settings={settings}
            models={models}
            onPersistCodexPrefs={handlePersistCodexPrefs}
            onBack={() => setView("chat")}
          />
        </Suspense>
      ) : (
      <div className="main">
        {connError && <div className="banner banner-error">{connError}</div>}

        <div className="chat-scroll" ref={scrollRef} onScroll={handleChatScroll}>
          {messages.length === 0 && !sending ? (
            <div className="empty-state">
              <p>Choisis un modèle en bas et lance la discussion.</p>
            </div>
          ) : (
            <>
              {messages.map((m, i) =>
                editingIndex === i ? (
                  <div key={i} className="message-edit">
                    <textarea
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                    />
                    <div className="message-edit-actions">
                      <button onClick={cancelEdit}>Annuler</button>
                      <button className="primary-btn" onClick={() => submitEdit(i)} disabled={!editText.trim()}>
                        Enregistrer et renvoyer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="message-row">
                    <MessageBubble role={m.role} content={m.content} />
                    <div className={`message-actions message-actions-${m.role}`}>
                      {m.role === "user" && !sending && (
                        <button onClick={() => startEdit(i, m.content)}>Modifier</button>
                      )}
                      {m.role === "assistant" && i === messages.length - 1 && !sending && (
                        <button onClick={handleRegenerate}>Régénérer</button>
                      )}
                    </div>
                  </div>
                ),
              )}
              {sending && <MessageBubble role="assistant" content={streamingText || "· · ·"} />}
            </>
          )}
        </div>

        {currentConv && (
          <div className="token-stats">
            <span>Conversation : {conversationTokens.toLocaleString()} tokens</span>
            <span>
              Contexte : {contextTokens.toLocaleString()} / {settings?.max_context_tokens.toLocaleString()} tokens
            </span>
            <span>Total (toutes conversations) : {totalTokens.toLocaleString()} tokens</span>
          </div>
        )}

        <div className="input-area">
          <div className="input-pill">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Envoyer un message"
              rows={1}
            />
            <div className="input-controls">
              <ModelSelect models={models} value={selectedModel} onChange={setSelectedModel} />
              <SendButton
                busy={sending}
                disabled={!input.trim() || !selectedModel}
                onSend={handleSend}
                onStop={() => cancelChat()}
              />
            </div>
          </div>
        </div>
      </div>
      )}

      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          models={models}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
          onRefreshModels={() => refreshModels(settings.ollama_host)}
        />
      )}

      {showInstall && settings && (
        <HuggingFaceBrowser
          host={settings.ollama_host}
          ramGb={ramGb}
          onClose={() => setShowInstall(false)}
          onInstalled={() => refreshModels(settings.ollama_host)}
        />
      )}

      {freezeWarning && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Ça ne répond plus</h2>
            <p className="modal-hint">
              Aucun mot reçu d'Ollama depuis {freezeWarning.stalledSecs}s — ça ressemble à un
              blocage plutôt qu'à une génération lente. Fermeture automatique dans{" "}
              {graceRemaining}s, sauf si tu choisis d'attendre encore.
            </p>
            <div className="modal-actions">
              <button onClick={handleKeepWaiting}>Attendre encore</button>
              <button className="primary-btn" onClick={() => closeApp()}>
                Fermer maintenant
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
