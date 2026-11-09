import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { useEffect, useRef } from "react";
import { accelerator, isMac, isWindows, MENUS, type Command } from "./commands";
import { inTauri } from "./mock";

/** On macOS these live in the app menu (named after the app) instead of File and Help. */
const MAC_APP_MENU = ["about", "settings", "updates", "quit"];

type Item = MenuItem | CheckMenuItem;
interface Built {
  items: Map<string, Item>;
  last: Map<string, { label: string; enabled: boolean; checked?: boolean }>;
}

let built: Promise<Built> | null = null;
const lastRun = new Map<string, number>();

/**
 * Run a command picked from the native menu or typed as a shortcut. A shortcut can reach both the
 * native menu accelerator and the page's keydown handler, so a second run within 300 ms is dropped.
 */
export function runOnce(c: Command) {
  if (c.enabled === false) return;
  const now = Date.now();
  if (now - (lastRun.get(c.id) ?? 0) < 300) return;
  lastRun.set(c.id, now);
  c.run();
}

async function build(commands: () => Command[]): Promise<Built> {
  const items = new Map<string, Item>();
  const last = new Map<string, { label: string; enabled: boolean; checked?: boolean }>();
  const sep = () => PredefinedMenuItem.new({ item: "Separator" });

  const item = async (c: Command) => {
    const opts = {
      id: c.id,
      text: c.label,
      enabled: c.enabled !== false,
      accelerator: c.keys ? accelerator(c.keys) : undefined,
      action: () => {
        const cur = commands().find((x) => x.id === c.id);
        if (cur) runOnce(cur);
      },
    };
    const it = c.checked === undefined ? await MenuItem.new(opts) : await CheckMenuItem.new({ ...opts, checked: c.checked });
    items.set(c.id, it);
    last.set(c.id, { label: c.label, enabled: c.enabled !== false, checked: c.checked });
    return it;
  };

  const section = async (list: Command[]) => {
    const out: (Item | PredefinedMenuItem)[] = [];
    for (const c of list) {
      if (c.separatorBefore && out.length) out.push(await sep());
      out.push(await item(c));
    }
    return out;
  };

  const all = commands().map((c) =>
    // Windows apps close with Alt+F4 and call it Exit; Ctrl+Q is a macOS and Linux habit.
    c.id === "quit" && isWindows ? { ...c, label: "Exit", keys: undefined } : c,
  );
  const inMenu = (m: string) => all.filter((c) => c.menu === m && !(isMac && MAC_APP_MENU.includes(c.id)));
  const byId = (id: string) => all.find((c) => c.id === id)!;
  const submenus: Submenu[] = [];

  if (isMac) {
    submenus.push(
      await Submenu.new({
        text: "BetterLGTM",
        items: [
          await item({ ...byId("about"), label: "About BetterLGTM" }),
          await sep(),
          await item(byId("settings")),
          await item(byId("updates")),
          await sep(),
          await PredefinedMenuItem.new({ item: "Services" }),
          await sep(),
          await PredefinedMenuItem.new({ item: "Hide" }),
          await PredefinedMenuItem.new({ item: "HideOthers" }),
          await PredefinedMenuItem.new({ item: "ShowAll" }),
          await sep(),
          await item({ ...byId("quit"), label: "Quit BetterLGTM" }),
        ],
      }),
    );
  }

  for (const m of MENUS) {
    const list = await section(inMenu(m));
    if (isMac && m === "File") list.push(await sep(), await PredefinedMenuItem.new({ item: "CloseWindow" }));
    const sub = await Submenu.new({ text: m, items: list });
    submenus.push(sub);
    if (isMac && m === "Help") await sub.setAsHelpMenuForNSApp();

    // macOS needs an Edit menu for copy and paste to work in text fields, and a Window menu by convention.
    if (isMac && m === "File") {
      submenus.push(
        await Submenu.new({
          text: "Edit",
          items: await Promise.all(
            (["Undo", "Redo", "Separator", "Cut", "Copy", "Paste", "SelectAll"] as const).map((p) => PredefinedMenuItem.new({ item: p })),
          ),
        }),
      );
    }
    if (isMac && m === "Review") {
      const win = await Submenu.new({
        text: "Window",
        items: [
          await PredefinedMenuItem.new({ item: "Minimize" }),
          await PredefinedMenuItem.new({ item: "Maximize", text: "Zoom" }),
          await sep(),
          await PredefinedMenuItem.new({ item: "Fullscreen" }),
        ],
      });
      submenus.push(win);
      await win.setAsWindowsMenuForNSApp();
    }
  }

  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();
  return { items, last };
}

/** The native menu bar, built once from the command list and kept in step with it. */
export function useNativeMenu(commands: Command[]) {
  const ref = useRef(commands);
  ref.current = commands;

  useEffect(() => {
    if (!inTauri) return;
    built ??= build(() => ref.current).catch((e) => {
      console.error("Could not build the menu bar", e);
      built = null;
      throw e;
    });
    built
      .then(({ items, last }) => {
        for (const c of commands) {
          const it = items.get(c.id);
          const was = last.get(c.id);
          if (!it || !was) continue;
          const enabled = c.enabled !== false;
          // The app-menu copies of a command keep their own label.
          if (was.label !== c.label && !(isMac && MAC_APP_MENU.includes(c.id))) it.setText(c.label);
          if (was.enabled !== enabled) it.setEnabled(enabled);
          if (c.checked !== undefined && was.checked !== c.checked && it instanceof CheckMenuItem) it.setChecked(c.checked);
          last.set(c.id, { label: c.label, enabled, checked: c.checked });
        }
      })
      .catch(() => {});
  });
}
