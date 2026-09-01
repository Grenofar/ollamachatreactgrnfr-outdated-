import { useEffect, useRef } from "react";
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

  // Monaco's onMount fires exactly once per editor instance (per open tab,
  // since <Editor key={active.path}> remounts on tab switch but not on
  // every keystroke) — the addCommand callback below is a native keybinding
  // registered at that single moment, so a plain closure over `onSave`
  // freezes it to whatever CodexView.tsx's handleSave reference was at
  // mount time. handleSave itself closes over openFiles fresh each
  // CodexView render, so calling a stale reference meant Ctrl+S wrote
  // whatever the file's content was WHEN THE TAB WAS OPENED, silently
  // ignoring every edit made since (while still clearing the "dirty"
  // flag as if the save had worked) — the real cause of "Ctrl+S doesn't
  // save my changes". Routing through a ref that's kept current on every
  // render fixes it without needing the editor to remount per keystroke.
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const handleMount: OnMount = (editorInstance, monaco) => {
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (active) onSaveRef.current(active.path);
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
