import { useEffect, useRef, useState } from "react";
import type { OllamaModel } from "../types";

function formatBytes(n: number): string {
  if (!n) return "";
  const gb = n / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} Go`;
  const mb = n / 1024 / 1024;
  return `${mb.toFixed(0)} Mo`;
}

function formatMeta(m: OllamaModel): string {
  return [m.parameter_size, m.quantization_level, formatBytes(m.size)].filter(Boolean).join(" · ");
}

export default function ModelSelect({
  models,
  value,
  onChange,
  disabled,
}: {
  models: OllamaModel[];
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const current = models.find((m) => m.name === value);
  const filtered = filter.trim()
    ? models.filter((m) => m.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : models;

  function select(name: string) {
    onChange(name);
    setOpen(false);
    setFilter("");
  }

  return (
    <div className="model-select" ref={rootRef}>
      <button
        type="button"
        className="model-select-trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || models.length === 0}
      >
        <span className="model-select-trigger-text">
          <span className="model-select-name">{current?.name ?? "Aucun modèle"}</span>
          {current && formatMeta(current) && <span className="model-select-meta">{formatMeta(current)}</span>}
        </span>
        <span className="model-select-chevron">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="model-select-panel">
          <input
            autoFocus
            className="model-select-search"
            placeholder="Filtrer les modèles…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                setFilter("");
              } else if (e.key === "Enter" && filtered.length === 1) {
                select(filtered[0].name);
              }
            }}
          />
          <div className="model-select-list">
            {filtered.length === 0 && <div className="model-select-empty">Aucun résultat</div>}
            {filtered.map((m) => (
              <button
                type="button"
                key={m.name}
                className={`model-select-item ${m.name === value ? "model-select-item-active" : ""}`}
                onClick={() => select(m.name)}
              >
                <span className="model-select-item-name">{m.name}</span>
                {formatMeta(m) && <span className="model-select-item-meta">{formatMeta(m)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
