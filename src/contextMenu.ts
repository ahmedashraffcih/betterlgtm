import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import type { MouseEvent as ReactMouseEvent } from "react";
import { inTauri } from "./mock";

export interface ContextItem {
  label: string;
  run: () => void;
  enabled?: boolean;
  separatorBefore?: boolean;
}

/** Show a native right-click menu. Outside Tauri (the browser preview) the page's own menu stays. */
export function contextMenu(items: ContextItem[]) {
  return (e: ReactMouseEvent) => {
    if (!inTauri) return;
    e.preventDefault();
    e.stopPropagation();
    (async () => {
      const list: (MenuItem | PredefinedMenuItem)[] = [];
      for (const it of items) {
        if (it.separatorBefore && list.length) list.push(await PredefinedMenuItem.new({ item: "Separator" }));
        list.push(await MenuItem.new({ text: it.label, enabled: it.enabled !== false, action: it.run }));
      }
      const menu = await Menu.new({ items: list });
      await menu.popup();
    })().catch((err) => console.error("Could not show the menu", err));
  };
}

/** Copy text. Clipboard access needs a user gesture in some webviews, so fall back to a hidden field. */
export function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    const t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  });
}

/**
 * Native apps don't offer Reload or Inspect on right-click. Keep the webview menu only where it's
 * useful: text fields and selected text (copy, paste, spelling).
 */
export function suppressDefaultContextMenu() {
  if (!inTauri || import.meta.env.DEV) return;
  window.addEventListener("contextmenu", (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest("input, textarea, [contenteditable]")) return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
  });
}
