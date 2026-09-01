// Small colored letter badges instead of file icons — no emoji (project
// convention) and no icon font/image set added just for this. Colors
// loosely follow VS Code's own per-language icon colors so the file tree
// reads similarly at a glance (blue TS, yellow JS, orange Rust...).
const BADGES: Record<string, { label: string; color: string }> = {
  ts: { label: "TS", color: "#3b82f6" },
  tsx: { label: "TSX", color: "#3b82f6" },
  js: { label: "JS", color: "#eab308" },
  jsx: { label: "JSX", color: "#eab308" },
  json: { label: "{}", color: "#facc15" },
  css: { label: "CSS", color: "#60a5fa" },
  scss: { label: "SCSS", color: "#f472b6" },
  html: { label: "HTML", color: "#f97316" },
  py: { label: "PY", color: "#3b82f6" },
  rs: { label: "RS", color: "#f97316" },
  md: { label: "MD", color: "#94a3b8" },
  yml: { label: "YML", color: "#a78bfa" },
  yaml: { label: "YML", color: "#a78bfa" },
  toml: { label: "TOML", color: "#a78bfa" },
  sh: { label: "SH", color: "#4ade80" },
  ps1: { label: "PS1", color: "#3b82f6" },
  sql: { label: "SQL", color: "#f472b6" },
  xml: { label: "XML", color: "#f97316" },
  c: { label: "C", color: "#60a5fa" },
  h: { label: "H", color: "#60a5fa" },
  cpp: { label: "C++", color: "#60a5fa" },
  hpp: { label: "C++", color: "#60a5fa" },
  cs: { label: "C#", color: "#a78bfa" },
  java: { label: "JAVA", color: "#f97316" },
  go: { label: "GO", color: "#38bdf8" },
  php: { label: "PHP", color: "#a78bfa" },
  rb: { label: "RB", color: "#f87171" },
};

const DEFAULT_BADGE = { label: "•", color: "#71717a" };

export function fileIconFor(name: string): { label: string; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return BADGES[ext] ?? DEFAULT_BADGE;
}
