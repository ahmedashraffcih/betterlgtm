import { Check, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MENUS, shortcutLabel, type Command, type MenuName } from "../commands";

function Items({ items, onDone }: { items: Command[]; onDone: () => void }) {
  return (
    <>
      {items.map((c) => (
        <div key={c.id} style={{ display: "contents" }}>
          {c.separatorBefore && <div className="menu-sep" role="separator" />}
          <button
            type="button"
            role={c.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={c.checked}
            className="menu-item"
            disabled={c.enabled === false}
            onClick={() => {
              onDone();
              c.run();
            }}
          >
            <span className="menu-check">{c.checked && <Check size={13} />}</span>
            <span style={{ flex: 1 }}>{c.label}</span>
            {shortcutLabel(c) && <span className="menu-key">{shortcutLabel(c)}</span>}
          </button>
        </div>
      ))}
    </>
  );
}

/**
 * The menu bar. Narrow windows (see the title bar's container query) show a single button that
 * opens every menu in one list.
 */
export function MenuBar({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState<MenuName | "all" | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={root} className="menubar" role="menubar">
      {MENUS.map((m) => (
        <div key={m} style={{ position: "relative" }}>
          <button
            type="button"
            className={open === m ? "menu on" : "menu"}
            aria-haspopup="menu"
            aria-expanded={open === m}
            onClick={() => setOpen(open === m ? null : m)}
            // Once a menu is open, moving across the bar switches menus, as in native apps.
            onMouseEnter={() => open && open !== "all" && setOpen(m)}
          >
            {m}
          </button>
          {open === m && (
            <div className="menu-pop" role="menu" aria-label={m}>
              <Items items={commands.filter((c) => c.menu === m)} onDone={() => setOpen(null)} />
            </div>
          )}
        </div>
      ))}
      <div className="menu-btn" style={{ position: "relative" }}>
        <button type="button" className={open === "all" ? "tb on" : "tb"} aria-label="Menu" aria-haspopup="menu" aria-expanded={open === "all"} onClick={() => setOpen(open === "all" ? null : "all")}>
          <Menu size={16} />
        </button>
        {open === "all" && (
          <div className="menu-pop" role="menu" aria-label="Menu">
            {MENUS.map((m, i) => (
              <div key={m} style={{ display: "contents" }}>
                {i > 0 && <div className="menu-sep" role="separator" />}
                <div className="menu-head">{m}</div>
                <Items items={commands.filter((c) => c.menu === m)} onDone={() => setOpen(null)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
