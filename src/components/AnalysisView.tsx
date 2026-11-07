import {
  ArrowLeft, ChevronDown, ChevronRight, ChevronUp, CircleCheck, FileDiff, FileText, FileX, Flag, Funnel, Loader, MessageSquare,
  MessageSquarePlus, Play, RefreshCw, Wrench,
} from "lucide-react";
import { useState } from "react";
import type { FileData } from "react-diff-view";
import { anchorLabel, type Analysis, type Anchor } from "../analysis";
import type { PrDetails } from "../api";
import { categoryIcon, fileIcon, SEVERITY, VERDICT } from "../icons";
import { changesInRange, findFile, lineNumbers } from "../diffUtils";
import { useElementWidth } from "../hooks";

export type OutlineKey = `f${number}` | `c${number}` | `o${number}`;

export interface RunState {
  running: boolean;
  step: string;
  log: string[];
  error?: string;
}

interface Props {
  pr: PrDetails;
  analysis?: Analysis;
  analysisRaw?: string;
  analyzedAt?: number;
  run?: RunState;
  files: FileData[];
  selected: OutlineKey;
  inReview: number[];
  onSelect: (k: OutlineKey) => void;
  onOpenAnchor: (a: Anchor, finding: number | null) => void;
  onStart: () => void;
  onCancel: () => void;
  onToggleReview: (finding: number) => void;
  onAsk: (text: string) => void;
}

function ago(ts?: number) {
  if (!ts) return "";
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export function AnalysisView(p: Props) {
  const [showVerified, setShowVerified] = useState(false);
  const [showMinor, setShowMinor] = useState(false);
  // In narrow panes the list and the detail take turns instead of sitting side by side.
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const [showDetail, setShowDetail] = useState(false);
  const single = width > 0 && width < 700;
  const outlineWidth = width < 980 ? 260 : 320;
  const a = p.analysis;
  const select = (k: OutlineKey) => {
    p.onSelect(k);
    setShowDetail(true);
  };

  if (!a) {
    return <StartPanel {...p} />;
  }

  const problems = a.claims.map((c, i) => ({ c, i })).filter(({ c }) => c.verdict !== "implemented");
  const verified = a.claims.map((c, i) => ({ c, i })).filter(({ c }) => c.verdict === "implemented");
  const major = a.findings.map((f, i) => ({ f, i })).filter(({ f }) => f.severity === "critical" || f.severity === "high");
  const minor = a.findings.map((f, i) => ({ f, i })).filter(({ f }) => f.severity === "medium" || f.severity === "low");
  const crit = a.findings.filter((f) => f.severity === "critical").length;
  const high = a.findings.filter((f) => f.severity === "high").length;

  const Row = ({ k, sub, Icon, tone, text, meta }: { k: OutlineKey; sub?: boolean; Icon: typeof Flag; tone: string; text: string; meta: string }) => (
    <button type="button" className={["row", sub && "sub", p.selected === k && "sel"].filter(Boolean).join(" ")} onClick={() => select(k)} title={text}>
      <Icon size={14} className={tone} />
      <span className="ellipsis" style={{ flex: 1 }}>{text}</span>
      <span className="rm">{meta}</span>
    </button>
  );
  const Toggle = ({ open, text, onClick }: { open: boolean; text: string; onClick: () => void }) => (
    <button type="button" className="row" aria-expanded={open} onClick={onClick}>
      {open ? <ChevronDown size={14} className="tone-muted" /> : <ChevronRight size={14} className="tone-muted" />}
      <span className="muted">{text}</span>
    </button>
  );
  const Group = ({ title, meta }: { title: string; meta: string }) => (
    <div className="gh" style={{ marginTop: 8 }}>
      <span style={{ flex: 1 }}>{title}</span>
      <span style={{ fontWeight: 400 }}>{meta}</span>
    </div>
  );

  const outline = (
      <div className="side" style={{ width: single ? "100%" : outlineWidth, flexShrink: 0, borderRight: single ? 0 : "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, height: 34, padding: "0 6px 0 12px", borderBottom: "1px solid var(--line)" }}>
          {p.run?.running ? <Loader size={14} className="spin tone-accent" /> : <CircleCheck size={14} className="tone-ok" />}
          <span className="ellipsis muted" style={{ flex: 1, fontSize: 12 }}>
            {p.run?.running ? p.run.step : `Analyzed ${ago(p.analyzedAt)}`}
          </span>
          <button type="button" className="tb" aria-label="Filter the list" title="Filter the list"><Funnel size={14} /></button>
          <button type="button" className="tb" aria-label="Re-run analysis" title="Re-run analysis" onClick={p.onStart} disabled={p.run?.running}>
            <RefreshCw size={14} />
          </button>
        </div>
        <nav aria-label="Analysis outline" className="scroll" style={{ padding: "0 6px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
          <Group title="Description check" meta={`${verified.length} of ${a.claims.length} verified`} />
          {problems.map(({ c, i }) => (
            <Row key={i} k={`c${i}`} Icon={VERDICT[c.verdict].icon} tone={VERDICT[c.verdict].tone} text={c.text} meta={String(i + 1)} />
          ))}
          {verified.length > 0 && <Toggle open={showVerified} text={`${verified.length} verified claims`} onClick={() => setShowVerified(!showVerified)} />}
          {showVerified && verified.map(({ c, i }) => <Row key={i} k={`c${i}`} sub Icon={VERDICT.implemented.icon} tone="tone-ok" text={c.text} meta={String(i + 1)} />)}

          <Group title="Findings" meta={crit || high ? `${crit} critical · ${high} high` : `${a.findings.length}`} />
          {major.map(({ f, i }) => (
            <Row key={i} k={`f${i}`} Icon={SEVERITY[f.severity].icon} tone={SEVERITY[f.severity].tone} text={f.title} meta={String(i + 1)} />
          ))}
          {minor.length > 0 && <Toggle open={showMinor} text={`${minor.length} medium and low findings`} onClick={() => setShowMinor(!showMinor)} />}
          {showMinor && minor.map(({ f, i }) => <Row key={i} k={`f${i}`} sub Icon={SEVERITY[f.severity].icon} tone={SEVERITY[f.severity].tone} text={f.title} meta={String(i + 1)} />)}

          {a.readingOrder.length > 0 && <Group title="Reading order" meta="" />}
          {a.readingOrder.map((r, i) => (
            <Row key={i} k={`o${i}`} Icon={fileIcon(r.path)} tone="tone-muted" text={r.path.split("/").pop() ?? r.path} meta={String(i + 1)} />
          ))}
        </nav>
      </div>
  );
  const detail = (
    <article className="scroll selectable" style={{ padding: single ? "14px 16px 24px" : "18px 24px 28px" }} aria-label="Details">
      <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 14 }}>
        <Detail {...p} analysis={a} />
      </div>
    </article>
  );

  return (
    <div ref={rootRef} style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {!single && outline}
      {!single && detail}
      {single && !showDetail && outline}
      {single && showDetail && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", height: 34, padding: "0 8px", borderBottom: "1px solid var(--line)", background: "var(--side)", flexShrink: 0 }}>
            <button type="button" className="btn sm" onClick={() => setShowDetail(false)}><ArrowLeft size={13} />All results</button>
          </div>
          {detail}
        </div>
      )}
    </div>
  );
}

function Excerpt({ files, anchor, onOpen }: { files: FileData[]; anchor: Anchor; onOpen: () => void }) {
  const file = findFile(files, anchor.path);
  const changes = file ? changesInRange(file, anchor, 1) : [];
  return (
    <div className="excerpt">
      <div className="exh">
        <FileDiff size={14} className="tone-muted" />
        <span className="mono ellipsis" style={{ flex: 1 }} title={anchor.path}>{anchorLabel(anchor)}</span>
        <button type="button" className="btn sm" onClick={onOpen}><FileDiff size={13} />Open in Diff</button>
      </div>
      <div style={{ padding: "4px 0", background: "var(--bg)" }}>
        {changes.length === 0 && <div className="muted" style={{ padding: "6px 12px", fontSize: 12 }}>These lines aren't part of the diff.</div>}
        {changes.map((c, i) => {
          const n = lineNumbers(c);
          const nl = Number(n.new);
          const hl = nl >= anchor.startLine && nl <= anchor.endLine;
          return (
            <div key={i} className={`dl ${c.type}${hl ? " hl" : ""}`}>
              <span className="n">{n.old}</span>
              <span className="n">{n.new}</span>
              <span>{c.type === "insert" ? "+" : c.type === "delete" ? "−" : ""}</span>
              <span className="t">{c.content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Detail(p: Props & { analysis: Analysis }) {
  const a = p.analysis;
  const kind = p.selected[0];
  const idx = Number(p.selected.slice(1));

  if (kind === "f" && a.findings[idx]) {
    const f = a.findings[idx];
    const sev = SEVERITY[f.severity];
    const Cat = categoryIcon(f.category);
    const inReview = p.inReview.includes(idx);
    const go = (d: number) => p.onSelect(`f${(idx + d + a.findings.length) % a.findings.length}`);
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className={`sev ${sev.tone}`}><sev.icon size={16} />{sev.label}</span>
          <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
            <Cat size={14} />{f.category}{f.confidence ? ` · ${f.confidence} confidence` : ""}
          </span>
          {f.notInDescription && <span className="tag"><FileX size={12} />Not in description</span>}
          <span style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: 12 }}>Finding {idx + 1} of {a.findings.length}</span>
          <button type="button" className="tb" aria-label="Previous finding (K)" onClick={() => go(-1)}><ChevronUp size={16} /></button>
          <button type="button" className="tb" aria-label="Next finding (J)" onClick={() => go(1)}><ChevronDown size={16} /></button>
        </div>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, lineHeight: 1.35 }}>{f.title}</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{f.body}</p>
        {f.anchors[0] && <Excerpt files={p.files} anchor={f.anchors[0]} onOpen={() => p.onOpenAnchor(f.anchors[0], idx)} />}
        {f.fix && (
          <div className="fix"><Wrench size={16} className="tone-ok" style={{ marginTop: 1, flexShrink: 0 }} /><span><b>Suggested fix: </b>{f.fix}</span></div>
        )}
        {f.anchors.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }} className="muted">
            Also in
            {f.anchors.slice(1).map((an, j) => (
              <button key={j} type="button" className="flink" title={an.path} onClick={() => p.onOpenAnchor(an, idx)}>{anchorLabel(an)}</button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, paddingTop: 6, borderTop: "1px solid var(--line2)" }}>
          <button type="button" className={inReview ? "btn in-review" : "btn"} aria-pressed={inReview} onClick={() => p.onToggleReview(idx)}>
            {inReview ? <CircleCheck size={14} /> : <MessageSquarePlus size={14} />}{inReview ? "In review" : "Add to review"}
          </button>
          <button type="button" className="btn" onClick={() => p.onAsk(`About finding ${idx + 1} ("${f.title}"): `)}><MessageSquare size={14} />Ask Claude</button>
        </div>
      </>
    );
  }

  if (kind === "c" && a.claims[idx]) {
    const c = a.claims[idx];
    const v = VERDICT[c.verdict] ?? VERDICT.partial;
    const fi = c.finding;
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={`sev ${v.tone}`}><v.icon size={16} />{v.label}</span>
          <span style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: 12 }}>Claim {idx + 1} of {a.claims.length}</span>
        </div>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, lineHeight: 1.35 }}>“{c.text}”</h2>
        {c.note && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{c.note}</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {c.anchors.map((an, j) => (
            <button key={j} type="button" className="flink" title={an.path} onClick={() => p.onOpenAnchor(an, null)}>{anchorLabel(an)}</button>
          ))}
          {fi !== undefined && a.findings[fi] && (
            <button type="button" className="btn sm" onClick={() => p.onSelect(`f${fi}`)}><Flag size={13} />Finding {fi + 1}</button>
          )}
        </div>
        <div className="excerpt">
          <div className="exh"><FileText size={14} className="tone-muted" /><span style={{ flex: 1 }}>PR description by {p.pr.author.login}</span></div>
          <div style={{ padding: "10px 14px 12px", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{p.pr.body?.trim() || "No description."}</div>
        </div>
      </>
    );
  }

  if (kind === "o" && a.readingOrder[idx]) {
    const r = a.readingOrder[idx];
    return (
      <>
        <span className="muted" style={{ fontSize: 12 }}>Reading order · step {idx + 1} of {a.readingOrder.length}</span>
        <h2 className="mono" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{r.path}</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{r.why}</p>
        <div>
          <button type="button" className="btn" onClick={() => p.onOpenAnchor({ path: r.path, startLine: 0, endLine: -1 }, null)}><FileDiff size={14} />Open in Diff</button>
        </div>
      </>
    );
  }

  return <p className="muted">Select an item in the list.</p>;
}

function StartPanel(p: Props) {
  const run = p.run;
  return (
    <div className="scroll selectable" style={{ padding: "24px 28px" }}>
      <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{run?.running ? "Reviewing with Claude" : "Start the review"}</h2>
        <p className="muted" style={{ margin: 0 }}>
          This checks out the PR in its own worktree, then Claude Code compares the description with the code and lists what to look at.
          Claude can only read files and run read-only git commands.
        </p>
        {!run?.running && (
          <div><button type="button" className="btn primary" onClick={p.onStart}><Play size={14} />Start review</button></div>
        )}
        {run?.running && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Loader size={14} className="spin tone-accent" />
            <span style={{ flex: 1 }}>{run.step}</span>
            <button type="button" className="btn sm" onClick={p.onCancel}>Cancel</button>
          </div>
        )}
        {run?.error && <p style={{ margin: 0, color: "var(--crit)" }}>{run.error}</p>}
        {p.analysisRaw && !run?.running && (
          <details>
            <summary className="muted">Claude's last answer couldn't be read as a result. Show it</summary>
            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{p.analysisRaw}</pre>
          </details>
        )}
        {run && run.log.length > 0 && (
          <div className="mono" style={{ padding: "8px 10px", borderRadius: 6, background: "var(--sunken)", fontSize: 11, lineHeight: 1.8, color: "var(--muted)", maxHeight: 320, overflow: "auto" }}>
            {run.log.map((l, i) => <div key={i} className="ellipsis">{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
