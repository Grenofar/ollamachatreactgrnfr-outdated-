import { useEffect, useState } from "react";
import { listDir } from "../../api";
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

export default function FileTree({
  rootPath,
  activePath,
  onOpenFile,
}: {
  rootPath: string;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const [nodes, setNodes] = useState<Node[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNodes(null);
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
        </div>
        {node.expanded && node.children ? renderNodes(node.children, depth + 1) : null}
      </div>
    ));
  }

  if (nodes === null) return <div className="codex-filetree-empty">Chargement…</div>;
  if (nodes.length === 0) return <div className="codex-filetree-empty">Dossier vide</div>;

  return <div>{renderNodes(nodes, 0)}</div>;
}
