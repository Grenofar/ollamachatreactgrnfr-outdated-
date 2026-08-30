import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import MessageBubble from "./components/MessageBubble";
import SettingsModal from "./components/SettingsModal";
import InstallPanel from "./components/InstallPanel";
import SendButton from "./components/SendButton";

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
  onChatChunk,
  onChatDone,
  onChatCancelled,
  onChatError,
} from "./api";
import { estimateTokens, trimMessagesToBudget } from "./memory";
import type { ChatMessage, Conversation, ConversationMeta, Settings, StoredMessage } from "./types";

const NEW_CONV_TITLE = "Nouvelle discussion";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<string[]>([]);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  async function refreshModels(host: string): Promise<string[]> {
    try {
      const list = await listModels(host);
      setModels(list);
      setConnError(null);
      setSelectedModel((prev) => (list.includes(prev) ? prev : list[0] ?? ""));
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
    if (models.includes(conv.model)) setSelectedModel(conv.model);
  }

  async function handleDeleteConversation(id: string) {
    if (!window.confirm("Supprimer définitivement cette discussion ?")) return;
    await deleteConversation(id);
    if (currentConv?.id === id) setCurrentConv(null);
    await refreshConversations();
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

    const history = trimMessagesToBudget(updated.messages, settings.max_context_tokens);
    const apiMessages: ChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
    if (settings.system_prompt.trim()) {
      apiMessages.unshift({ role: "system", content: settings.system_prompt.trim() });
    }

    setSending(true);
    setStreamingText("");
    try {
      await sendChat(settings.ollama_host, updated.model, apiMessages);
    } catch (e) {
      setSending(false);
      setConnError(String(e));
    }
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

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentId={currentConv?.id ?? null}
        onNew={handleNewConversation}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
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
              <div className="empty-logo">🦙</div>
              <p>Choisis un modèle en bas et lance la discussion.</p>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <MessageBubble key={i} role={m.role} content={m.content} />
              ))}
              {sending && <MessageBubble role="assistant" content={streamingText || "· · ·"} />}
            </>
          )}
        </div>

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
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                {models.length === 0 && <option value="">Aucun modèle</option>}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
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
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
          onRefreshModels={() => refreshModels(settings.ollama_host)}
        />
      )}

      {showInstall && settings && (
        <InstallPanel
          host={settings.ollama_host}
          onClose={() => setShowInstall(false)}
          onInstalled={() => refreshModels(settings.ollama_host)}
        />
      )}
    </div>
  );
}
