import { computeNewLineNumber, computeOldLineNumber, getChangeKey, type ChangeData, type FileData, type HunkData } from "react-diff-view";
import type { Anchor } from "./analysis";

export const filePath = (f: FileData) => (f.type === "delete" ? f.oldPath : f.newPath);

export function findFile(files: FileData[], path: string): FileData | undefined {
  return files.find((f) => filePath(f) === path) ?? files.find((f) => filePath(f).endsWith(path) || path.endsWith(filePath(f)));
}

const GENERATED_PATHS = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|composer\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|go\.sum|flake\.lock|mix\.lock|pubspec\.lock|Podfile\.lock|packages\.lock\.json)$/,
  /\.min\.(js|css)$/,
  /\.(map|snap)$/,
  /\.pb\.go$/,
  /_pb2(_grpc)?\.py$/,
  /\.(g|freezed)\.dart$/,
  /\.generated\.\w+$/,
  /(^|\/)(dist|vendor|node_modules|__generated__|generated)\//,
];
const GENERATED_MARKER = /@generated|Code generated .* DO NOT EDIT|auto-?generated|this file (is|was) generated/i;

/** Lockfiles, build output, snapshots and files that say they're generated. Their diffs start hidden. */
export function isGenerated(f: FileData): boolean {
  const path = filePath(f);
  if (GENERATED_PATHS.some((r) => r.test(path))) return true;
  return (f.hunks[0]?.changes.slice(0, 8) ?? []).some((c) => GENERATED_MARKER.test(c.content));
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
