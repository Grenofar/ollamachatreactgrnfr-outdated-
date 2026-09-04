import { useState, useMemo, type CSSProperties, type MouseEvent } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isSpeechSynthesisSupported, speak, stopSpeaking } from "../voice";

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
  const [speaking, setSpeaking] = useState(false);

  function toggleReadAloud() {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    // Strip markdown syntax that would otherwise be read aloud literally
    // ("astérisque astérisque gras astérisque astérisque") — a plain-text
    // approximation, not a real parser, but good enough for speech.
    const plain = content.replace(/```[\s\S]*?```/g, "").replace(/[*_`#>[\]()]/g, "");
    speak(plain);
    setSpeaking(true);
    // speechSynthesis has no "done" promise — polling is the documented
    // way to know when an utterance actually finishes, so the button can
    // revert on its own instead of staying stuck on "stop" forever.
    const check = setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        setSpeaking(false);
        clearInterval(check);
      }
    }, 300);
  }

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
      {role === "assistant" && !streaming && content.trim() && isSpeechSynthesisSupported() && (
        <button
          className={`read-aloud-btn ${speaking ? "read-aloud-btn-active" : ""}`}
          onClick={toggleReadAloud}
          title={speaking ? "Arrêter la lecture" : "Lire à voix haute"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        </button>
      )}
    </div>
  );
}
