import { useCallback, useEffect, useRef, useState } from "react";
import {
  agentChat,
  cancelAgentChat,
  editFileText,
  listDir,
  onAgentChatChunk,
  onShellDone,
  onShellError,
  onShellOutput,
  onShellTimeout,
  readFileText,
  runPowershellCommand,
  writeFileText,
} from "../api";
import { AGENT_TOOLS, ASK_USER_TOOL, MAX_AGENT_ITERATIONS, MUTATING_TOOLS } from "../agentTools";
import type { AgentMessage, AgentToolCall } from "../types";

export type AgentStatus =
  | "idle"
  | "waiting-llm"
  | "running-tool"
  | "awaiting-approval"
  | "awaiting-question"
  | "awaiting-continue"
  | "error";

export interface ApprovalRequest {
  toolCall: AgentToolCall;
  kind: "write" | "edit" | "command";
  path?: string;
  oldContent?: string;
  newContent?: string;
  command?: string;
}

export interface QuestionRequest {
  question: string;
  options?: string[];
}

export interface ContinueRequest {
  iterations: number;
}

const CANCELLED_MESSAGE = "Annulé par l'utilisateur.";

// Fallback for models that, despite the system prompt, sometimes write a
// command as a plain markdown code block instead of issuing a real
// run_powershell_command tool call. Only a small allowlist of shell-ish
// fence languages qualifies, so an illustrative Python/JS/Rust snippet in
// an explanation is never mistaken for an intended command.
const SHELL_FENCE_RE = /```(?:powershell|ps1|pwsh|cmd|bash|shell|sh)\s*\n([\s\S]*?)```/i;

function extractFallbackCommand(content: string): string | null {
  const match = content.match(SHELL_FENCE_RE);
  const command = match?.[1]?.trim();
  return command ? command : null;
}

// Second, more general fallback — found by actually testing this app's own
// system prompt + tool schema against the model installed and selected in
// this environment (qwen2.5-coder:3b), not assumed to be fixed by the
// markdown-fence fallback above. That model, despite Ollama reporting
// "tools" as a supported capability for it, doesn't reliably populate the
// API's structured tool_calls field — instead it sometimes writes the
// intended call as plain JSON *text* in the message content, e.g.:
//   {"name": "run_powershell_command", "arguments": {"command": "..."}}
// with no code fence at all, so SHELL_FENCE_RE never matches it either —
// the previous fallback only covered one specific way small models get
// this wrong, not this one. Also observed: the value itself sometimes
// nested one level too deep, mimicking the tool's own JSON-schema shape
// instead of a flat argument — e.g. {"command": {"type": "string",
// "value": "..."}} instead of {"command": "..."} — unwrapped below.
const KNOWN_TOOL_NAMES = new Set([
  "read_file",
  "list_dir",
  "write_file",
  "edit_file",
  "run_powershell_command",
  ASK_USER_TOOL,
]);

function unwrapSchemaShapedValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).value;
  }
  return value;
}

function extractFallbackJsonToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
  const trimmed = content.trim();
  const candidates = [trimmed];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first && (first !== 0 || last !== trimmed.length - 1)) {
    candidates.push(trimmed.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed as Record<string, unknown>;
    const func = obj.function && typeof obj.function === "object" ? (obj.function as Record<string, unknown>) : null;
    const name = (func?.name ?? obj.name) as unknown;
    const rawArgs = (func?.arguments ?? obj.arguments) as unknown;
    if (typeof name !== "string" || !KNOWN_TOOL_NAMES.has(name)) continue;
    if (!rawArgs || typeof rawArgs !== "object") continue;
    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawArgs as Record<string, unknown>)) {
      args[key] = unwrapSchemaShapedValue(value);
    }
    return { name, arguments: args };
  }
  return null;
}

function useResolvablePrompt<TPayload, TResult>() {
  const resolverRef = useRef<((v: TResult) => void) | null>(null);
  const [pending, setPending] = useState<TPayload | null>(null);

  const request = useCallback((payload: TPayload) => {
    return new Promise<TResult>((resolve) => {
      resolverRef.current = resolve;
      setPending(payload);
    });
  }, []);

  const resolve = useCallback((value: TResult) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setPending(null);
  }, []);

  return { pending, request, resolve };
}

async function runCommandAndCollect(
  command: string,
  cwd: string | undefined,
  timeoutSecs: number | undefined,
  onLine?: (line: string) => void,
): Promise<string> {
  const lines: string[] = [];
  let settled = false;
  let resolvePromise!: (value: string) => void;
  const result = new Promise<string>((resolve) => {
    resolvePromise = resolve;
  });

  const finish = (summary: string) => {
    if (settled) return;
    settled = true;
    Promise.all(unlistens).then((fns) => fns.forEach((f) => f()));
    const body = lines.length ? lines.join("\n") : "(aucune sortie)";
    resolvePromise(`${summary}\n${body}`);
  };

  // Registration itself is async IPC to the Rust side, so all four listeners
  // must be confirmed attached before the command is launched — otherwise a
  // command that completes very fast could emit shell-done before the
  // listener exists, silently hanging this promise forever.
  const unlistens = await Promise.all([
    onShellOutput((p) => {
      const formatted = `[${p.stream}] ${p.line}`;
      lines.push(formatted);
      onLine?.(formatted);
    }),
    onShellDone((code) => finish(`Commande terminée (code de sortie ${code ?? "inconnu"})`)),
    onShellError((message) => finish(`Erreur : ${message}`)),
    onShellTimeout((message) => finish(message)),
  ]);

  runPowershellCommand(command, cwd, timeoutSecs).catch((e) => finish(`Erreur de lancement : ${String(e)}`));

  return result;
}

export function useAgentLoop(opts: {
  host: string;
  model: string;
  systemPrompt: string;
  mode: "auto" | "approve";
  onFileChanged?: (path: string) => void;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [runningToolId, setRunningToolId] = useState<string | null>(null);
  const [runningOutput, setRunningOutput] = useState("");
  const iterationRef = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const approval = useResolvablePrompt<ApprovalRequest, boolean>();
  const question = useResolvablePrompt<QuestionRequest, string>();
  const continuePrompt = useResolvablePrompt<ContinueRequest, boolean>();

  useEffect(() => {
    const unlisten = onAgentChatChunk((content) => setStreamingText((prev) => prev + content));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const executeTool = useCallback(async (tc: AgentToolCall): Promise<string> => {
    const args = tc.arguments ?? {};
    const mode = optsRef.current.mode;
    try {
      switch (tc.name) {
        case "read_file":
          return await readFileText(String(args.path));

        case "list_dir": {
          const entries = await listDir(String(args.path));
          return JSON.stringify(entries);
        }

        case "write_file": {
          if (mode === "approve") {
            const accepted = await approval.request({
              toolCall: tc,
              kind: "write",
              path: String(args.path),
              newContent: String(args.content ?? ""),
            });
            if (!accepted) return "L'utilisateur a refusé cette action.";
            setStatus("running-tool");
          }
          await writeFileText(String(args.path), String(args.content ?? ""));
          optsRef.current.onFileChanged?.(String(args.path));
          return `Fichier écrit : ${args.path}`;
        }

        case "edit_file": {
          const oldContent = await readFileText(String(args.path)).catch(() => "");
          if (mode === "approve") {
            const accepted = await approval.request({
              toolCall: tc,
              kind: "edit",
              path: String(args.path),
              oldContent,
              newContent: oldContent
                .replace(String(args.old_string ?? ""), String(args.new_string ?? "")),
            });
            if (!accepted) return "L'utilisateur a refusé cette action.";
            setStatus("running-tool");
          }
          const result = await editFileText(
            String(args.path),
            String(args.old_string ?? ""),
            String(args.new_string ?? ""),
            Boolean(args.replace_all),
          );
          optsRef.current.onFileChanged?.(String(args.path));
          return `Fichier modifié (${result.replaced_count} remplacement(s)) : ${args.path}`;
        }

        case "run_powershell_command": {
          const command = String(args.command ?? "");
          if (mode === "approve") {
            const accepted = await approval.request({ toolCall: tc, kind: "command", command });
            if (!accepted) return "L'utilisateur a refusé cette action.";
            setStatus("running-tool");
          }
          setRunningOutput("");
          return await runCommandAndCollect(
            command,
            args.cwd ? String(args.cwd) : undefined,
            typeof args.timeout_secs === "number" ? args.timeout_secs : undefined,
            (line) => setRunningOutput((prev) => (prev ? `${prev}\n${line}` : line)),
          );
        }

        case ASK_USER_TOOL: {
          const opts = Array.isArray(args.options) ? args.options.map(String) : undefined;
          return await question.request({ question: String(args.question ?? ""), options: opts });
        }

        default:
          return `Outil inconnu : ${tc.name}`;
      }
    } catch (e) {
      return `Erreur : ${String(e)}`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval, question]);

  const runTurn = useCallback(async (history: AgentMessage[]) => {
    setStatus("waiting-llm");
    setError(null);
    setNotice(null);
    setStreamingText("");
    let msgs = history;
    try {
      const resp = await agentChat(optsRef.current.host, optsRef.current.model, msgs, AGENT_TOOLS);
      setStreamingText("");

      let toolCalls = resp.tool_calls;
      if (toolCalls.length === 0) {
        const fallbackCommand = extractFallbackCommand(resp.content);
        if (fallbackCommand) {
          toolCalls = [{ id: "fallback_1", name: "run_powershell_command", arguments: { command: fallbackCommand } }];
        } else {
          const fallbackJson = extractFallbackJsonToolCall(resp.content);
          if (fallbackJson) {
            toolCalls = [{ id: "fallback_1", name: fallbackJson.name, arguments: fallbackJson.arguments }];
          }
        }
      }

      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: resp.content,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      };
      msgs = [...msgs, assistantMsg];
      setMessages(msgs);

      if (toolCalls.length === 0) {
        setStatus("idle");
        iterationRef.current = 0;
        return;
      }

      iterationRef.current += 1;
      if (iterationRef.current > MAX_AGENT_ITERATIONS) {
        setStatus("awaiting-continue");
        const shouldContinue = await continuePrompt.request({ iterations: iterationRef.current });
        if (!shouldContinue) {
          setStatus("idle");
          iterationRef.current = 0;
          return;
        }
        iterationRef.current = 0;
      }

      for (const tc of toolCalls) {
        setRunningToolId(tc.id);
        setRunningOutput("");
        setStatus(
          tc.name === ASK_USER_TOOL
            ? "awaiting-question"
            : MUTATING_TOOLS.has(tc.name) && optsRef.current.mode === "approve"
              ? "awaiting-approval"
              : "running-tool",
        );
        const result = await executeTool(tc);
        setRunningToolId(null);
        msgs = [...msgs, { role: "tool", content: result, toolName: tc.name }];
        setMessages(msgs);
      }

      await runTurn(msgs);
    } catch (e) {
      if (String(e).includes(CANCELLED_MESSAGE)) {
        iterationRef.current = 0;
        setStatus("idle");
        setNotice("Génération annulée.");
      } else {
        setStatus("error");
        setError(String(e));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeTool, continuePrompt]);

  const sendUserMessage = useCallback(
    (text: string) => {
      const withSystem: AgentMessage[] =
        messages.length === 0 && optsRef.current.systemPrompt.trim()
          ? [{ role: "system", content: optsRef.current.systemPrompt.trim() }]
          : messages;
      const next: AgentMessage[] = [...withSystem, { role: "user", content: text }];
      setMessages(next);
      iterationRef.current = 0;
      runTurn(next);
    },
    [messages, runTurn],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setStatus("idle");
    setError(null);
    setNotice(null);
    iterationRef.current = 0;
  }, []);

  const cancel = useCallback(() => {
    cancelAgentChat().catch(() => {});
  }, []);

  return {
    messages,
    status,
    error,
    notice,
    streamingText,
    runningToolId,
    runningOutput,
    sendUserMessage,
    cancel,
    reset,
    pendingApproval: approval.pending,
    resolveApproval: approval.resolve,
    pendingQuestion: question.pending,
    resolveQuestion: question.resolve,
    pendingContinue: continuePrompt.pending,
    resolveContinue: continuePrompt.resolve,
  };
}
