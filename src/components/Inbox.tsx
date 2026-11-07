import { Building2, ChevronDown, ChevronLeft, ChevronRight, EyeOff, Funnel, Loader, OctagonExclamationPoint, PencilLine, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReviewRequest } from "../api";
import type { PrSession } from "../sessions";

interface Props {
  /** Already filtered by the organization and draft settings. */
  requests: ReviewRequest[] | null;
  /** Requests left out by those settings. */
  hiddenCount: number;
  error: string | null;
  loading: boolean;
  selected: string | null;
  focused: boolean;
  sessions: Record<string, PrSession>;
  analyzing: Set<string>;
  onSelect: (pr: ReviewRequest) => void;
  onRefresh: () => void;
  onHideOwner: (owner: string) => void;
  onManage: () => void;
  /** Shown in narrow windows, where the inbox normally sits collapsed as a strip. */
  onCollapse?: () => void;
}

export const prKey = (pr: { repository: { nameWithOwner: string }; number: number }) =>
  `${pr.repository.nameWithOwner}#${pr.number}`;

function age(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** Narrow strip of PR numbers shown instead of the full inbox when the window is small. */
export function InboxRail(p: Pick<Props, "requests" | "selected" | "sessions" | "analyzing" | "onSelect"> & { onExpand: () => void }) {
  const prs = p.requests ?? [];
  return (
    <nav aria-label="Review requests, collapsed" className="side rail-strip">
      <button type="button" className="tb" aria-label="Expand inbox" title="Expand inbox" onClick={p.onExpand}>
        <ChevronRight size={16} />
      </button>
      <div className="scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: "100%" }}>
        {prs.map((pr) => {
          const key = prKey(pr);
          const crit = p.sessions[key]?.analysis?.findings.some((f) => f.severity === "critical");
          return (
            <button
              key={key}
              type="button"
              className={p.selected === key ? "rail sel" : "rail"}
              title={`${pr.repository.nameWithOwner} #${pr.number} · ${pr.title}`}
              onClick={() => p.onSelect(pr)}
            >
              {pr.number}
              {p.analyzing.has(key) ? <span className="dot busy" /> : crit ? <span className="dot" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function Inbox(p: Props) {
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const map = new Map<string, ReviewRequest[]>();
    for (const pr of p.requests ?? []) {
      const org = pr.repository.nameWithOwner.split("/")[0];
      const hay = `${pr.title} ${pr.repository.nameWithOwner} ${pr.author.login}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      map.set(org, [...(map.get(org) ?? []), pr]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [p.requests, filter]);

  const visibleCount = groups.reduce((n, [, prs]) => n + prs.length, 0);

  return (
    <aside className="side" aria-label="Review requests">
      <div className="ph">
        <span style={{ flex: 1 }}>Review requests</span>
        <span style={{ fontWeight: 400 }}>{visibleCount}</span>
        <button type="button" className="tb" aria-label="Refresh" title="Refresh" onClick={p.onRefresh}>
          <RefreshCw size={14} className={p.loading ? "spin" : undefined} />
        </button>
        {p.onCollapse && (
          <button type="button" className="tb" aria-label="Collapse inbox" title="Collapse inbox" onClick={p.onCollapse}>
            <ChevronLeft size={14} />
          </button>
        )}
      </div>
      <div style={{ padding: "0 8px 8px" }}>
        <label className="field">
          <Funnel size={14} />
          <input placeholder="Filter" aria-label="Filter review requests" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      </div>
      <div className="scroll" style={{ padding: "0 6px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
        {p.error && <p className="selectable" style={{ margin: 8, color: "var(--crit)", fontSize: 12 }}>{p.error}</p>}
        {!p.error && p.requests && visibleCount === 0 && (
          <p style={{ margin: "12px 8px", fontSize: 12 }} className="muted">No review requests in the organizations you show.</p>
        )}
        {groups.map(([org, prs]) => {
          const isCollapsed = collapsed.includes(org);
          return (
            <div key={org} style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <button
                  type="button"
                  className="gh"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed(isCollapsed ? collapsed.filter((o) => o !== org) : [...collapsed, org])}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span style={{ flex: 1 }}>{org}</span>
                  <span style={{ fontWeight: 400 }}>{prs.length}</span>
                </button>
                <button type="button" className="tb" aria-label={`Hide ${org}`} title={`Hide ${org}`} onClick={() => p.onHideOwner(org)}>
                  <EyeOff size={13} />
                </button>
              </div>
              {!isCollapsed &&
                prs.map((pr) => {
                  const key = prKey(pr);
                  const s = p.sessions[key];
                  const findings = s?.analysis?.findings ?? [];
                  const crit = findings.filter((f) => f.severity === "critical").length;
                  const cls = ["pr", p.selected === key && "sel", p.selected === key && p.focused && "focused"].filter(Boolean).join(" ");
                  return (
                    <button key={key} type="button" className={cls} onClick={() => p.onSelect(pr)} title={pr.title}>
                      <span className="t1 ellipsis" style={{ width: "100%" }}>{pr.title}</span>
                      <span className="t2">
                        <span className="ellipsis" style={{ flex: 1 }}>
                          {pr.repository.name} #{pr.number} · {pr.author.login} · {age(pr.updatedAt)}
                        </span>
                        {p.analyzing.has(key) ? (
                          <span className="st" title="Analysis running"><Loader size={12} className="spin" />Analyzing</span>
                        ) : crit > 0 ? (
                          <span className="st crit" title={`${crit} critical findings`}><OctagonExclamationPoint size={12} />{crit} crit</span>
                        ) : s?.analysis ? (
                          <span className="st" title="Analyzed">{findings.length} found</span>
                        ) : pr.isDraft ? (
                          <span className="st" title="Draft pull request"><PencilLine size={12} />Draft</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 6px 12px", borderTop: "1px solid var(--line)", fontSize: 12 }} className="muted">
        {p.hiddenCount > 0 ? <EyeOff size={13} /> : <Building2 size={13} />}
        <span style={{ flex: 1 }} className="ellipsis">
          {p.hiddenCount > 0 ? `${p.hiddenCount} hidden by your organization settings` : "Showing all organizations"}
        </span>
        <button type="button" className="btn sm" onClick={p.onManage}>Organizations…</button>
      </div>
    </aside>
  );
}
