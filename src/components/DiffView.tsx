import { ArrowLeft, Check, ChevronDown, ChevronUp, Columns2, Eye, Files, Flag, ListOrdered, Rows3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Decoration, Diff, Hunk, getChangeKey, type FileData, type RenderGutter } from "react-diff-view";
import type { Anchor, Finding } from "../analysis";
import { SEVERITY, fileIcon } from "../icons";
import { allReviewed, changeKeys, changesInRange, filePath, fileStats, findFile, hunkKey, isGenerated } from "../diffUtils";
import { useElementWidth } from "../hooks";

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

interface Props {
  onMode: (m: DiffMode) => void;
  reviewed: Set<string>;
  onReviewed: (hunkKeys: string[], reviewed: boolean) => void;
  hideGenerated: boolean;
  files: FileData[];
  current: string | null;
  range: Anchor | null;
  findings: Finding[];
  activeFinding: number | null;
  split: boolean;
  onSplit: (split: boolean) => void;
  onPickFile: (path: string) => void;
  onBack: () => void;
  onStepFinding: (delta: number) => void;
}

export function DiffView(p: Props) {
  const file = (p.current && findFile(p.files, p.current)) || p.files.find((f) => !isGenerated(f)) || p.files[0];
  // Generated files show a placeholder until the user asks for the diff.
  const [shownGenerated, setShownGenerated] = useState<Set<string>>(new Set());
  const hideDiff = !!file && p.hideGenerated && isGenerated(file) && !shownGenerated.has(filePath(file));
  const scroller = useRef<HTMLDivElement>(null);
  // Narrow panes swap the file list for a dropdown; split view needs room for two columns.
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const narrow = width > 0 && width < 700;
  const canSplit = width === 0 || width >= 900;
  const split = p.split && canSplit;

  const selected = useMemo(
    () => (file && p.range && p.range.startLine > 0 ? changeKeys(changesInRange(file, p.range)) : []),
    [file, p.range],
  );

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
    const el = scroller.current?.querySelector(".diff-code-selected");
    el?.scrollIntoView({ block: "center" });
  }, [selected]);

  const renderGutter: RenderGutter = ({ change, side, renderDefault }) => {
    const n = markers.get(getChangeKey(change));
    const markerSide = split ? "new" : "old";
    return (
      <>
        {n !== undefined && side === markerSide && <span className="mk" title={`Finding ${n}`}>{n}</span>}
        {renderDefault()}
      </>
    );
  };

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    p.findings.forEach((f) => {
      const paths = new Set(f.anchors.map((a) => (findFile(p.files, a.path) ? filePath(findFile(p.files, a.path)!) : a.path)));
      paths.forEach((path) => c.set(path, (c.get(path) ?? 0) + 1));
    });
    return c;
  }, [p.findings, p.files]);

  const isReviewed = (f: FileData) => allReviewed(f.hunks.map((h) => hunkKey(f, h)), p.reviewed);
  const reviewedFiles = p.files.filter(isReviewed).length;

  const banner = p.activeFinding !== null ? p.findings[p.activeFinding] : undefined;
  const bannerOnFile = banner && file && banner.anchors.some((a) => findFile([file], a.path) === file);

  return (
    <div ref={rootRef} style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {!narrow && (
      <nav aria-label="Changed files" data-pane="outline" className="side" style={{ width: width < 1000 ? 220 : 260, flexShrink: 0, borderRight: "1px solid var(--line)" }}>
        <div className="ph"><span style={{ flex: 1 }}>Changed files</span><span style={{ fontWeight: 400 }}>{reviewedFiles} of {p.files.length} reviewed</span></div>
        <div className="scroll" style={{ padding: "0 6px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
          {p.files.map((f) => {
            const path = filePath(f);
            const s = fileStats(f);
            const Icon = fileIcon(path);
            const n = counts.get(path);
            const done = isReviewed(f);
            return (
              <button key={path} type="button" data-nav className={file === f ? "file cur" : "file"} title={done ? `${path} (reviewed)` : path} onClick={() => p.onPickFile(path)}>
                {done ? <Check size={14} className={file === f ? undefined : "tone-ok"} strokeWidth={2.5} /> : <Icon size={14} />}
                <span className="mono ellipsis" style={{ flex: 1, opacity: isGenerated(f) && file !== f ? 0.6 : 1 }}>{path}</span>
                {n ?<span className="rm" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><Flag size={11} />{n}</span> : null}
                <span className="mono rm">+{s.add} −{s.del}</span>
              </button>
            );
          })}
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
              value={file ? filePath(file) : ""}
              onChange={(e) => p.onPickFile(e.target.value)}
              style={{ flex: 1, minWidth: 0, height: 24, fontSize: 12, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 5 }}
            >
              {p.files.map((f) => {
                const path = filePath(f);
                const n = counts.get(path);
                return <option key={path} value={path}>{n ? `⚑${n} ` : ""}{path}</option>;
              })}
            </select>
          ) : (
            <span className="mono ellipsis" style={{ flex: 1, fontSize: 12 }}>{file ? filePath(file) : "No changes"}</span>
          )}
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
            <button type="button" className="tb" aria-label="Previous finding (K)" onClick={() => p.onStepFinding(-1)}><ChevronUp size={16} /></button>
            <button type="button" className="tb" aria-label="Next finding (J)" onClick={() => p.onStepFinding(1)}><ChevronDown size={16} /></button>
          </div>
        )}
        <div ref={scroller} data-pane="content" className="scroll" style={{ overflow: "auto" }}>
          {file && hideDiff && (
            <div className="empty" style={{ height: "auto", padding: "40px 24px" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <span className="tag">Generated</span>
                <span>This file looks generated, so its diff is hidden.</span>
                <button type="button" className="btn sm" onClick={() => setShownGenerated(new Set([...shownGenerated, filePath(file)]))}>
                  <Eye size={13} />Show diff
                </button>
              </div>
            </div>
          )}
          {file && !hideDiff && (
            <Diff
              key={filePath(file)}
              viewType={split ? "split" : "unified"}
              diffType={file.type}
              hunks={file.hunks}
              selectedChanges={selected}
              renderGutter={renderGutter}
            >
              {(hunks) =>
                hunks.flatMap((h) => [
                  <Decoration key={`d-${h.content}`}><span>{h.content}</span></Decoration>,
                  <Hunk key={`h-${h.content}`} hunk={h} />,
                ])
              }
            </Diff>
          )}
        </div>
      </div>
    </div>
  );
}
