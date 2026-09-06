import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AgentChatResponse,
  AgentMessage,
  ChatMessage,
  ControlMeMemoryEntry,
  ControlMeSession,
  ControlMeSessionMeta,
  ControlMeStep,
  Conversation,
  ConversationMeta,
  DirEntry,
  EditResult,
  HfModel,
  OllamaModel,
  PublicSkillMeta,
  Settings,
  Skill,
  SkillMeta,
} from "./types";

export const listModels = (host: string) => invoke<OllamaModel[]>("list_models", { host });

export const sendChat = (host: string, model: string, messages: ChatMessage[]) =>
  invoke<void>("send_chat", { host, model, messages });

export const cancelChat = () => invoke<void>("cancel_chat");

export const installModel = (host: string, reference: string) =>
  invoke<void>("install_model", { host, reference });

export const deleteModel = (host: string, name: string) => invoke<void>("delete_model", { host, name });

export const listConversations = () => invoke<ConversationMeta[]>("list_conversations");
export const searchConversations = (query: string) =>
  invoke<ConversationMeta[]>("search_conversations", { query });
export const loadConversation = (id: string) => invoke<Conversation>("load_conversation", { id });
export const saveConversation = (conversation: Conversation) =>
  invoke<void>("save_conversation", { conversation });
export const deleteConversation = (id: string) => invoke<void>("delete_conversation", { id });

export const loadSettings = () => invoke<Settings>("load_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });

export interface ChatDonePayload {
  content: string;
  eval_count: number;
  prompt_eval_count: number;
}

export interface InstallProgressPayload {
  status: string;
  completed: number;
  total: number;
}

export const onChatChunk = (cb: (content: string) => void) =>
  listen<{ content: string }>("chat-chunk", (e) => cb(e.payload.content));

export const onChatDone = (cb: (payload: ChatDonePayload) => void) =>
  listen<ChatDonePayload>("chat-done", (e) => cb(e.payload));

export const onChatCancelled = (cb: (payload: ChatDonePayload) => void) =>
  listen<ChatDonePayload>("chat-cancelled", (e) => cb(e.payload));

export const onChatError = (cb: (message: string) => void) =>
  listen<{ message: string }>("chat-error", (e) => cb(e.payload.message));

export const onInstallProgress = (cb: (payload: InstallProgressPayload) => void) =>
  listen<InstallProgressPayload>("install-progress", (e) => cb(e.payload));

export const onInstallDone = (cb: () => void) => listen("install-done", () => cb());

export const onInstallError = (cb: (message: string) => void) =>
  listen<{ message: string }>("install-error", (e) => cb(e.payload.message));

// ------------------------------------------------------------------ Codex

export const pickFolder = () => open({ directory: true, multiple: false });

export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });

export const readFileText = (path: string) => invoke<string>("read_file_text", { path });

export const writeFileText = (path: string, content: string) =>
  invoke<void>("write_file_text", { path, content });

export const editFileText = (
  path: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
) =>
  invoke<EditResult>("edit_file_text", {
    path,
    oldString,
    newString,
    replaceAll,
  });

export const runPowershellCommand = (command: string, cwd?: string, timeoutSecs?: number) =>
  invoke<void>("run_powershell_command", { command, cwd, timeoutSecs });

export const cancelShellCommand = () => invoke<void>("cancel_shell_command");

export interface ShellOutputPayload {
  stream: "stdout" | "stderr";
  line: string;
}

export const onShellOutput = (cb: (payload: ShellOutputPayload) => void) =>
  listen<ShellOutputPayload>("shell-output", (e) => cb(e.payload));

export const onShellDone = (cb: (exitCode: number | null) => void) =>
  listen<{ exit_code: number | null }>("shell-done", (e) => cb(e.payload.exit_code));

export const onShellError = (cb: (message: string) => void) =>
  listen<{ message: string }>("shell-error", (e) => cb(e.payload.message));

export const onShellTimeout = (cb: (message: string) => void) =>
  listen<{ message: string }>("shell-timeout", (e) => cb(e.payload.message));

export const agentChat = (
  host: string,
  model: string,
  messages: AgentMessage[],
  tools: object[],
) => invoke<AgentChatResponse>("agent_chat", { host, model, messages, tools });

export const onAgentChatChunk = (cb: (content: string) => void) =>
  listen<{ content: string }>("agent-chat-chunk", (e) => cb(e.payload.content));

export const cancelAgentChat = () => invoke<void>("cancel_agent_chat");

export const searchHfModels = (query: string) => invoke<HfModel[]>("search_hf_models", { query });

export const getSystemRamGb = () => invoke<number>("get_system_ram_gb");

export const closeApp = () => invoke<void>("close_app");

export const onFreezeWarning = (cb: (stalledSecs: number) => void) =>
  listen<{ stalled_secs: number }>("freeze-warning", (e) => cb(e.payload.stalled_secs));

export const onFreezeResolved = (cb: () => void) => listen("freeze-resolved", () => cb());

// ------------------------------------------------------------ Control Me

export const runControlMe = (
  apiKey: string,
  model: string,
  instruction: string,
  activeSkillIds: string[],
  // Set while the user is recording this conversation into a skill: it gates
  // the add_to_skill tool and is the only skill the model can write to.
  recordingSkillId: string | null,
  /** Lesson rather than task: the model listens and writes the procedure
   * down instead of carrying it out. */
  teaching = false,
) => invoke<void>("run_control_me", { apiKey, model, instruction, activeSkillIds, recordingSkillId, teaching });

export const cancelControlMe = () => invoke<void>("cancel_control_me");

export const onControlMeStep = (cb: (step: ControlMeStep) => void) =>
  listen<{ intent: string | null; action: string; label: string }>("control-me-step", (e) =>
    cb({ thought: e.payload.intent, action: e.payload.action, args: { label: e.payload.label } }),
  );

export const onControlMeMessage = (cb: (text: string) => void) =>
  listen<{ text: string }>("control-me-message", (e) => cb(e.payload.text));

export const onControlMeDone = (cb: (summary: string) => void) =>
  listen<{ summary: string }>("control-me-done", (e) => cb(e.payload.summary));

export const onControlMeError = (cb: (message: string) => void) =>
  listen<{ message: string }>("control-me-error", (e) => cb(e.payload.message));

export const onControlMeCancelled = (cb: () => void) => listen("control-me-cancelled", () => cb());

export const onControlMeLimit = (cb: () => void) => listen("control-me-limit", () => cb());

export const onControlMeConfirmationRequired = (cb: (payload: { action: string; explanation: string }) => void) =>
  listen<{ action: string; explanation: string }>("control-me-confirmation-required", (e) => cb(e.payload));

export const resolveControlMeConfirmation = (accept: boolean) =>
  invoke<void>("resolve_control_me_confirmation", { accept });

export const listControlMeMemory = () => invoke<ControlMeMemoryEntry[]>("list_control_me_memory");

export const clearControlMeMemory = () => invoke<void>("clear_control_me_memory");

export const listControlMeSessions = () => invoke<ControlMeSessionMeta[]>("list_control_me_sessions");
export const searchControlMeSessions = (query: string) =>
  invoke<ControlMeSessionMeta[]>("search_control_me_sessions", { query });
export const loadControlMeSession = (id: string) => invoke<ControlMeSession>("load_control_me_session", { id });
export const saveControlMeSession = (session: ControlMeSession) =>
  invoke<void>("save_control_me_session", { session });
export const deleteControlMeSession = (id: string) => invoke<void>("delete_control_me_session", { id });

// ------------------------------------------------------- Control Me remote

export const generateRemoteCode = () => invoke<string>("generate_remote_code");
export const clearRemoteCode = () => invoke<void>("clear_remote_code");

export const onRemoteViewerChanged = (cb: (connected: boolean) => void) =>
  listen<{ connected: boolean }>("remote-viewer-changed", (e) => cb(e.payload.connected));

// ------------------------------------------------- "DB ready" knowledge base

export const openSkillsFolder = () => invoke<void>("open_skills_folder");
export const listSkills = () => invoke<SkillMeta[]>("list_skills");
export const loadSkill = (id: string) => invoke<Skill>("load_skill", { id });
export const saveNewSkill = (name: string, description: string, content: string) =>
  invoke<Skill>("save_new_skill", { name, description, content });
export const updateSkill = (skill: Skill) => invoke<void>("update_skill", { skill });
export const deleteSkill = (id: string) => invoke<void>("delete_skill", { id });
export const publishSkill = (id: string) => invoke<string>("publish_skill", { id });
export const unpublishSkill = (id: string) => invoke<void>("unpublish_skill", { id });
export const downloadSkill = (shareCode: string) => invoke<Skill>("download_skill", { shareCode });
export const listPublicSkills = () => invoke<PublicSkillMeta[]>("list_public_skills");
export const extractSkillFromTranscript = (
  apiKey: string,
  model: string,
  existingContent: string,
  transcript: string,
) => invoke<string>("extract_skill_from_transcript", { apiKey, model, existingContent, transcript });
// Fallback path when the browser's own speech recognition is unavailable
// (see audioRecorder.ts). Needs the user's Gemini key, same as Control Me.
export const transcribeAudio = (apiKey: string, model: string, audioBase64: string, mimeType: string) =>
  invoke<string>("transcribe_audio", { apiKey, model, audioBase64, mimeType });

export const openWindowsSettings = (page: "sound" | "microphone-privacy") =>
  invoke<void>("open_windows_settings", { page });

export const importMarketplaceExtension = (extensionId: string) =>
  invoke<Skill>("import_marketplace_extension", { extensionId });
