import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { pickFolder, readFileText, writeFileText } from "../../api";
import { CODEX_SYSTEM_PROMPT } from "../../agentTools";
import { useAgentLoop } from "../../hooks/useAgentLoop";
import type { OllamaModel, OpenFile, Settings } from "../../types";
import FileTree from "./FileTree";
import EditorPane from "./EditorPane";
import AgentTranscript from "./AgentTranscript";
import AskQuestionModal from "./AskQuestionModal";
import SendButton from "../SendButton";
import ModelSelect from "../ModelSelect";

const STATUS_LABEL: Record<string, string> = {
  idle: "",
  "waiting-llm": "L'agent réfléchit…",
  "running-tool": "L'agent travaille…",
  "awaiting-approval": "En attente de ton approbation…",
  "awaiting-question": "L'agent attend ta réponse…",
  "awaiting-continue": "Limite d'itérations atteinte…",
  error: "Erreur",
};

export default function CodexView({
  settings,
  models,
  onPersistCodexPrefs,
  onBack,
}: {
  settings: Settings;
  models: OllamaModel[];
  onPersistCodexPrefs: (mode: "auto" | "approve", lastFolder: string) => void;
  onBack: () => void;
}) {
  const [rootFolder, setRootFolder] = useState<string | null>(settings.codex_last_folder ?? null);
  const [mode, setMode] = useState<"auto" | "approve">(settings.codex_mode);
  const [selectedModel, setSelectedModel] = useState(settings.default_model || models[0]?.name || "");
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const handleFileChanged = (path: string) => {
    readFileText(path)
      .then((content) => {
        setOpenFiles((cur) => {
          const idx = cur.findIndex((f) => f.path === path);
          const freshFile = { path, content, originalContent: content, dirty: false };
          return idx === -1 ? [...cur, freshFile] : cur.map((f) => (f.path === path ? freshFile : f));
        });
        setActivePath(path);
      })
      .catch(() => {});
  };

  const agent = useAgentLoop({
    host: settings.ollama_host,
    model: selectedModel,
    systemPrompt: `${settings.system_prompt}\n\n${CODEX_SYSTEM_PROMPT}`,
    mode,
    onFileChanged: handleFileChanged,
  });

  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [agent.messages]);

  function handleTranscriptScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    if (!agent.pendingContinue) return;
    const shouldContinue = window.confirm(
      `L'agent a déjà fait ${agent.pendingContinue.iterations} actions d'affilée. Continuer ?`,
    );
    agent.resolveContinue(shouldContinue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.pendingContinue]);

  async function handlePickFolder() {
    const dir = await pickFolder();
    if (typeof dir === "string") {
      setRootFolder(dir);
      onPersistCodexPrefs(mode, dir);
    }
  }

  function handleModeChange(next: "auto" | "approve") {
    setMode(next);
    if (rootFolder) onPersistCodexPrefs(next, rootFolder);
  }

  async function openFile(path: string) {
    if (openFiles.some((f) => f.path === path)) {
      setActivePath(path);
      return;
    }
    try {
      const content = await readFileText(path);
      setOpenFiles((prev) => [...prev, { path, content, originalContent: content, dirty: false }]);
      setActivePath(path);
    } catch (e) {
      window.alert(`Impossible d'ouvrir ${path} : ${String(e)}`);
    }
  }

  function closeTab(path: string) {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path));
    if (activePath === path) {
      const remaining = openFiles.filter((f) => f.path !== path);
      setActivePath(remaining.length ? remaining[remaining.length - 1].path : null);
    }
  }

  function handleEditorChange(path: string, content: string) {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, content, dirty: content !== f.originalContent } : f)),
    );
  }

  async function handleSave(path: string) {
    const file = openFiles.find((f) => f.path === path);
    if (!file) return;
    try {
      await writeFileText(path, file.content);
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === path ? { ...f, originalContent: f.content, dirty: false } : f)),
      );
    } catch (e) {
      window.alert(`Impossible d'enregistrer ${path} : ${String(e)}`);
    }
  }

  function handleSend() {
    if (!input.trim() || !selectedModel) return;
    agent.sendUserMessage(input.trim());
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const busy = agent.status !== "idle" && agent.status !== "error";
  const thinking = agent.status === "waiting-llm";

  return (
    <div className="codex">
      <div className="codex-main">
        <div className="codex-header">
          <button onClick={onBack}>← Chat</button>
          <button onClick={handlePickFolder}>{rootFolder ? "Changer de dossier" : "Choisir un dossier"}</button>
          {rootFolder && <span className="codex-header-title">{rootFolder}</span>}
          <div className="codex-header-spacer" />
          <ModelSelect models={models} value={selectedModel} onChange={setSelectedModel} direction="down" />
          <div className="mode-toggle">
            <button
              className={mode === "approve" ? "mode-toggle-active" : ""}
              onClick={() => handleModeChange("approve")}
            >
              Approbation
            </button>
            <button className={mode === "auto" ? "mode-toggle-active" : ""} onClick={() => handleModeChange("auto")}>
              Auto
            </button>
          </div>
        </div>

        <div className="codex-body">
          {rootFolder ? (
            <FileTree
              rootPath={rootFolder}
              activePath={activePath}
              onOpenFile={openFile}
              onFileCreated={openFile}
            />
          ) : (
            <div className="codex-filetree">
              <div className="codex-filetree-empty">Choisis un dossier pour commencer.</div>
            </div>
          )}

          <EditorPane
            openFiles={openFiles}
            activePath={activePath}
            onSelectTab={setActivePath}
            onCloseTab={closeTab}
            onChange={handleEditorChange}
            onSave={handleSave}
          />

          <div className="codex-transcript">
            <AgentTranscript
              messages={agent.messages}
              scrollRef={scrollRef}
              onScroll={handleTranscriptScroll}
              streamingText={agent.streamingText}
              isThinking={agent.status === "waiting-llm"}
              runningToolId={agent.runningToolId}
              runningOutput={agent.runningOutput}
              pendingApproval={agent.pendingApproval}
              onResolveApproval={agent.resolveApproval}
            />
            {STATUS_LABEL[agent.status] && <div className="codex-status">{STATUS_LABEL[agent.status]}</div>}
            {agent.error && <div className="banner banner-error">{agent.error}</div>}
            {agent.notice && <div className="banner banner-info">{agent.notice}</div>}

            <div className="input-area">
              <div className="input-pill">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Demande une modification, une exploration, une commande…"
                  rows={2}
                  disabled={busy}
                />
                <div className="input-controls">
                  <SendButton
                    busy={thinking}
                    disabled={busy || !input.trim() || !selectedModel}
                    onSend={handleSend}
                    onStop={agent.cancel}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {agent.pendingQuestion && <AskQuestionModal request={agent.pendingQuestion} onAnswer={agent.resolveQuestion} />}
    </div>
  );
}
