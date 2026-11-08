import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileData } from "react-diff-view";
import { anchorLabel, type Analysis, type Finding, type FindingCheck, type FindingState } from "../analysis";
import { api, errorText, type PrDetails, type ReviewEvent } from "../api";
import { commentLines } from "../diffUtils";
import { SEVERITY } from "../icons";

interface Props {
  repo: string;
  details: PrDetails;
  analysis?: Analysis;
  files: FileData[];
  /** Findings the user added to the review; when empty, critical and high findings start checked. */
  inReview: number[];
  /** GitHub doesn't let you approve or request changes on your own pull request. */
  ownPr: boolean;
  /** Re-check results after new commits; fixed findings start unchecked. */
  checks?: Record<number, FindingCheck>;
  /** Dismissed, resolved or already-commented findings start unchecked. */
  states?: Record<number, FindingState>;
  onClose: () => void;
  onSubmitted: (url: string, postedFindings: number[]) => void;
}

interface Item {
  index: number;
  finding: Finding;
  checked: boolean;
  text: string;
  where: ReturnType<typeof commentLines>;
}

const EVENTS: [ReviewEvent, string][] = [
  ["COMMENT", "Comment"],
  ["APPROVE", "Approve"],
  ["REQUEST_CHANGES", "Request changes"],
];

function commentText(f: Finding): string {
  return `**${f.title}** (${SEVERITY[f.severity].label.toLowerCase()})\n\n${f.body}${f.fix ? `\n\n**Suggested fix:** ${f.fix}` : ""}`;
}

/** Posts a GitHub review, with the chosen findings as comments on their diff lines. */
export function SubmitReview(p: Props) {
  const findings = p.analysis?.findings ?? [];
  const [items, setItems] = useState<Item[]>(() =>
    findings.map((finding, index) => ({
      index,
      finding,
      checked: p.checks?.[index]?.status !== "fixed" && !p.states?.[index] && (p.inReview.length ? p.inReview.includes(index) : finding.severity === "critical" || finding.severity === "high"),
      text: commentText(finding),
      where: finding.anchors.map((a) => commentLines(p.files, a)).find(Boolean) ?? null,
    })),
  );
  const suggested: ReviewEvent = { approve: "APPROVE", request_changes: "REQUEST_CHANGES", comment: "COMMENT" }[p.analysis?.recommendation?.decision ?? "comment"] as ReviewEvent;
  const [event, setEvent] = useState<ReviewEvent>(p.ownPr ? "COMMENT" : suggested);
  const [summary, setSummary] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !sending && p.onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [p, sending]);

  const chosen = items.filter((i) => i.checked);
  const inline = chosen.filter((i) => i.where);
  const inBody = chosen.filter((i) => !i.where);
  const body = useMemo(
    () =>
      [summary.trim(), ...inBody.map((i) => `${i.text}${i.finding.anchors[0] ? `\n\n\`${anchorLabel(i.finding.anchors[0])}\`` : ""}`)]
        .filter(Boolean)
        .join("\n\n---\n\n"),
    [summary, inBody],
  );
  const empty = event !== "APPROVE" && !body && inline.length === 0;

  const allChecked = items.length > 0 && chosen.length === items.length;
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = chosen.length > 0 && !allChecked;
  }, [chosen.length, allChecked]);

  const update = (index: number, change: Partial<Item>) =>
    setItems((all) => all.map((i) => (i.index === index ? { ...i, ...change } : i)));

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      const url = await api.submitReview(p.repo, p.details.number, {
        commitId: p.details.headRefOid,
        event,
        body,
        comments: inline.map((i) => ({ ...i.where!, body: i.text })),
      });
      p.onSubmitted(url, chosen.map((i) => i.index));
    } catch (e) {
      setError(errorText(e));
      setSending(false);
    }
  };

  const action = EVENTS.find(([e]) => e === event)![1];
  return (
    <div className="palette-backdrop" onMouseDown={() => !sending && p.onClose()}>
      <div className="dialog review-dialog" role="dialog" aria-label="Submit review" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 8px 10px 16px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ flex: 1, fontWeight: 600 }}>Submit review</span>
          <button type="button" className="tb" aria-label="Open on GitHub" title="Open on GitHub" onClick={() => openUrl(`${p.details.url}/files`)}><ExternalLink size={15} /></button>
          <button type="button" className="tb" aria-label="Close" onClick={p.onClose} disabled={sending}><X size={15} /></button>
        </div>

        <div className="review-body">
          {findings.length > 0 ? (
            <>
              <div className="review-head">
                <label className="review-all">
                  <input
                    ref={selectAll}
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => setItems((all) => all.map((i) => ({ ...i, checked: e.target.checked })))}
                  />
                  Comment on all {items.length} findings
                </label>
                <span className="muted">{inline.length} on lines{inBody.length ? `, ${inBody.length} in the summary` : ""}</span>
              </div>
              {items.map((i) => {
                const sev = SEVERITY[i.finding.severity];
                const Icon = sev.icon;
                return (
                  <div key={i.index} className={i.checked ? "review-item on" : "review-item"}>
                    <label className="review-item-head">
                      <input type="checkbox" checked={i.checked} onChange={(e) => update(i.index, { checked: e.target.checked })} />
                      <Icon size={14} className={sev.tone} aria-label={sev.label} />
                      <span className="ellipsis" style={{ flex: 1 }}>{i.finding.title}</span>
                      {p.checks?.[i.index]?.status === "fixed" && <span className="check-badge check-ok" title={p.checks[i.index].note}>Fixed</span>}
                      {p.states?.[i.index] && <span className={`check-badge state-${p.states[i.index].state}`} title={p.states[i.index].reason}>{{ dismissed: "Dismissed", resolved: "Resolved", commented: "Commented" }[p.states[i.index].state]}</span>}
                      <span className="muted review-where">
                        {i.where ? `${i.where.path.split("/").pop()}:${i.where.start_line ? `${i.where.start_line}–` : ""}${i.where.line}` : "Not on a changed line"}
                      </span>
                    </label>
                    {i.checked && (
                      <>
                        <textarea className="set-input" rows={4} value={i.text} aria-label={`Comment for ${i.finding.title}`} onChange={(e) => update(i.index, { text: e.target.value })} />
                        {!i.where && <p className="muted review-note">GitHub only takes comments on lines in the diff, so this goes in the review summary.</p>}
                      </>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No findings to comment on. You can still leave a summary and a decision.</p>
          )}

          <div className="review-head" style={{ marginTop: 8 }}><span>Summary</span></div>
          <textarea className="set-input" rows={3} placeholder="Overall feedback (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} aria-label="Review summary" />
        </div>

        <div className="review-foot">
          <div className="seg" role="radiogroup" aria-label="Review decision">
            {EVENTS.map(([e, label]) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={event === e}
                className={event === e ? "on" : ""}
                disabled={p.ownPr && e !== "COMMENT"}
                title={p.ownPr && e !== "COMMENT" ? "GitHub doesn't allow this on your own pull request" : undefined}
                onClick={() => setEvent(e)}
              >
                {label}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={p.onClose} disabled={sending}>Cancel</button>
          <button type="button" className="btn primary" onClick={submit} disabled={sending || empty} title={empty ? "Add a comment or a summary first" : undefined}>
            <Send size={14} />{sending ? "Posting…" : action}
          </button>
        </div>
        {error && <p className="selectable review-error">{error}</p>}
      </div>
    </div>
  );
}
