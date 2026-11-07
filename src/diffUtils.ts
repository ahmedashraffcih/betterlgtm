import { computeNewLineNumber, computeOldLineNumber, getChangeKey, type ChangeData, type FileData } from "react-diff-view";
import type { Anchor } from "./analysis";

export const filePath = (f: FileData) => (f.type === "delete" ? f.oldPath : f.newPath);

export function findFile(files: FileData[], path: string): FileData | undefined {
  return files.find((f) => filePath(f) === path) ?? files.find((f) => filePath(f).endsWith(path) || path.endsWith(filePath(f)));
}

export function fileStats(f: FileData) {
  let add = 0;
  let del = 0;
  for (const h of f.hunks) for (const c of h.changes) c.type === "insert" ? add++ : c.type === "delete" && del++;
  return { add, del };
}

/** Changes in `file` that fall inside the anchor's new-line range, plus deletions next to them. */
export function changesInRange(file: FileData, a: Anchor, pad = 0): ChangeData[] {
  const out: ChangeData[] = [];
  const lo = a.startLine - pad;
  const hi = a.endLine + pad;
  for (const hunk of file.hunks) {
    const changes = hunk.changes;
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      let line = computeNewLineNumber(c);
      if (line < 0) {
        const next = changes.slice(i + 1).find((n) => n.type !== "delete");
        line = next ? computeNewLineNumber(next) : -1;
      }
      if (line >= lo && line <= hi) out.push(c);
    }
  }
  return out;
}

export const changeKeys = (changes: ChangeData[]) => changes.map(getChangeKey);

export function lineNumbers(c: ChangeData) {
  const o = computeOldLineNumber(c);
  const n = computeNewLineNumber(c);
  return { old: o > 0 ? String(o) : "", new: n > 0 ? String(n) : "" };
}
