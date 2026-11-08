import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { inTauri } from "./mock";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking"; manual: boolean }
  | { kind: "current"; manual: boolean }
  | { kind: "available"; version: string }
  | { kind: "installing"; version: string; percent: number | null }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string; manual: boolean };

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Checks GitHub releases for a newer signed build, installs it on request, and restarts. */
export function useUpdater(auto: boolean) {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const pending = useRef<Update | null>(null);
  const busy = useRef(false);

  const checkNow = useCallback(async (manual: boolean) => {
    if (!inTauri || busy.current) return;
    busy.current = true;
    setState((s) => (s.kind === "available" || s.kind === "ready" ? s : { kind: "checking", manual }));
    try {
      const update = await check();
      pending.current = update;
      setState(update ? { kind: "available", version: update.version } : { kind: "current", manual });
    } catch (e) {
      setState({ kind: "error", message: String(e), manual });
    } finally {
      busy.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    const update = pending.current;
    if (!update || busy.current) return;
    busy.current = true;
    let total = 0;
    let done = 0;
    setState({ kind: "installing", version: update.version, percent: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          setState({ kind: "installing", version: update.version, percent: total ? Math.round((done / total) * 100) : null });
        }
      });
      setState({ kind: "ready", version: update.version });
    } catch (e) {
      setState({ kind: "error", message: String(e), manual: true });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!inTauri || !auto) return;
    const first = window.setTimeout(() => checkNow(false), FIRST_CHECK_MS);
    const every = window.setInterval(() => checkNow(false), CHECK_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [auto, checkNow]);

  // A manual "up to date" or error note clears itself after a while.
  useEffect(() => {
    if ((state.kind === "current" || state.kind === "error") && state.manual) {
      const t = window.setTimeout(() => setState({ kind: "idle" }), 8000);
      return () => window.clearTimeout(t);
    }
  }, [state]);

  return { state, checkNow, install, restart: relaunch, supported: inTauri };
}
