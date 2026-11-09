import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ReviewRequest } from "./api";
import { isMac } from "./commands";
import type { SettingsSection } from "./components/Settings";
import { inTauri } from "./mock";

/**
 * On macOS, Settings opens in a window of its own (⌘,), as in other Mac apps. Windows and Linux
 * keep it in the main window. Settings themselves are shared through localStorage; the main window
 * sends what the Organizations page lists, and runs Reload and Clear data for it.
 */
export const SETTINGS_LABEL = "settings";
export const useSettingsWindow = isMac && inTauri;
export const isSettingsWindow = inTauri && getCurrentWindow().label === SETTINGS_LABEL;

const SECTION_KEY = "better-lgtm.settingsSection";

export const EV = {
  /** main → settings: what the Organizations page lists. */
  data: "settings:data",
  /** settings → main: the window is ready for data. */
  ready: "settings:ready",
  /** main → settings: show a section. */
  section: "settings:section",
  reloadOrgs: "settings:reload-orgs",
  clearData: "settings:clear-data",
} as const;

export interface SettingsData {
  orgs: { login: string; orgs: string[] } | null;
  orgsError: string | null;
  requests: ReviewRequest[] | null;
}

export function initialSection(): SettingsSection {
  try {
    return (localStorage.getItem(SECTION_KEY) as SettingsSection | null) ?? "general";
  } catch {
    return "general";
  }
}

export async function openSettingsWindow(section: SettingsSection) {
  try {
    localStorage.setItem(SECTION_KEY, section);
  } catch {
    // the window opens on General
  }
  const existing = await WebviewWindow.getByLabel(SETTINGS_LABEL);
  if (existing) {
    await emitTo(SETTINGS_LABEL, EV.section, section);
    await existing.setFocus();
    return;
  }
  new WebviewWindow(SETTINGS_LABEL, {
    url: "index.html",
    title: "Settings",
    width: 820,
    height: 600,
    minWidth: 620,
    minHeight: 420,
    center: true,
  });
}

export async function closeSettingsWindow() {
  (await WebviewWindow.getByLabel(SETTINGS_LABEL))?.close();
}
