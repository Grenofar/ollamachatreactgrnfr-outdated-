const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  py: "python",
  rs: "rust",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  sh: "shell",
  ps1: "powershell",
  sql: "sql",
  xml: "xml",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  java: "java",
  go: "go",
  php: "php",
  rb: "ruby",
};

export function languageForPath(path?: string): string {
  if (!path) return "plaintext";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}
