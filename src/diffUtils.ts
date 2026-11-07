import { computeNewLineNumber, computeOldLineNumber, getChangeKey, type ChangeData, type FileData, type HunkData } from "react-diff-view";
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

/** Hunks of `file` that overlap any of the ranges. A range starting at 0 means the whole file. */
export function hunksForRanges(file: FileData, ranges: Anchor[]): HunkData[] {
  if (file.type === "delete" || ranges.some((r) => r.startLine <= 0)) return file.hunks;
  return file.hunks.filter((h) => {
    const start = h.newStart;
    const end = h.newStart + Math.max(h.newLines, 1) - 1;
    return ranges.some((r) => r.startLine <= end && r.endLine >= start);
  });
}

/**
 * Review progress is tracked per hunk, so marking a file in Files mode and marking it inside a
 * guided-review step stay in sync, even when a file's hunks are spread over several steps.
 * The hunk header changes when new commits move the code, which resets that part only.
 */
export const hunkKey = (file: FileData, hunk: HunkData) => `${filePath(file)}\u0000${hunk.content}`;

export const allReviewed = (keys: string[], reviewed: Set<string>) => keys.length > 0 && keys.every((k) => reviewed.has(k));

export const changeKeys = (changes: ChangeData[]) => changes.map(getChangeKey);

export function lineNumbers(c: ChangeData) {
  const o = computeOldLineNumber(c);
  const n = computeNewLineNumber(c);
  return { old: o > 0 ? String(o) : "", new: n > 0 ? String(n) : "" };
}
