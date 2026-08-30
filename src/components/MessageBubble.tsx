import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

type Segment = { type: "text"; content: string } | { type: "code"; lang: string; code: string };

const CODE_FENCE_RE = /```(\w*)\n?([\s\S]*?)```/g;

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  CODE_FENCE_RE.lastIndex = 0;
  while ((m = CODE_FENCE_RE.exec(text))) {
    if (m.index > lastEnd) {
      segments.push({ type: "text", content: text.slice(lastEnd, m.index) });
    }
    segments.push({ type: "code", lang: m[1], code: m[2].replace(/^\n+|\n+$/g, "") });
    lastEnd = CODE_FENCE_RE.lastIndex;
  }
  if (lastEnd < text.length) {
    segments.push({ type: "text", content: text.slice(lastEnd) });
  }
  return segments.length ? segments : [{ type: "text", content: text }];
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{lang || "code"}</span>
        <button onClick={handleCopy}>{copied ? "Copié !" : "Copier"}</button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function MessageBubble({
  role,
  content,
}: {
  role: "user" | "assistant" | "system";
  content: string;
}) {
  const segments = parseSegments(content);

  return (
    <div className={`bubble-row bubble-row-${role}`}>
      <div className={`bubble bubble-${role}`}>
        {segments.map((seg, i) =>
          seg.type === "text" ? (
            seg.content.trim() ? (
              <p key={i} className="bubble-text">
                {seg.content.trim()}
              </p>
            ) : null
          ) : (
            <CodeBlock key={i} lang={seg.lang} code={seg.code} />
          ),
        )}
      </div>
    </div>
  );
}
