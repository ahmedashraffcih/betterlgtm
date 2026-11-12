import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMac, isWindows } from "./commands";
import { inTauri } from "./mock";
import { isSettingsWindow } from "./settingsWindow";
import type { Theme } from "./settings";

export const os = isMac ? "mac" : isWindows ? "windows" : "linux";

/**
 * Tag the page with the platform and window effects, so styles can follow each system's look:
 * `data-os` (mac, windows, linux), `data-vibrancy` when the sidebar shows the desktop through it,
 * and `data-fullscreen` on macOS, where the traffic lights hide in full screen.
 */
export function setupPlatform() {
  const root = document.documentElement;
  root.dataset.os = os;
  if (!inTauri) return;
  if (isMac) {
    // The macOS window is transparent with the sidebar material behind it (tauri.macos.conf.json).
    if (!isSettingsWindow) root.dataset.vibrancy = "";
    const win = getCurrentWindow();
    const sync = () => win.isFullscreen().then((f) => (f ? (root.dataset.fullscreen = "") : delete root.dataset.fullscreen)).catch(() => {});
    sync();
    win.onResized(sync);
  } else if (isWindows && !isSettingsWindow) {
    // Mica needs Windows 11, which reports platform version 13 or later.
    type UAData = { getHighEntropyValues: (h: string[]) => Promise<{ platformVersion?: string }> };
    const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
    uaData
      ?.getHighEntropyValues(["platformVersion"])
      .then(({ platformVersion }) => {
        if (Number(platformVersion?.split(".")[0]) < 13) return;
        return invoke<boolean>("enable_mica").then((ok) => ok && (root.dataset.vibrancy = ""));
      })
      .catch(() => {});
  }
}

/**
 * Apply the theme to the page and to the window. The window matters on macOS: the sidebar is native
 * material behind a transparent page, and it follows the window's appearance, not the page's colours.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  if (inTauri) getCurrentWindow().setTheme(theme === "system" ? null : theme).catch(() => {});
}
