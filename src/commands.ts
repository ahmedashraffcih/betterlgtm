export type MenuName = "File" | "View" | "Review" | "Help";

export interface KeyCombo {
  key: string;
  /** The platform's command key: ⌘ on macOS, Ctrl elsewhere. */
  ctrl?: boolean;
  shift?: boolean;
}

/** One action the user can take from the menu bar, the command palette or a shortcut. */
export interface Command {
  id: string;
  label: string;
  menu: MenuName;
  run: () => void;
  keys?: KeyCombo;
  /** More combos for the same command. Only `keys` is shown in the menu bar. */
  altKeys?: KeyCombo[];
  /** Shown next to the item when the shortcut is handled elsewhere (for example n / N). */
  hint?: string;
  enabled?: boolean;
  /** Toggles and choices show a check mark. */
  checked?: boolean;
  separatorBefore?: boolean;
}

export const MENUS: MenuName[] = ["File", "View", "Review", "Help"];

const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
export const isMac = /Mac OS X|Macintosh/.test(ua);
export const isWindows = /Windows/.test(ua);

const MAC_KEYS: Record<string, string> = { Enter: "↩", Escape: "⎋", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };

/** How a combo is written on this platform: ⌘⇧K on macOS, Ctrl+Shift+K elsewhere. */
export function comboLabel(k: KeyCombo): string {
  const key = k.key.length === 1 ? k.key.toUpperCase() : k.key;
  if (isMac) return `${k.ctrl ? "⌘" : ""}${k.shift ? "⇧" : ""}${MAC_KEYS[key] ?? key}`;
  return [k.ctrl && "Ctrl", k.shift && "Shift", key].filter(Boolean).join("+");
}

/** A key held with the real Control key on every platform (Vim-style Ctrl+D, for example). */
export function controlLabel(key: string): string {
  return isMac ? `⌃${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}

export function shortcutLabel(c: Command): string | undefined {
  if (c.hint) return c.hint;
  if (!c.keys) return undefined;
  return [c.keys, ...(c.altKeys ?? [])].map(comboLabel).join(" / ");
}

/** The combo as a native menu accelerator, for example "CmdOrCtrl+Shift+Enter". */
export function accelerator(k: KeyCombo): string {
  const key = k.key.length === 1 ? k.key.toUpperCase() : k.key;
  return [k.ctrl && "CmdOrCtrl", k.shift && "Shift", key].filter(Boolean).join("+");
}

export function matches(e: KeyboardEvent, k: KeyCombo): boolean {
  // ⌘ on macOS and Ctrl elsewhere, so Ctrl on a Mac and the Windows/Super key elsewhere stay free.
  const cmd = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return !!k.ctrl === cmd && !!k.shift === e.shiftKey && !e.altKey && e.key.toLowerCase() === k.key.toLowerCase();
}
