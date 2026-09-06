import { useMemo, type CSSProperties, type MouseEvent } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

marked.use({
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const encoded = toBase64(text);
      return `<div class="code-block"><div class="code-block-header"><span>${escapeHtml(
        lang || "code",
      )}</span><button class="code-copy-btn" data-code="${encoded}">Copier</button></div><pre><code>${escapeHtml(
        text,
      )}</code></pre></div>`;
    },
  },
});

export function renderMarkdown(content: string): string {
  const html = marked.parse(content, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["data-code"] });
}

export default function MessageBubble({
  role,
  content,
  streaming,
  style,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  /** True only for the single live bubble being streamed into — swaps the
   * "· · ·" placeholder for an animated typing indicator and shows a
   * blinking cursor once real text starts arriving. */
  streaming?: boolean;
  style?: CSSProperties;
}) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  const isTypingPlaceholder = streaming && content.trim() === "· · ·";
  async function handleClick(e: MouseEvent<HTMLDivElement>) {
    const btn = (e.target as HTMLElement).closest(".code-copy-btn") as HTMLButtonElement | null;
    if (!btn) return;
    const encoded = btn.dataset.code ?? "";
    try {
      await writeText(fromBase64(encoded));
      const original = btn.textContent;
      btn.textContent = "Copié !";
      setTimeout(() => {
        btn.textContent = original;
      }, 1200);
    } catch {
      // clipboard unavailable: silently do nothing rather than show an error for a copy button
    }
  }

  return (
    <div className={`bubble-row bubble-row-${role}`} style={style}>
      {isTypingPlaceholder ? (
        <div className={`bubble bubble-${role} bubble-markdown bubble-typing`}>
          <span className="typing-dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      ) : (
        <div
          className={`bubble bubble-${role} bubble-markdown ${streaming ? "bubble-streaming" : ""}`}
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
