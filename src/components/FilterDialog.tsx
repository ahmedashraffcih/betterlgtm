import { Check, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FILTER_GROUPS, SORTS, type Filters, type SortKey } from "../inboxFilters";

export interface OwnerRow {
  name: string;
  count: number;
  visible: boolean;
  personal: boolean;
}

export interface RepoRow {
  name: string;
  count: number;
  visible: boolean;
}

interface Props {
  sort: SortKey;
  onSort: (s: SortKey) => void;
  filters: Filters;
  onFilters: (f: Filters) => void;
  showDrafts: boolean;
  onShowDrafts: (v: boolean) => void;
  owners: OwnerRow[];
  onOwner: (name: string, visible: boolean) => void;
  repos: RepoRow[];
  onRepo: (name: string, visible: boolean) => void;
  onClear: () => void;
  onManageOrgs: () => void;
  onClose: () => void;
}

/** Sort order, filters, and which organizations and repositories the inbox shows. Everything is saved. */
export function FilterDialog(p: Props) {
  const [repoQuery, setRepoQuery] = useState("");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [p]);

  const reposByOwner = useMemo(() => {
    const q = repoQuery.trim().toLowerCase();
    const map = new Map<string, RepoRow[]>();
    for (const r of p.repos) {
      if (q && !r.name.toLowerCase().includes(q)) continue;
      const owner = r.name.split("/")[0];
      map.set(owner, [...(map.get(owner) ?? []), r]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [p.repos, repoQuery]);

  return (
    <div className="palette-backdrop" onMouseDown={p.onClose}>
      <div className="dialog filter-dialog" role="dialog" aria-label="Sort and filter" onMouseDown={(e) => e.stopPropagation()}>
        <div className="filter-title">
          <span style={{ flex: 1, fontWeight: 600 }}>Sort and filter</span>
          <button type="button" className="tb" aria-label="Close" onClick={p.onClose}><X size={15} /></button>
        </div>

        <div className="filter-body">
          <section className="filter-col" aria-label="Sort and filters">
            <h3>Sort</h3>
            <div className="filter-sorts" role="radiogroup" aria-label="Sort">
              {SORTS.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={p.sort === k} className={p.sort === k ? "filter-sort on" : "filter-sort"} onClick={() => p.onSort(k)}>
                  <span className="menu-check">{p.sort === k && <Check size={13} />}</span>{label}
                </button>
              ))}
            </div>

            <h3>Filters</h3>
            {FILTER_GROUPS.map((g) => (
              <div key={g.key} className="filter-group">
                <span className="filter-label">{g.label}</span>
                <div className="seg filter-seg" role="radiogroup" aria-label={g.label}>
                  {g.options.map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={p.filters[g.key] === v} className={p.filters[g.key] === v ? "on" : ""} onClick={() => p.onFilters({ ...p.filters, [g.key]: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <label className="filter-check">
              <input type="checkbox" checked={p.showDrafts} onChange={(e) => p.onShowDrafts(e.target.checked)} />
              Show draft pull requests
            </label>
          </section>

          <section className="filter-col" aria-label="Organizations and repositories">
            <h3>Organizations</h3>
            {p.owners.length === 0 && <p className="muted filter-empty">No pull requests yet.</p>}
            <div className="filter-list">
              {p.owners.map((o) => (
                <label key={o.name} className="filter-check">
                  <input type="checkbox" checked={o.visible} onChange={(e) => p.onOwner(o.name, e.target.checked)} />
                  <span className="ellipsis" style={{ flex: 1 }}>{o.personal ? `${o.name} (personal)` : o.name}</span>
                  <span className="muted">{o.count}</span>
                </label>
              ))}
            </div>
            <button type="button" className="link" style={{ alignSelf: "flex-start", fontSize: 12 }} onClick={p.onManageOrgs}>All organizations…</button>

            <h3>Repositories</h3>
            <input className="set-input filter-search" placeholder="Find a repository" aria-label="Find a repository" value={repoQuery} onChange={(e) => setRepoQuery(e.target.value)} />
            <div className="filter-list filter-repos">
              {reposByOwner.map(([owner, repos]) => (
                <div key={owner}>
                  <div className="filter-owner">{owner}</div>
                  {repos.map((r) => (
                    <label key={r.name} className="filter-check">
                      <input type="checkbox" checked={r.visible} onChange={(e) => p.onRepo(r.name, e.target.checked)} />
                      <span className="ellipsis" style={{ flex: 1 }}>{r.name.split("/")[1]}</span>
                      <span className="muted">{r.count}</span>
                    </label>
                  ))}
                </div>
              ))}
              {reposByOwner.length === 0 && <p className="muted filter-empty">{repoQuery ? "No repository matches." : "No pull requests yet."}</p>}
            </div>
          </section>
        </div>

        <div className="filter-foot">
          <p className="muted" style={{ margin: 0, flex: 1, fontSize: 12 }}>Hidden organizations and repositories are also left out of notifications.</p>
          <button type="button" className="btn" onClick={p.onClear}>Clear filters</button>
          <button type="button" className="btn primary" onClick={p.onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
