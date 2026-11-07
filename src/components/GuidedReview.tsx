import { ArrowLeft, Check, ChevronRight, Columns2, Files, Loader, Rows3, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Decoration, Diff, Hunk, getChangeKey, type FileData, type HunkData, type RenderGutter } from "react-diff-view";
import type { Anchor, Finding, WalkStep } from "../analysis";
import { changesInRange, filePath, fileStats, findFile, hunksForRanges } from "../diffUtils";
import { useElementWidth } from "../hooks";
import { fileIcon } from "../icons";
import { DiffModeSwitch, type DiffMode } from "./DiffView";
import { Markdown } from "./Markdown";

interface Props {
  files: FileData[];
  steps?: WalkStep[];
  findings: Finding[];
  current: number;
  reviewed: number[];
  split: boolean;
  generating?: { running: boolean; error?: string };
  canGenerate: boolean;
  onSplit: (split: boolean) => void;
  onMode: (m: DiffMode) => void;
  onStep: (i: number) => void;
  onReviewed: (i: number, reviewed: boolean) => void;
  onGenerate: () => void;
}

interface FilePart {
  file: FileData;
  hunks: HunkData[];
  ranges: Anchor[];
}

interface Step extends WalkStep {
  parts: FilePart[];
  synthetic?: boolean;
}

/** Resolves each step's line ranges to diff hunks, and adds a final step for anything left over. */
function resolveSteps(steps: WalkStep[], files: FileData[]): Step[] {
  const used = new Set<HunkData>();
  const out: Step[] = steps.map((s) => {
    const byFile = new Map<FileData, Anchor[]>();
    for (const r of s.changes) {
      const f = findFile(files, r.path);
      if (f) byFile.set(f, [...(byFile.get(f) ?? []), r]);
    }
    const parts = [...byFile.entries()]
      .map(([file, ranges]) => ({ file, ranges, hunks: hunksForRanges(file, ranges).filter((h) => !used.has(h)) }))
      .filter((part) => part.hunks.length > 0);
    parts.forEach((part) => part.hunks.forEach((h) => used.add(h)));
    return { ...s, parts };
  });
  const rest = files
    .map((file) => ({ file, ranges: [], hunks: file.hunks.filter((h) => !used.has(h)) }))
    .filter((part) => part.hunks.length > 0);
  if (rest.length) {
    out.push({ title: "Other changes", why: "- Changes that weren't grouped into a step", changes: [], parts: rest, synthetic: true });
  }
  return out.filter((s) => s.parts.length > 0);
}

function StepFile({ part, findings, split }: { part: FilePart; findings: Finding[]; split: boolean }) {
  const path = filePath(part.file);
  const Icon = fileIcon(path);
  const s = fileStats(part.file);
  // Everything shown already belongs to the step, so lines aren't highlighted; only finding markers stand out.
  const markers = useMemo(() => {
    const m = new Map<string, number>();
    findings.forEach((f, i) =>
      f.anchors.forEach((a) => {
        if (findFile([part.file], a.path) !== part.file) return;
        const first = changesInRange(part.file, a)[0];
        if (first && !m.has(getChangeKey(first))) m.set(getChangeKey(first), i + 1);
      }),
    );
    return m;
  }, [part, findings]);
  const renderGutter: RenderGutter = ({ change, side, renderDefault }) => {
    const n = markers.get(getChangeKey(change));
    return (
      <>
        {n !== undefined && side === (split ? "new" : "old") && <span className="mk" title={`Finding ${n}`}>{n}</span>}
        {renderDefault()}
      </>
    );
  };
  return (
    <div className="excerpt">
      <div className="exh">
        <Icon size={14} className="tone-muted" />
        <span className="mono ellipsis" style={{ flex: 1 }} title={path}>{path}</span>
        <span className="mono muted" style={{ fontSize: 11 }}>+{s.add} −{s.del}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <Diff viewType={split ? "split" : "unified"} diffType={part.file.type} hunks={part.hunks} renderGutter={renderGutter}>
          {(hunks) =>
            hunks.flatMap((h) => [
              <Decoration key={`d-${h.content}`}><span>{h.content}</span></Decoration>,
              <Hunk key={`h-${h.content}`} hunk={h} />,
            ])
          }
        </Diff>
      </div>
    </div>
  );
}

export function GuidedReview(p: Props) {
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const narrow = width > 0 && width < 700;
  const canSplit = width === 0 || width >= 900;
  const split = p.split && canSplit;
  const scroller = useRef<HTMLDivElement>(null);
  const steps = useMemo(() => (p.steps ? resolveSteps(p.steps, p.files) : []), [p.steps, p.files]);
  const cur = Math.min(p.current, Math.max(steps.length - 1, 0));
  const step = steps[cur];
  const done = (i: number) => p.reviewed.includes(i);
  const doneCount = steps.filter((_, i) => done(i)).length;

  useEffect(() => {
    // Braces matter: newer engines return a Promise from scrollTo, and an effect must not return it.
    scroller.current?.scrollTo({ top: 0 });
  }, [cur]);

  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 8px 0 12px", borderBottom: "1px solid var(--line)", background: "var(--side)", flexShrink: 0 }}>
      <DiffModeSwitch mode="guided" onMode={p.onMode} compact={narrow} />
      {narrow && steps.length > 0 ? (
        <select
          aria-label="Review step"
          value={cur}
          onChange={(e) => p.onStep(Number(e.target.value))}
          style={{ flex: 1, minWidth: 0, height: 24, fontSize: 12, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 5 }}
        >
          {steps.map((s, i) => <option key={i} value={i}>{done(i) ? "✓ " : ""}{i + 1}. {s.title}</option>)}
        </select>
      ) : (
        <span style={{ flex: 1 }} />
      )}
      <div className="seg" role="group" aria-label="Diff layout">
        <button type="button" className={split ? "" : "on"} aria-pressed={!split} title="Unified" onClick={() => p.onSplit(false)}><Rows3 size={13} />{!narrow && "Unified"}</button>
        <button type="button" className={split ? "on" : ""} aria-pressed={split} disabled={!canSplit} title={canSplit ? "Split" : "Make the window wider to use split view"} onClick={() => p.onSplit(true)}><Columns2 size={13} />{!narrow && "Split"}</button>
      </div>
    </div>
  );

  if (!steps.length) {
    return (
      <div ref={rootRef} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {toolbar}
        <div className="empty">
          <div style={{ maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <Sparkles size={32} strokeWidth={1.4} className="tone-accent" />
            <h2 style={{ margin: 0, fontSize: 15, color: "var(--text)" }}>Guided review</h2>
            <p style={{ margin: 0 }}>Claude groups related changes across files into steps, explains each one, and orders them so each builds on the last.</p>
            {p.generating?.running ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Loader size={14} className="spin" />Grouping the changes…</span>
            ) : p.canGenerate ? (
              <button type="button" className="btn primary" onClick={p.onGenerate}><Sparkles size={14} />Create guided review</button>
            ) : (
              <span>Start the review in the Analysis tab first.</span>
            )}
            {p.generating?.error && <span style={{ color: "var(--crit)" }}>{p.generating.error}</span>}
            <button type="button" className="btn sm" onClick={() => p.onMode("files")}><Files size={13} />Show all files instead</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {!narrow && (
        <nav aria-label="Review steps" className="side" style={{ width: width < 1000 ? 240 : 280, flexShrink: 0, borderRight: "1px solid var(--line)" }}>
          <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", fontSize: 12, fontWeight: 600 }} className="muted">
              <span style={{ flex: 1 }}>Guided review</span>
              <span style={{ fontWeight: 400 }}>{doneCount} of {steps.length} reviewed</span>
            </div>
            <div role="progressbar" aria-label="Review progress" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={steps.length} style={{ height: 3, borderRadius: 2, background: "var(--line)", overflow: "hidden" }}>
              <div style={{ width: `${(doneCount / steps.length) * 100}%`, height: 3, background: "var(--ok)" }} />
            </div>
          </div>
          <div className="scroll" style={{ padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {steps.map((s, i) => (
              <button key={i} type="button" className={i === cur ? "step-row cur" : "step-row"} onClick={() => p.onStep(i)}>
                <span className={done(i) ? "step-num done" : "step-num"}>{done(i) ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="step-title">{s.title}</span>
                  <span className="step-meta">{s.parts.length} {s.parts.length === 1 ? "file" : "files"}</span>
                </span>
              </button>
            ))}
          </div>
        </nav>
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {toolbar}
        <div ref={scroller} className="scroll" style={{ padding: narrow ? "14px 12px 20px" : "18px 20px 24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="selectable" style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 760 }}>
              <span className="muted" style={{ fontSize: 12 }}>Step {cur + 1} of {steps.length}</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>{step.title}</h2>
              <Markdown text={step.why} />
            </div>
            {step.parts.map((part, i) => <StepFile key={`${cur}-${i}`} part={part} findings={p.findings} split={split} />)}
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
              <button type="button" className="btn" disabled={cur === 0} onClick={() => p.onStep(cur - 1)}><ArrowLeft size={14} />Previous</button>
              <span style={{ flex: 1 }} />
              {done(cur) ? (
                <button type="button" className="btn in-review" onClick={() => p.onReviewed(cur, false)}><Check size={14} />Reviewed</button>
              ) : null}
              {cur < steps.length - 1 ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    p.onReviewed(cur, true);
                    p.onStep(cur + 1);
                  }}
                >
                  {done(cur) ? "Next step" : "Mark reviewed, next"}<ChevronRight size={14} />
                </button>
              ) : !done(cur) ? (
                <button type="button" className="btn primary" onClick={() => p.onReviewed(cur, true)}><Check size={14} />Mark reviewed</button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
