import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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

/**
 * Zoom the page, like a browser's zoom: text, code and spacing all scale together. In the app the
 * webview zooms itself; in a plain browser (sample data) CSS zoom stands in.
 */
let pageZoom = 1;

export function applyZoom(zoom: number) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  pageZoom = z;
  if (inTauri) getCurrentWebview().setZoom(z).catch(() => {});
  else document.documentElement.style.zoom = z === 1 ? "" : String(z);
}

/**
 * On Linux the app stops WebKitGTK zooming the whole page on a two-finger pinch and sends each step
 * here instead (`ratio` is the change in scale since the last step, x and y are in window pixels).
 * Turn it into the ctrl + wheel event a browser sends for a pinch, so the PR map zooms under the
 * fingers; anywhere else it does nothing.
 */
(window as unknown as { __betterlgtmPinch?: (ratio: number, x: number, y: number) => void }).__betterlgtmPinch = (ratio, x, y) => {
  if (!(ratio > 0) || ratio === 1) return;
  const clientX = x / pageZoom;
  const clientY = y / pageZoom;
  const target = document.elementFromPoint(clientX, clientY);
  if (!target) return;
  // React Flow zooms by 2^(-deltaY * 0.002) for a pinch off macOS, so this gives back the same ratio.
  const deltaY = -500 * Math.log2(ratio);
  target.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: 0, ctrlKey: true, clientX, clientY, bubbles: true, cancelable: true }));
};
