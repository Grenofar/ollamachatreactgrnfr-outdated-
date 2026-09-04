export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StoredMessage extends ChatMessage {
  tokens?: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  created_at: number;
  messages: StoredMessage[];
}

export interface ConversationMeta {
  id: string;
  title: string;
  model: string;
  created_at: number;
  total_tokens: number;
}

export interface Settings {
  ollama_host: string;
  max_context_tokens: number;
  system_prompt: string;
  default_model?: string | null;
  codex_mode: "auto" | "approve";
  codex_last_folder?: string | null;
  gemini_api_key?: string | null;
  gemini_model: string;
  remote_code?: string | null;
  control_me_perception_mode: "capture" | "windows_ui";
  control_me_action_mode: "live" | "predefined";
  disabled_extensions: string[];
  update_popup_enabled: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface EditResult {
  new_content: string;
  replaced_count: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AgentRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  role: AgentRole;
  content: string;
  tool_calls?: AgentToolCall[];
  /** Client-side only (for display), never required by the Ollama wire format. */
  toolName?: string;
}

export interface AgentChatResponse {
  content: string;
  tool_calls: AgentToolCall[];
}

export interface OpenFile {
  path: string;
  content: string;
  originalContent: string;
  dirty: boolean;
}

export interface OllamaModel {
  name: string;
  size: number;
  parameter_size?: string | null;
  quantization_level?: string | null;
}

export interface HfModel {
  id: string;
  downloads: number;
  likes: number;
  tags: string[];
}

export interface ControlMeStep {
  thought?: string | null;
  action: string;
  args: Record<string, unknown>;
}

export interface ControlMeMemoryEntry {
  fact: string;
  category?: string | null;
  created_at: number;
}

export interface ControlMeSessionEntry {
  role: string;
  content: string;
}

export interface ControlMeSession {
  id: string;
  title: string;
  created_at: number;
  entries: ControlMeSessionEntry[];
}

export interface ControlMeSessionMeta {
  id: string;
  title: string;
  created_at: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  is_public: boolean;
  share_code?: string | null;
  created_at: number;
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  is_public: boolean;
  share_code?: string | null;
  created_at: number;
}

export interface PublicSkillMeta {
  name: string;
  description: string;
  share_code: string;
}

