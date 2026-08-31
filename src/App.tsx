import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";
import Sidebar from "./components/Sidebar";
import MessageBubble from "./components/MessageBubble";
import HuggingFaceBrowser from "./components/codex/HuggingFaceBrowser";
import SendButton from "./components/SendButton";
import ModelSelect from "./components/ModelSelect";

const CodexView = lazy(() => import("./components/codex/CodexView"));
const ControlMeView = lazy(() => import("./components/controlme/ControlMeView"));
const SettingsView = lazy(() => import("./components/SettingsView"));
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
  onRemoteViewerChanged,
} from "./api";
import { estimateTokens, trimMessagesToBudget } from "./memory";
import type { ChatMessage, Conversation, ConversationMeta, OllamaModel, Settings, StoredMessage } from "./types";

const NEW_CONV_TITLE = "Nouvelle discussion";
const FREEZE_GRACE_SECS = 20;
const UPDATE_CHECK_DELAY_MS = 5_000;
const UPDATE_CHECK_TIMEOUT_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h — the app can now live a long time in the tray

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
  const [showInstall, setShowInstall] = useState(false);
  const [view, setView] = useState<"chat" | "codex" | "controlme" | "settings">("chat");
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [ramGb, setRamGb] = useState<number | null>(null);
  const [freezeWarning, setFreezeWarning] = useState<{ stalledSecs: number } | null>(null);
  const [graceRemaining, setGraceRemaining] = useState(FREEZE_GRACE_SECS);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInstallPct, setUpdateInstallPct] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [upToDate, setUpToDate] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const graceTimeoutRef = useRef<number | null>(null);
  const graceIntervalRef = useRef<number | null>(null);
  // Per-conversation draft text, kept outside React state (drafts are
  // transient and don't need to trigger re-renders on their own) so
  // switching conversations doesn't leak or drop what you were typing.
  const draftsRef = useRef<Map<string, string>>(new Map());

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

  useEffect(() => {
    const unlisten = onRemoteViewerChanged(setRemoteConnected);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

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
    // Fires for either the basic chat or Codex generating — both report
    // progress to the same Rust-side watchdog, see watchdog.rs.
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

  useEffect(() => {
    let cancelled = false;
    async function checkSilently() {
      try {
        const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
        if (!cancelled && update) setAvailableUpdate(update);
      } catch {
        // Silent: this runs unprompted in the background, a failed check
        // (offline, unreachable) shouldn't interrupt anyone with an error —
        // the Réglages button still surfaces failures when checked by hand.
      }
    }
    const initial = window.setTimeout(checkSilently, UPDATE_CHECK_DELAY_MS);
    const interval = window.setInterval(checkSilently, UPDATE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    setUpdateError(null);
    setUpToDate(false);
    try {
      const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
      if (update) {
        setAvailableUpdate(update);
        setDismissedUpdateVersion(null);
      } else {
        setUpToDate(true);
      }
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    if (!availableUpdate) return;
    setInstallingUpdate(true);
    setUpdateError(null);
    let downloaded = 0;
    let total: number | undefined;
    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateInstallPct(total ? Math.round((downloaded / total) * 100) : null);
        }
      });
      await relaunch();
    } catch (e) {
      setInstallingUpdate(false);
      setUpdateError(String(e));
    }
  }

  function handleDismissUpdate() {
    if (availableUpdate) setDismissedUpdateVersion(availableUpdate.version);
  }

  function handleChatScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // Saves the outgoing conversation's in-progress draft and restores the
  // incoming one's, so switching conversations mid-type doesn't leak text
  // into the wrong discussion or silently drop what you were writing.
  function switchDraft(newKey: string) {
    draftsRef.current.set(currentConv?.id ?? "", input);
    setInput(draftsRef.current.get(newKey) ?? "");
  }

  function handleNewConversation() {
    if (!selectedModel) return;
    const id = crypto.randomUUID();
    switchDraft(id);
    setCurrentConv({
      id,
      title: NEW_CONV_TITLE,
      model: selectedModel,
      created_at: Date.now() / 1000,
      messages: [],
    });
    setView("chat");
  }

  async function handleSelectConversation(id: string) {
    const conv = await loadConversation(id);
    switchDraft(id);
    setCurrentConv(conv);
    if (models.some((m) => m.name === conv.model)) setSelectedModel(conv.model);
    setView("chat");
  }

  async function handleDeleteConversation(id: string) {
    if (!window.confirm("Supprimer définitivement cette discussion ?")) return;
    await deleteConversation(id);
    draftsRef.current.delete(id);
    if (currentConv?.id === id) {
      setInput("");
      setCurrentConv(null);
    }
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
    if (!currentConv || sending || !selectedModel) return;
    const msgs = currentConv.messages;
    if (msgs.length === 0 || msgs[msgs.length - 1].role !== "assistant") return;
    const truncated = msgs.slice(0, -1);
    // Uses whichever model is picked in the dropdown right now, not
    // necessarily the one the conversation was started with — pick a
    // different model first, then regenerate, to answer with it instead.
    setCurrentConv({ ...currentConv, model: selectedModel, messages: truncated });
    submitToOllama(truncated, selectedModel);
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

  function handlePersistControlMeModel(model: string) {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, gemini_model: model };
      saveSettings(next);
      return next;
    });
  }

  // generate_remote_code/clear_remote_code already persist settings.json on
  // the Rust side (see remote.rs) — this just syncs the already-saved
  // value into React state, no second saveSettings call needed.
  function handleRemoteCodeChanged(code: string | null) {
    setSettings((prev) => (prev ? { ...prev, remote_code: code } : prev));
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
        view={view}
        onNew={handleNewConversation}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
        onOpenSettings={() => setView("settings")}
        onOpenInstall={() => setShowInstall(true)}
        onOpenCodex={() => setView("codex")}
        onOpenControlMe={() => setView("controlme")}
      />

      {view === "codex" && settings ? (
        <Suspense fallback={<div className="codex-editor-empty">Chargement de l'éditeur…</div>}>
          <CodexView
            settings={settings}
            models={models}
            onPersistCodexPrefs={handlePersistCodexPrefs}
          />
        </Suspense>
      ) : view === "controlme" && settings ? (
        <Suspense fallback={<div className="codex-editor-empty">Chargement…</div>}>
          <ControlMeView
            settings={settings}
            onPersistModel={handlePersistControlMeModel}
          />
        </Suspense>
      ) : view === "settings" && settings ? (
        <Suspense fallback={<div className="codex-editor-empty">Chargement…</div>}>
          <SettingsView
            settings={settings}
            models={models}
            remoteConnected={remoteConnected}
            onSave={handleSaveSettings}
            onRefreshModels={() => refreshModels(settings.ollama_host)}
            onPersistModel={handlePersistControlMeModel}
            onRemoteCodeChanged={handleRemoteCodeChanged}
            checkingUpdate={checkingUpdate}
            upToDate={upToDate}
            updateError={updateError}
            availableUpdate={availableUpdate}
            installingUpdate={installingUpdate}
            updateInstallPct={updateInstallPct}
            onCheckUpdate={handleCheckUpdate}
            onInstallUpdate={handleInstallUpdate}
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
            // Keyed on the conversation id and set to display:contents (invisible
            // to layout) purely so switching conversations forces a full remount
            // of the message list — every bubble replays its entrance animation
            // instead of only the ones past the previous conversation's length.
            <div key={currentConv?.id ?? "empty"} className="chat-messages">
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
                  <div key={i} className="message-row" style={{ "--i": i } as CSSProperties}>
                    <MessageBubble role={m.role} content={m.content} />
                    <div className={`message-actions message-actions-${m.role}`}>
                      {m.role === "user" && !sending && (
                        <button onClick={() => startEdit(i, m.content)}>Modifier</button>
                      )}
                      {m.role === "assistant" && i === messages.length - 1 && !sending && (
                        <button onClick={handleRegenerate} title="Choisis un autre modèle dans le menu pour régénérer avec">
                          Régénérer{selectedModel && selectedModel !== currentConv?.model ? ` avec ${selectedModel}` : ""}
                        </button>
                      )}
                    </div>
                  </div>
                ),
              )}
              {sending && <MessageBubble role="assistant" content={streamingText || "· · ·"} streaming />}
            </div>
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

      {showInstall && settings && (
        <HuggingFaceBrowser
          host={settings.ollama_host}
          ramGb={ramGb}
          onClose={() => setShowInstall(false)}
          onInstalled={() => refreshModels(settings.ollama_host)}
        />
      )}

      {availableUpdate && availableUpdate.version !== dismissedUpdateVersion && view !== "settings" && (
        <div className="update-toast">
          <div className="update-toast-text">
            <strong>Nouvelle version disponible : {availableUpdate.version}</strong>
            {installingUpdate ? (
              <span>
                Téléchargement et installation…{updateInstallPct !== null ? ` ${updateInstallPct}%` : ""}
              </span>
            ) : (
              updateError && <span className="update-toast-error">{updateError}</span>
            )}
          </div>
          {!installingUpdate && (
            <div className="update-toast-actions">
              <button onClick={handleDismissUpdate}>Plus tard</button>
              <button className="primary-btn" onClick={handleInstallUpdate}>
                Installer
              </button>
            </div>
          )}
        </div>
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
