import { useEffect, useState } from "react";
import type { HunkData, HunkTokens } from "react-diff-view";

/** Tokens already made, per hunk list, so going back to a file shows its colors at once. */
const cache = new WeakMap<HunkData[], HunkTokens | null>();
const pending = new Map<number, (t: HunkTokens | null) => void>();
let worker: Worker | null | undefined;
let nextId = 0;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; tokens: HunkTokens | null }>) => {
      pending.get(e.data.id)?.(e.data.tokens);
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      // Fall back to the main thread for this and later requests.
      worker = null;
      for (const [, resolve] of pending) resolve(null);
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Syntax and word-edit tokens for a file's hunks, made in a worker when one is available. */
export async function highlightAsync(hunks: HunkData[], path: string): Promise<HunkTokens | null> {
  if (cache.has(hunks)) return cache.get(hunks)!;
  const w = getWorker();
  let tokens: HunkTokens | null;
  if (w) {
    const id = nextId++;
    tokens = await new Promise<HunkTokens | null>((resolve) => {
      pending.set(id, resolve);
      w.postMessage({ id, hunks, path });
    });
  } else {
    const { highlightHunks } = await import("./highlight");
    tokens = highlightHunks(hunks, path);
  }
  cache.set(hunks, tokens);
  return tokens;
}

/** Tokens for `hunks`, null until they're ready; the diff shows plain text meanwhile. */
export function useTokens(hunks: HunkData[], path: string, enabled: boolean): HunkTokens | null {
  const [state, setState] = useState<{ hunks: HunkData[]; tokens: HunkTokens | null } | null>(null);
  useEffect(() => {
    if (!enabled || cache.has(hunks)) return;
    let live = true;
    highlightAsync(hunks, path).then((tokens) => live && setState({ hunks, tokens }));
    return () => {
      live = false;
    };
  }, [hunks, path, enabled]);
  if (!enabled) return null;
  if (cache.has(hunks)) return cache.get(hunks)!;
  return state && state.hunks === hunks ? state.tokens : null;
}
