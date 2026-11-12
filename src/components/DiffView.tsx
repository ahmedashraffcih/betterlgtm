import { ArrowLeft, CaseSensitive, Check, ChevronDown, ChevronUp, Columns2, Eye, Files, Flag, FolderSearch, ListOrdered, MessageSquare, MessageSquarePlus, Regex, Rows3, Search, Space, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Decoration, Diff, Hunk, getChangeKey, getCollapsedLinesCountBetween, insertHunk, textLinesToHunk,
  type ChangeData, type FileData, type HunkData, type RenderGutter,
} from "react-diff-view";
import type { Anchor, Finding } from "../analysis";
import { SEVERITY, fileIcon } from "../icons";
import { allReviewed, changeKeys, changesInRange, filePath, fileStats, findFile, hiddenKind, hunkKey, type HideRules } from "../diffUtils";
import { contextMenu, copyText } from "../contextMenu";
import { useTokens } from "../highlightAsync";
import { useElementWidth } from "../hooks";
import { useAgent } from "../harness";

export type DiffMode = "guided" | "files";

/** Switch between the guided review (changes grouped into steps) and the plain file list. */
export function DiffModeSwitch({ mode, onMode, compact }: { mode: DiffMode; onMode: (m: DiffMode) => void; compact?: boolean }) {
  return (
    <div className="seg" role="group" aria-label="Diff mode">
      <button type="button" className={mode === "guided" ? "on" : ""} aria-pressed={mode === "guided"} title="Guided review" onClick={() => onMode("guided")}>
        <ListOrdered size={13} />{!compact && "Guided"}
      </button>
      <button type="button" className={mode === "files" ? "on" : ""} aria-pressed={mode === "files"} title="All files" onClick={() => onMode("files")}>
        <Files size={13} />{!compact && "Files"}
      </button>
    </div>
  );
}

/** A comment written on selected diff lines; it goes into Submit review. */
export interface DraftComment {
  path: string;
  line: number;
  start_line?: number;
  body: string;
}

interface Props {
  onMode: (m: DiffMode) => void;
  reviewed: Set<string>;
  onReviewed: (hunkKeys: string[], reviewed: boolean) => void;
  /** Generated and test files whose diffs start hidden. */
  hide: HideRules;
  files: FileData[];
  current: string | null;
  range: Anchor | null;
  findings: Finding[];
  activeFinding: number | null;
  split: boolean;
  onSplit: (split: boolean) => void;
  onPickFile: (path: string, range?: Anchor) => void;
  onBack: () => void;
  onStepFinding: (delta: number) => void;
  hideWhitespace: boolean;
  onHideWhitespace: (v: boolean) => void;
  /** The file at the PR head, for showing hidden lines between hunks. */
  onLoadSource?: (path: string) => Promise<string>;
  onAskLines?: (path: string, start: number, end: number, code: string) => void;
  onAddComment?: (c: DraftComment) => void;
  /** Searches the whole worktree; absent until the PR has one. */
  onSearchRepo?: (pattern: string, regex: boolean, caseSensitive: boolean) => Promise<{ path: string; line: number; text: string }[]>;
  onOpenInEditor?: (path: string, line: number) => void;
}

type Scope = "all" | "added" | "removed" | "paths";

interface Match {
  path: string;
  line: number;
  text: string;
  kind: "add" | "del" | "ctx" | "path";
}

/** Lines rendered at first and per step while scrolling, so huge files stay responsive. */
const PAGE = 800;

/** The first `n` changes of `hunks`; the same array when all of them fit. */
function firstChanges(hunks: HunkData[], n: number): HunkData[] {
  const out: HunkData[] = [];
  let left = n;
  for (const h of hunks) {
    if (left <= 0) break;
    out.push(h.changes.length <= left ? h : { ...h, changes: h.changes.slice(0, left) });
    left -= h.changes.length;
  }
  return left >= 0 ? hunks : out;
}

const newLine = (c: ChangeData) => (c.type === "delete" ? null : c.type === "insert" ? c.lineNumber : c.newLineNumber);

function searchDiff(files: FileData[], query: string, regex: boolean, cs: boolean, scope: Scope): Match[] | string {
  if (!query) return [];
  let re: RegExp;
  try {
    re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), cs ? "" : "i");
  } catch (e) {
    return `Invalid regular expression: ${(e as Error).message}`;
  }
  const out: Match[] = [];
  for (const f of files) {
    const path = filePath(f);
    if (scope === "paths") {
      if (re.test(path)) out.push({ path, line: 0, text: path, kind: "path" });
      continue;
    }
    for (const h of f.hunks) {
      for (const c of h.changes) {
        if (scope === "added" && c.type !== "insert") continue;
        if (scope === "removed" && c.type !== "delete") continue;
        if (!re.test(c.content)) continue;
        const line = c.type === "delete" ? c.lineNumber : (newLine(c) ?? 0);
        out.push({ path, line, text: c.content.trim(), kind: c.type === "insert" ? "add" : c.type === "delete" ? "del" : "ctx" });
        if (out.length >= 500) return out;
      }
    }
  }
  return out;
}

export function DiffView(p: Props) {
  const agent = useAgent().short;
  const [onlyFindings, setOnlyFindings] = useState(false);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    p.findings.forEach((f) => {
      const paths = new Set(f.anchors.map((a) => (findFile(p.files, a.path) ? filePath(findFile(p.files, a.path)!) : a.path)));
      paths.forEach((path) => c.set(path, (c.get(path) ?? 0) + 1));
    });
    return c;
  }, [p.findings, p.files]);
  const listed = onlyFindings ? p.files.filter((f) => counts.has(filePath(f))) : p.files;

  // Files to skip by default: generated always (even with hiding off, they're a poor first file), tests when hidden.
  const skip = (f: FileData) => hiddenKind(f, { ...p.hide, generated: true }) !== null;
  const file = (p.current && findFile(p.files, p.current)) || p.files.find((f) => !skip(f)) || p.files[0];
  const path = file ? filePath(file) : "";
  // Generated and test files show a placeholder until the user asks for the diff.
  const [shownGenerated, setShownGenerated] = useState<Set<string>>(new Set());
  const hiddenAs = file && !shownGenerated.has(path) ? hiddenKind(file, p.hide) : null;
  const hideDiff = hiddenAs !== null;
  const scroller = useRef<HTMLDivElement>(null);
  // Narrow panes swap the file list for a dropdown; split view needs room for two columns.
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const narrow = width > 0 && width < 700;
  const canSplit = width === 0 || width >= 900;
  const split = p.split && canSplit;

  // Lines shown between hunks after "Show hidden lines", per file.
  const [expanded, setExpanded] = useState<{ path: string; base: HunkData[]; hunks: HunkData[] } | null>(null);
  const sources = useRef(new Map<string, string>());
  const [expandError, setExpandError] = useState<string | null>(null);
  // Expanded lines belong to one parse of the file: a new diff (whitespace toggle, new commits) drops them.
  const hunks = expanded && expanded.path === path && expanded.base === file?.hunks ? expanded.hunks : (file?.hunks ?? []);
  useEffect(() => setExpandError(null), [path]);
  /** Show unchanged lines `start` up to `end` (new-file line numbers); `oldStart` is the old-file number of the first. */
  const expand = async (start: number, end: number, oldStart: number) => {
    if (!file || !p.onLoadSource) return;
    try {
      let source = sources.current.get(path);
      if (source === undefined) {
        source = await p.onLoadSource(path);
        sources.current.set(path, source);
      }
      // The source is the new version of the file, so slice it by new-file line numbers.
      const lines = source.split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      const hunk = textLinesToHunk(lines.slice(start - 1, Math.min(end, lines.length + 1) - 1), oldStart, start);
      if (hunk) setExpanded({ path, base: file.hunks, hunks: insertHunk(hunks, hunk) });
    } catch (e) {
      setExpandError(String(e));
    }
  };

  const changeCount = hunks.reduce((n, h) => n + h.changes.length, 0);
  const tokens = useTokens(hunks, path, !!file && !hideDiff && changeCount < 20000);

  // Lines the user picked in the gutter (new-file line numbers), for asking Claude or commenting.
  const [picked, setPicked] = useState<{ path: string; start: number; end: number } | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  useEffect(() => {
    setPicked(null);
    setCommenting(false);
  }, [path]);
  const pickedRange: Anchor | null = picked && picked.path === path ? { path, startLine: picked.start, endLine: picked.end } : null;

  const selected = useMemo(() => {
    const r = pickedRange ?? (p.range && p.range.startLine > 0 ? p.range : null);
    return file && r ? changeKeys(changesInRange({ ...file, hunks }, r)) : [];
  }, [file, hunks, p.range?.path, p.range?.startLine, p.range?.endLine, pickedRange?.startLine, pickedRange?.endLine]);

  // Long files render in pages; scrolling near the end, or jumping to a line further down, shows more.
  const [limit, setLimit] = useState<{ hunks: HunkData[]; n: number }>({ hunks, n: PAGE });
  const target = useMemo(() => {
    if (!selected.length) return 0;
    const want = new Set(selected);
    let i = 0;
    for (const h of hunks) for (const c of h.changes) {
      i++;
      if (want.has(getChangeKey(c))) return i;
    }
    return 0;
  }, [hunks, selected]);
  const shownCount = Math.max(limit.hunks === hunks ? limit.n : PAGE, target + 200);
  const shownHunks = useMemo(() => firstChanges(hunks, shownCount), [hunks, shownCount]);
  const truncated = shownHunks !== hunks;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!truncated || !sentinel.current) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setLimit({ hunks, n: shownCount + PAGE }),
      { root: scroller.current, rootMargin: "0px 0px 1500px 0px" },
    );
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [truncated, hunks, shownCount]);

  const markers = useMemo(() => {
    const m = new Map<string, number>();
    if (!file) return m;
    p.findings.forEach((f, i) =>
      f.anchors.forEach((a) => {
        if (findFile([file], a.path) !== file) return;
        const first = changesInRange(file, a)[0];
        if (first && !m.has(getChangeKey(first))) m.set(getChangeKey(first), i + 1);
      }),
    );
    return m;
  }, [file, p.findings]);

  useEffect(() => {
    if (pickedRange) return;
    const el = scroller.current?.querySelector(".diff-code-selected");
    el?.scrollIntoView({ block: "center" });
  }, [selected]);

  const renderGutter: RenderGutter = useMemo(() => {
    const markerSide = split ? "new" : "old";
    return ({ change, side, renderDefault }) => {
      const n = markers.get(getChangeKey(change));
      return (
        <>
          {n !== undefined && side === markerSide && <span className="mk" title={`Finding ${n}`}>{n}</span>}
          {renderDefault()}
        </>
      );
    };
  }, [markers, split]);

  // The diff element is memoized below, so its handlers read the latest state through a ref.
  const latest = useRef({ picked, path, expand });
  latest.current = { picked, path, expand };
  const gutterEvents = useMemo(
    () => ({
      onClick: ({ change }: { change: ChangeData | null }, e: React.MouseEvent) => {
        const line = change ? newLine(change) : null;
        if (!line) return;
        const { picked, path } = latest.current;
        setCommenting(false);
        if (e.shiftKey && picked && picked.path === path) setPicked({ path, start: Math.min(picked.start, line), end: Math.max(picked.end, line) });
        else setPicked({ path, start: line, end: line });
      },
    }),
    [],
  );

  const pickedCode = () => {
    if (!pickedRange || !file) return "";
    return changesInRange({ ...file, hunks }, pickedRange)
      .filter((c) => c.type !== "delete")
      .map((c) => c.content)
      .join("\n");
  };

  // Search across the diff, and optionally the whole repository.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [repoResults, setRepoResults] = useState<{ path: string; line: number; text: string }[] | null>(null);
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchDiff(p.files, query, regex, caseSensitive, scope), [p.files, query, regex, caseSensitive, scope]);
  useEffect(() => setRepoResults(null), [query, regex, caseSensitive]);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  const goTo = (m: { path: string; line: number }) => {
    const inDiff = findFile(p.files, m.path);
    if (inDiff) {
      if (m.line > 0) p.onPickFile(filePath(inDiff), { path: filePath(inDiff), startLine: m.line, endLine: m.line });
      else p.onPickFile(filePath(inDiff));
    } else if (m.line > 0) p.onOpenInEditor?.(m.path, m.line);
  };
  const searchRepo = async () => {
    if (!p.onSearchRepo || !query) return;
    setRepoBusy(true);
    setRepoError(null);
    try {
      setRepoResults(await p.onSearchRepo(query, regex, caseSensitive));
    } catch (e) {
      setRepoError(String(e));
    } finally {
      setRepoBusy(false);
    }
  };

  const reviewedSet = useMemo(() => new Set(p.files.filter((f) => allReviewed(f.hunks.map((h) => hunkKey(f, h)), p.reviewed))), [p.files, p.reviewed]);
  const isReviewed = (f: FileData) => reviewedSet.has(f);
  const reviewedFiles = reviewedSet.size;
  const stats = useMemo(() => new Map(p.files.map((f) => [f, fileStats(f)])), [p.files]);

  const canExpand = !!file && file.type !== "delete" && !!p.onLoadSource;
  // Rebuilt only when the diff itself changes, not on every render of the app around it.
  const diffElement = useMemo(
    () =>
      file && (
        <Diff
          key={path}
          viewType={split ? "split" : "unified"}
          diffType={file.type}
          hunks={shownHunks}
          tokens={tokens ?? undefined}
          selectedChanges={selected}
          renderGutter={renderGutter}
          gutterEvents={gutterEvents as never}
          className="diff-pickable"
        >
          {(hs) =>
            hs.flatMap((h, i) => {
              const prev = i > 0 ? hs[i - 1] : null;
              const hidden = canExpand ? getCollapsedLinesCountBetween(prev, h) : 0;
              const start = prev ? prev.newStart + prev.newLines : 1;
              return [
                <Decoration key={`d-${h.content}`}>
                  {hidden > 0 ? (
                    <button type="button" className="expand-btn" onClick={() => latest.current.expand(start, h.newStart, prev ? prev.oldStart + prev.oldLines : 1)} title="Show the unchanged lines here">
                      <ChevronUp size={12} />Show {hidden} hidden {hidden === 1 ? "line" : "lines"}<span className="muted mono">{h.content}</span>
                    </button>
                  ) : (
                    <span>{h.content}</span>
                  )}
                </Decoration>,
                <Hunk key={`h-${h.content}`} hunk={h} />,
              ];
            })
          }
        </Diff>
      ),
    [file, path, split, shownHunks, tokens, selected, renderGutter, gutterEvents, canExpand],
  );

  const banner = p.activeFinding !== null ? p.findings[p.activeFinding] : undefined;
  const bannerOnFile = banner && file && banner.anchors.some((a) => findFile([file], a.path) === file);

  return (
    <div ref={rootRef} style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {!narrow && (
        <nav aria-label="Changed files" data-pane="outline" className="side" style={{ width: width < 1000 ? 220 : 260, flexShrink: 0, borderRight: "1px solid var(--line)" }}>
          <div className="ph">
            <span style={{ flex: 1 }}>Changed files</span>
            <span style={{ fontWeight: 400 }}>{reviewedFiles} of {p.files.length} reviewed</span>
            <button
              type="button"
              className={onlyFindings ? "tb on" : "tb"}
              aria-pressed={onlyFindings}
              aria-label="Only files with findings"
              title={onlyFindings ? "Show all files" : "Only files with findings"}
              onClick={() => setOnlyFindings(!onlyFindings)}
            >
              <Flag size={13} />
            </button>
          </div>
          <div className="scroll" style={{ padding: "0 6px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
            {listed.map((f) => {
              const fp = filePath(f);
              const s = stats.get(f) ?? fileStats(f);
              const Icon = fileIcon(fp);
              const n = counts.get(fp);
              const done = isReviewed(f);
              return (
                <button
                  key={fp}
                  type="button"
                  data-nav
                  className={file === f ? "file cur" : "file"}
                  title={done ? `${fp} (reviewed)` : fp}
                  onClick={() => p.onPickFile(fp)}
                  onContextMenu={contextMenu([
                    { label: "Open", run: () => p.onPickFile(fp) },
                    { label: done ? "Mark as not reviewed" : "Mark as reviewed", run: () => p.onReviewed(f.hunks.map((h) => hunkKey(f, h)), !done), separatorBefore: true },
                    { label: "Copy path", run: () => copyText(fp), separatorBefore: true },
                  ])}
                >
                  {done ? <Check size={14} className={file === f ? undefined : "tone-ok"} strokeWidth={2.5} /> : <Icon size={14} />}
                  <span className="mono ellipsis" style={{ flex: 1, opacity: skip(f) && file !== f ? 0.6 : 1 }}>{fp}</span>
                  {n ? <span className="rm" style={{ display: "inline-flex", alignItems: "center", gap: 2 }} title={`${n} ${n === 1 ? "finding" : "findings"}`}><Flag size={11} />{n}</span> : null}
                  <span className="mono rm">+{s.add} −{s.del}</span>
                </button>
              );
            })}
            {listed.length === 0 && <p className="muted" style={{ margin: "8px 10px", fontSize: 12 }}>No files with findings.</p>}
          </div>
        </nav>
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 8px 0 12px", borderBottom: "1px solid var(--line)", background: "var(--side)", flexShrink: 0 }}>
          <DiffModeSwitch mode="files" onMode={p.onMode} compact={narrow} />
          {narrow ? (
            <select
              aria-label="Changed file"
              className="mono"
              value={path}
              onChange={(e) => p.onPickFile(e.target.value)}
              style={{ flex: 1, minWidth: 0, height: 24, fontSize: 12, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 5 }}
            >
              {listed.map((f) => {
                const fp = filePath(f);
                const n = counts.get(fp);
                return <option key={fp} value={fp}>{n ? `⚑${n} ` : ""}{fp}</option>;
              })}
            </select>
          ) : (
            <span className="mono ellipsis" style={{ flex: 1, fontSize: 12 }}>{file ? path : "No changes"}</span>
          )}
          <button type="button" className={searchOpen ? "tb on" : "tb"} aria-pressed={searchOpen} aria-label="Search the diff" title="Search the diff" data-key="diff-search" data-cmd="find" onClick={() => setSearchOpen(!searchOpen)}>
            <Search size={14} />
          </button>
          <button
            type="button"
            className={p.hideWhitespace ? "tb on" : "tb"}
            aria-pressed={p.hideWhitespace}
            aria-label="Hide whitespace changes"
            title={p.hideWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
            onClick={() => p.onHideWhitespace(!p.hideWhitespace)}
          >
            <Space size={14} />
          </button>
          {file && (
            <label className={isReviewed(file) ? "review-check on" : "review-check"} title="Mark this file as reviewed">
              <input type="checkbox" data-review-toggle checked={isReviewed(file)} onChange={(e) => p.onReviewed(file.hunks.map((h) => hunkKey(file, h)), e.target.checked)} />
              {!narrow && "Reviewed"}
            </label>
          )}
          <div className="seg" role="group" aria-label="Diff layout">
            <button type="button" className={split ? "" : "on"} aria-pressed={!split} title="Unified" onClick={() => p.onSplit(false)}><Rows3 size={13} />{!narrow && "Unified"}</button>
            <button type="button" className={split ? "on" : ""} aria-pressed={split} disabled={!canSplit} title={canSplit ? "Split" : "Make the window wider to use split view"} onClick={() => p.onSplit(true)}><Columns2 size={13} />{!narrow && "Split"}</button>
          </div>
        </div>

        {searchOpen && (
          <div className="diff-search">
            <div className="diff-search-row">
              <label className="field" style={{ flex: 1, minWidth: 0 }}>
                <Search size={14} />
                <input ref={searchInput} placeholder={scope === "paths" ? "File path" : "Search changed lines"} aria-label="Search the diff" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)} />
              </label>
              <button type="button" className={regex ? "tb on" : "tb"} aria-pressed={regex} title="Regular expression" aria-label="Regular expression" onClick={() => setRegex(!regex)}><Regex size={14} /></button>
              <button type="button" className={caseSensitive ? "tb on" : "tb"} aria-pressed={caseSensitive} title="Match case" aria-label="Match case" onClick={() => setCaseSensitive(!caseSensitive)}><CaseSensitive size={15} /></button>
              <select className="set-input" style={{ minWidth: 0, width: "auto" }} aria-label="Search in" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                <option value="all">All lines</option>
                <option value="added">Added lines</option>
                <option value="removed">Removed lines</option>
                <option value="paths">File paths</option>
              </select>
              <button type="button" className="tb" aria-label="Close search" onClick={() => setSearchOpen(false)}><X size={14} /></button>
            </div>
            {query && (
              <div className="diff-results">
                {typeof results === "string" ? (
                  <p className="tone-crit" style={{ margin: 0, fontSize: 12 }}>{results}</p>
                ) : (
                  <>
                    <div className="muted diff-results-head">{results.length === 500 ? "500+ matches in the diff" : `${results.length} ${results.length === 1 ? "match" : "matches"} in the diff`}</div>
                    {results.slice(0, 200).map((m, i) => (
                      <button key={i} type="button" className="diff-result" onClick={() => goTo(m)}>
                        <span className={`dr-kind dr-${m.kind}`}>{m.kind === "add" ? "+" : m.kind === "del" ? "−" : m.kind === "path" ? "" : " "}</span>
                        <span className="mono ellipsis dr-path">{m.path.split("/").pop()}{m.line ? `:${m.line}` : ""}</span>
                        <span className="mono ellipsis" style={{ flex: 1 }}>{m.text}</span>
                      </button>
                    ))}
                  </>
                )}
                {p.onSearchRepo && scope !== "paths" && typeof results !== "string" && (
                  <div style={{ paddingTop: 6 }}>
                    {repoResults === null ? (
                      <button type="button" className="btn sm" disabled={repoBusy} onClick={searchRepo}><FolderSearch size={13} />{repoBusy ? "Searching…" : "Search the whole repository"}</button>
                    ) : (
                      <>
                        <div className="muted diff-results-head">{repoResults.length === 300 ? "300+ matches in the repository" : `${repoResults.length} ${repoResults.length === 1 ? "match" : "matches"} in the repository`}</div>
                        {repoResults.map((m, i) => (
                          <button key={`r${i}`} type="button" className="diff-result" onClick={() => goTo(m)} title={findFile(p.files, m.path) ? "Show in the diff" : "Open in your editor"}>
                            <span className="dr-kind">{findFile(p.files, m.path) ? "Δ" : ""}</span>
                            <span className="mono ellipsis dr-path">{m.path}:{m.line}</span>
                            <span className="mono ellipsis" style={{ flex: 1 }}>{m.text.trim()}</span>
                          </button>
                        ))}
                      </>
                    )}
                    {repoError && <p className="tone-crit" style={{ margin: "4px 0 0", fontSize: 12 }}>{repoError}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {banner && bannerOnFile && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 4px 12px", flexShrink: 0,
              borderBottom: `1px solid ${banner.severity === "critical" ? "var(--crit-line)" : "var(--line)"}`,
              background: banner.severity === "critical" ? "var(--crit-bg)" : "var(--sunken)",
            }}
          >
            {(() => {
              const sev = SEVERITY[banner.severity];
              return <span className={`sev ${sev.tone}`}><sev.icon size={16} />{sev.label}</span>;
            })()}
            <span className="ellipsis" style={{ flex: 1, fontWeight: 600 }}>{p.activeFinding! + 1}. {banner.title}</span>
            <button type="button" className="btn sm" onClick={p.onBack}><ArrowLeft size={13} />Back to finding</button>
            <button type="button" className="tb" aria-label="Previous finding (N)" onClick={() => p.onStepFinding(-1)}><ChevronUp size={16} /></button>
            <button type="button" className="tb" aria-label="Next finding (n)" onClick={() => p.onStepFinding(1)}><ChevronDown size={16} /></button>
          </div>
        )}

        {pickedRange && (
          <div className="pick-bar" role="toolbar" aria-label="Selected lines">
            <span className="mono" style={{ fontSize: 12 }}>{path.split("/").pop()}:{picked!.start}{picked!.end > picked!.start ? `–${picked!.end}` : ""}</span>
            <span className="muted" style={{ fontSize: 12 }}>Shift-click another line to extend</span>
            <span style={{ flex: 1 }} />
            {!commenting && p.onAskLines && (
              <button type="button" className="btn sm" onClick={() => p.onAskLines!(path, picked!.start, picked!.end, pickedCode())}><MessageSquare size={13} />Ask {agent}</button>
            )}
            {!commenting && p.onAddComment && (
              <button type="button" className="btn sm" onClick={() => setCommenting(true)}><MessageSquarePlus size={13} />Add comment</button>
            )}
            <button type="button" className="tb" aria-label="Clear selection" onClick={() => { setPicked(null); setCommenting(false); }}><X size={14} /></button>
            {commenting && (
              <form
                className="pick-comment"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!comment.trim() || !p.onAddComment) return;
                  p.onAddComment({ path, line: picked!.end, ...(picked!.end > picked!.start ? { start_line: picked!.start } : {}), body: comment.trim() });
                  setComment("");
                  setCommenting(false);
                  setPicked(null);
                }}
              >
                <textarea className="set-input" rows={2} autoFocus placeholder="Your comment; it goes into Submit review" aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button type="button" className="btn sm" onClick={() => setCommenting(false)}>Cancel</button>
                  <button type="submit" className="btn sm primary" disabled={!comment.trim()}>Add to review</button>
                </div>
              </form>
            )}
          </div>
        )}

        <div ref={scroller} data-pane="content" className="scroll" style={{ overflow: "auto" }}>
          {file && hideDiff && (
            <div className="empty" style={{ height: "auto", padding: "40px 24px" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <span className="tag">{hiddenAs === "test" ? "Test" : "Generated"}</span>
                <span>{hiddenAs === "test" ? "This is a test file, so its diff is hidden." : "This file looks generated, so its diff is hidden."}</span>
                <button type="button" className="btn sm" onClick={() => setShownGenerated(new Set([...shownGenerated, path]))}>
                  <Eye size={13} />Show diff
                </button>
              </div>
            </div>
          )}
          {expandError && <p className="tone-crit" style={{ margin: "6px 12px", fontSize: 12 }}>Couldn't load the file: {expandError}</p>}
          {file && !hideDiff && diffElement}
          {file && !hideDiff && truncated && (
            <div ref={sentinel} className="muted" style={{ padding: "10px 12px", fontSize: 12 }}>
              Showing {shownCount.toLocaleString()} of {changeCount.toLocaleString()} lines; scroll for more.
            </div>
          )}
          {file && !hideDiff && !truncated && p.onLoadSource && file.type !== "delete" && hunks.length > 0 && (
            <button
              type="button"
              className="expand-btn expand-end"
              onClick={() => {
                const last = hunks[hunks.length - 1];
                expand(last.newStart + last.newLines, Number.MAX_SAFE_INTEGER, last.oldStart + last.oldLines);
              }}
            >
              <ChevronDown size={12} />Show the rest of the file
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
