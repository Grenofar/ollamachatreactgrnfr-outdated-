import Editor, { type OnMount } from "@monaco-editor/react";
import "../../monacoSetup";
import { languageForPath } from "../../fileLang";
import type { OpenFile } from "../../types";

export default function EditorPane({
  openFiles,
  activePath,
  onSelectTab,
  onCloseTab,
  onChange,
  onSave,
}: {
  openFiles: OpenFile[];
  activePath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
}) {
  const active = openFiles.find((f) => f.path === activePath) ?? null;

  const handleMount: OnMount = (editorInstance, monaco) => {
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (active) onSave(active.path);
    });
  };

  return (
    <div className="codex-editor">
      <div className="editor-tabs">
        {openFiles.map((f) => (
          <div
            key={f.path}
            className={`editor-tab ${f.path === activePath ? "editor-tab-active" : ""} ${
              f.dirty ? "editor-tab-dirty" : ""
            }`}
            onClick={() => onSelectTab(f.path)}
          >
            <span>{f.path.split(/[\\/]/).pop()}</span>
            <span
              className="editor-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(f.path);
              }}
            >
              ✕
            </span>
          </div>
        ))}
      </div>

      {active ? (
        <Editor
          key={active.path}
          language={languageForPath(active.path)}
          value={active.content}
          theme="vs-dark"
          onMount={handleMount}
          onChange={(value) => onChange(active.path, value ?? "")}
          options={{ fontSize: 13, minimap: { enabled: false }, automaticLayout: true }}
        />
      ) : (
        <div className="codex-editor-empty">Ouvre un fichier depuis l'arborescence à gauche.</div>
      )}
    </div>
  );
}
