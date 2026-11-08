import type { HunkData } from "react-diff-view";
import { highlightHunks } from "./highlight";

/** Tokenizes diffs off the main thread so big files don't freeze the window. */
self.onmessage = (e: MessageEvent<{ id: number; hunks: HunkData[]; path: string }>) => {
  const { id, hunks, path } = e.data;
  self.postMessage({ id, tokens: highlightHunks(hunks, path) });
};
