export type MenuName = "File" | "View" | "Review" | "Help";

export interface KeyCombo {
  key: string;
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
  /** Shown next to the item when the shortcut is handled elsewhere (for example j / k). */
  hint?: string;
  enabled?: boolean;
  /** Toggles and choices show a check mark. */
  checked?: boolean;
  separatorBefore?: boolean;
}

export const MENUS: MenuName[] = ["File", "View", "Review", "Help"];

export function shortcutLabel(c: Command): string | undefined {
  if (c.hint) return c.hint;
  if (!c.keys) return undefined;
  const k = c.keys.key.length === 1 ? c.keys.key.toUpperCase() : c.keys.key;
  return [c.keys.ctrl && "Ctrl", c.keys.shift && "Shift", k].filter(Boolean).join("+");
}

export function matches(e: KeyboardEvent, k: KeyCombo): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  return !!k.ctrl === ctrl && !!k.shift === e.shiftKey && e.key.toLowerCase() === k.key.toLowerCase();
}
