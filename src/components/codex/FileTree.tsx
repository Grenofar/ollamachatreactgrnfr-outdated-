import { useEffect, useState } from "react";
import { listDir, writeFileText } from "../../api";
import type { DirEntry } from "../../types";

interface Node {
  entry: DirEntry;
  expanded: boolean;
  loading: boolean;
  children: Node[] | null;
}

function updateNode(nodes: Node[], path: string, updater: (n: Node) => Node): Node[] {
  return nodes.map((n) => {
    if (n.entry.path === path) return updater(n);
    if (n.children) return { ...n, children: updateNode(n.children, path, updater) };
    return n;
  });
}

function compareEntries(a: DirEntry, b: DirEntry): number {
  if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

function insertNode(nodes: Node[], newNode: Node): Node[] {
  return [...nodes, newNode].sort((a, b) => compareEntries(a.entry, b.entry));
}

function joinPath(parent: string, name: string): string {
  const separator = parent.includes("/") && !parent.includes("\\") ? "/" : "\\";
  return parent.endsWith("\\") || parent.endsWith("/") ? `${parent}${name}` : `${parent}${separator}${name}`;
}

export default function FileTree({
  rootPath,
  activePath,
  onOpenFile,
  onFileCreated,
}: {
  rootPath: string;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onFileCreated: (path: string) => void;
}) {
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    let cancelled = false;
    setNodes(null);
    setCreatingIn(null);
    listDir(rootPath)
      .then((entries) => {
        if (cancelled) return;
        setNodes(entries.map((entry) => ({ entry, expanded: false, loading: false, children: null })));
      })
      .catch(() => {
        if (!cancelled) setNodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  async function toggle(node: Node) {
    if (!node.entry.is_dir) {
      onOpenFile(node.entry.path);
      return;
    }
    if (node.expanded) {
      setNodes((prev) => (prev ? updateNode(prev, node.entry.path, (n) => ({ ...n, expanded: false })) : prev));
      return;
    }
    if (node.children) {
      setNodes((prev) => (prev ? updateNode(prev, node.entry.path, (n) => ({ ...n, expanded: true })) : prev));
      return;
    }
    setNodes((prev) => (prev ? updateNode(prev, node.entry.path, (n) => ({ ...n, loading: true })) : prev));
    try {
      const entries = await listDir(node.entry.path);
      const children = entries.map((entry) => ({ entry, expanded: false, loading: false, children: null }));
      setNodes((prev) =>
        prev ? updateNode(prev, node.entry.path, (n) => ({ ...n, expanded: true, loading: false, children })) : prev,
      );
    } catch {
      setNodes((prev) => (prev ? updateNode(prev, node.entry.path, (n) => ({ ...n, loading: false })) : prev));
    }
  }

  // Ensures the target folder's children are loaded and expanded before showing
  // the inline "new file" input, so the created entry lands in the right spot
  // instead of popping in only once the folder happens to be expanded later.
  async function startCreateIn(node: Node | null) {
    if (node) {
      if (node.children === null) {
        setNodes((prev) => (prev ? updateNode(prev, node.entry.path, (n) => ({ ...n, loading: true })) : prev));
        try {
          const entries = await listDir(node.entry.path);
          const children = entries.map((entry) => ({ entry, expanded: false, loading: false, children: null }));
          setNodes((prev) =>
            prev
              ? updateNode(prev, node.entry.path, (n) => ({ ...n, expanded: true, loading: false, children }))
              : prev,
          );
        } catch {
          setNodes((prev) => (prev ? updateNode(prev, node.entry.path, (n) => ({ ...n, loading: false })) : prev));
          return;
        }
      } else if (!node.expanded) {
        setNodes((prev) => (prev ? updateNode(prev, node.entry.path, (n) => ({ ...n, expanded: true })) : prev));
      }
    }
    setNewName("");
    setCreatingIn(node ? node.entry.path : rootPath);
  }

  function cancelCreate() {
    setCreatingIn(null);
    setNewName("");
  }

  async function confirmCreate() {
    const name = newName.trim();
    const parentPath = creatingIn;
    cancelCreate();
    if (!name || parentPath === null) return;

    const path = joinPath(parentPath, name);
    try {
      await writeFileText(path, "");
      const newNode: Node = { entry: { name, path, is_dir: false }, expanded: false, loading: false, children: null };
      if (parentPath === rootPath) {
        setNodes((prev) => insertNode(prev ?? [], newNode));
      } else {
        setNodes((prev) =>
          prev ? updateNode(prev, parentPath, (n) => ({ ...n, children: insertNode(n.children ?? [], newNode) })) : prev,
        );
      }
      onFileCreated(path);
    } catch (e) {
      window.alert(`Impossible de créer ${path} : ${String(e)}`);
    }
  }

  function renderCreateInput(key: string) {
    return (
      <div className="tree-row-input" key={key}>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmCreate();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelCreate();
            }
          }}
          onBlur={cancelCreate}
          placeholder="nom-du-fichier.ts"
        />
      </div>
    );
  }

  function renderNodes(list: Node[], depth: number) {
    return list.map((node) => (
      <div key={node.entry.path}>
        <div
          className={`tree-row ${node.entry.path === activePath ? "tree-row-active" : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => toggle(node)}
        >
          <span className="tree-toggle">
            {node.entry.is_dir ? (node.loading ? "…" : node.expanded ? "▾" : "▸") : ""}
          </span>
          <span className="tree-icon">{node.entry.is_dir ? "📁" : "📄"}</span>
          <span>{node.entry.name}</span>
          {node.entry.is_dir && (
            <button
              className="tree-row-new-file"
              title="Nouveau fichier"
              onClick={(e) => {
                e.stopPropagation();
                startCreateIn(node);
              }}
            >
              +
            </button>
          )}
        </div>
        {node.expanded && creatingIn === node.entry.path && renderCreateInput(`${node.entry.path}::new`)}
        {node.expanded && node.children ? renderNodes(node.children, depth + 1) : null}
      </div>
    ));
  }

  return (
    <div className="codex-filetree">
      <div className="codex-filetree-toolbar">
        <button onClick={() => startCreateIn(null)} title="Nouveau fichier">
          + Nouveau fichier
        </button>
      </div>
      <div className="codex-filetree-scroll">
        {creatingIn === rootPath && renderCreateInput("root::new")}
        {nodes === null && <div className="codex-filetree-empty">Chargement…</div>}
        {nodes !== null && nodes.length === 0 && creatingIn !== rootPath && (
          <div className="codex-filetree-empty">Dossier vide</div>
        )}
        {nodes !== null && renderNodes(nodes, 0)}
      </div>
    </div>
  );
}
