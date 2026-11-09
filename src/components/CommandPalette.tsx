import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
  run: () => void;
}

/** ⌘K / Ctrl+K: jump to a pull request, finding, section or file, or run a command. */
export function CommandPalette({ items, onClose, extra }: { items: PaletteItem[]; onClose: () => void; /** An item built from the query itself, shown first. */ extra?: (query: string) => PaletteItem | null }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = items.filter((it) => {
      const hay = `${it.label} ${it.detail ?? ""} ${it.group}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const fromQuery = extra?.(query.trim());
    return [...(fromQuery ? [fromQuery] : []), ...hits].slice(0, 60);
  }, [items, query, extra]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const pick = (it?: PaletteItem) => {
    if (!it) return;
    onClose();
    it.run();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Go to" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={15} className="tone-muted" />
          <input
            ref={input}
            value={query}
            placeholder="Pull requests, findings, files, commands, or paste a PR link…"
            aria-label="Search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div ref={list} className="palette-list" role="listbox">
          {results.length === 0 && <div className="muted" style={{ padding: "12px 14px" }}>Nothing matches.</div>}
          {results.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id} style={{ display: "contents" }}>
                {head && <div className="menu-head">{head}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  data-index={i}
                  className={i === index ? "palette-item on" : "palette-item"}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => pick(it)}
                >
                  <span className="palette-icon">{it.icon}</span>
                  <span className="ellipsis" style={{ flex: 1 }}>{it.label}</span>
                  {it.detail && <span className="ellipsis palette-detail">{it.detail}</span>}
                  {i === index && <CornerDownLeft size={13} className="tone-muted" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
