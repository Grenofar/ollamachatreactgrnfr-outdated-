import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AgentChatResponse,
  AgentMessage,
  ChatMessage,
  Conversation,
  ConversationMeta,
  DirEntry,
  EditResult,
  HfModel,
  OllamaModel,
  Settings,
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

export const cancelAgentChat = () => invoke<void>("cancel_agent_chat");

export const searchHfModels = (query: string) => invoke<HfModel[]>("search_hf_models", { query });

export const getSystemRamGb = () => invoke<number>("get_system_ram_gb");

export const closeApp = () => invoke<void>("close_app");

export const onFreezeWarning = (cb: (stalledSecs: number) => void) =>
  listen<{ stalled_secs: number }>("freeze-warning", (e) => cb(e.payload.stalled_secs));

export const onFreezeResolved = (cb: () => void) => listen("freeze-resolved", () => cb());
