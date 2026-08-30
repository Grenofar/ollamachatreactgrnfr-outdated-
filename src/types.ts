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

