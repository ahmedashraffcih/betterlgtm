import { openUrl } from "@tauri-apps/plugin-opener";
import { Code, ExternalLink, FileDiff, GitBranch, Inbox as InboxIcon, ListChecks, Loader, Lock, MessageSquare, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { parseDiff, type FileData } from "react-diff-view";
import { api, describeToolUse, errorText, type ClaudeEvent, type PrDetails, type ReviewRequest } from "./api";
import { buildAnalysisPrompt, parseAnalysis, type Anchor } from "./analysis";
import { AnalysisView, type OutlineKey, type RunState } from "./components/AnalysisView";
import { ClaudePanel } from "./components/ClaudePanel";
import { DiffView } from "./components/DiffView";
import { Inbox, InboxRail, prKey } from "./components/Inbox";
import { TitleBar } from "./components/TitleBar";
import { useElementWidth } from "./hooks";
import { emptySession, useSessions, useStoredState, type ChatItem } from "./sessions";

interface Loaded {
  key: string;
  details: PrDetails;
  files: FileData[];
}

type ClaudeUsage = Pick<ClaudeEvent, "usage" | "total_cost_usd">;
const tokensOf = (e: ClaudeUsage) =>
  (e.usage?.input_tokens ?? 0) + (e.usage?.output_tokens ?? 0) + (e.usage?.cache_read_input_tokens ?? 0) + (e.usage?.cache_creation_input_tokens ?? 0);

export default function App() {
  const [requests, setRequests] = useState<ReviewRequest[] | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [hiddenOrgs, setHiddenOrgs] = useStoredState<string[]>("better-lgtm.hiddenOrgs", []);
  const [inboxOpen, setInboxOpen] = useStoredState("better-lgtm.inboxOpen", true);
  const [chatOpen, setChatOpen] = useStoredState("better-lgtm.chatOpen", true);
  const [split, setSplit] = useStoredState("better-lgtm.split", false);
  // Below this width the inbox sits collapsed as a strip unless the user expands it.
  const [appRef, appWidth] = useElementWidth<HTMLDivElement>();
  const compact = appWidth > 0 && appWidth < 1100;
  const [inboxExpanded, setInboxExpanded] = useState(false);

  const [selected, setSelected] = useState<ReviewRequest | null>(null);
  // With nothing selected the inbox is the whole point of the screen, so it never collapses then.
  const inboxMode = !inboxOpen ? "hidden" : compact && !inboxExpanded && selected ? "rail" : "full";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"analysis" | "diff">("analysis");
  const [focusPane, setFocusPane] = useState<"inbox" | "outline">("inbox");
  const [outlineKey, setOutlineKey] = useState<OutlineKey>("f0");
  const [diffTarget, setDiffTarget] = useState<{ path: string | null; range: Anchor | null; finding: number | null }>({ path: null, range: null, finding: null });

  const { sessions, update } = useSessions();
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [chatRunning, setChatRunning] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState("");
  const runIds = useRef<Record<string, string>>({});

  const key = selected ? prKey(selected) : null;
  const session = key ? sessions[key] ?? emptySession() : null;
  const analysis = session?.analysis;

  const refresh = useCallback(async () => {
    setInboxLoading(true);
    try {
      setRequests(await api.listReviewRequests());
      setInboxError(null);
      setSyncedAt(Date.now());
    } catch (e) {
      setInboxError(errorText(e));
    } finally {
      setInboxLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [refresh]);

  // Load PR details and diff when the selection changes.
  useEffect(() => {
    if (!selected || !key) return;
    let stale = false;
    setLoadError(null);
    const repo = selected.repository.nameWithOwner;
    Promise.all([api.prDetails(repo, selected.number), api.prDiff(repo, selected.number)])
      .then(([details, diff]) => !stale && setLoaded({ key, details, files: parseDiff(diff, { nearbySequences: "zip" }) }))
      .catch((e) => !stale && setLoadError(errorText(e)));
    return () => {
      stale = true;
    };
  }, [selected, key]);

  const setRun = (k: string, fn: (r: RunState) => RunState) =>
    setRuns((all) => ({ ...all, [k]: fn(all[k] ?? { running: false, step: "", log: [] }) }));

  const ensureWorktree = async (k: string, pr: ReviewRequest, details: PrDetails) => {
    const existing = sessions[k]?.worktree;
    if (existing && sessions[k]?.headOid === details.headRefOid) return existing;
    const wt = await api.prepareWorktree(pr.repository.nameWithOwner, pr.number, details.baseRefName);
    update(k, (s) => ({ ...s, worktree: wt, headOid: details.headRefOid }));
    return wt;
  };

  const startAnalysis = async () => {
    if (!selected || !loaded || loaded.key !== key || !key) return;
    const k = key;
    const pr = selected;
    const details = loaded.details;
    const runId = `analysis-${k}-${Date.now()}`;
    runIds.current[k] = runId;
    setRun(k, () => ({ running: true, step: "Preparing the worktree…", log: [] }));
    try {
      const wt = await ensureWorktree(k, pr, details);
      setRun(k, (r) => ({ ...r, step: "Claude is reading the change…", log: [...r.log, `Worktree: ${wt}`] }));
      let finalText = "";
      let sessionId: string | undefined;
      let usage: ClaudeUsage = {};
      await api.claudeRun(runId, wt, buildAnalysisPrompt(details), undefined, (e) => {
        if (e.session_id) sessionId = e.session_id;
        if (e.type === "assistant") {
          for (const block of e.message?.content ?? []) {
            if (block.type === "tool_use") {
              const line = describeToolUse(block.name ?? "", block.input);
              setRun(k, (r) => ({ ...r, step: line, log: [...r.log, line] }));
            }
          }
        }
        if (e.type === "result") {
          finalText = e.result ?? "";
          usage = e;
        }
      });
      const parsed = parseAnalysis(finalText);
      update(k, (s) => ({
        ...s,
        sessionId,
        analysis: parsed ?? s.analysis,
        analysisRaw: parsed ? undefined : finalText,
        analyzedAt: parsed ? Date.now() : s.analyzedAt,
        tokens: (s.tokens ?? 0) + tokensOf(usage),
        costUsd: (s.costUsd ?? 0) + (usage.total_cost_usd ?? 0),
      }));
      if (parsed) {
        setOutlineKey(parsed.findings.length ? "f0" : "c0");
        setFocusPane("outline");
      }
      setRun(k, (r) => ({ ...r, running: false, step: "", error: parsed ? undefined : "Claude finished, but its answer didn't contain a readable result." }));
    } catch (e) {
      setRun(k, (r) => ({ ...r, running: false, error: errorText(e) }));
    }
  };

  const cancelAnalysis = () => key && runIds.current[key] && api.claudeCancel(runIds.current[key]);

  const sendChat = async (text: string) => {
    if (!selected || !loaded || loaded.key !== key || !key) return;
    const k = key;
    const push = (item: ChatItem) => update(k, (s) => ({ ...s, chat: [...s.chat, item] }));
    push({ role: "user", text });
    setChatRunning((c) => ({ ...c, [k]: true }));
    const runId = `chat-${k}-${Date.now()}`;
    runIds.current[`chat-${k}`] = runId;
    try {
      const wt = await ensureWorktree(k, selected, loaded.details);
      await api.claudeRun(runId, wt, text, sessions[k]?.sessionId, (e) => {
        if (e.type === "assistant") {
          for (const block of e.message?.content ?? []) {
            if (block.type === "tool_use") push({ role: "tool", text: describeToolUse(block.name ?? "", block.input) });
            if (block.type === "text" && block.text?.trim()) push({ role: "assistant", text: block.text.trim() });
          }
        }
        if (e.type === "result") {
          update(k, (s) => ({
            ...s,
            sessionId: e.session_id ?? s.sessionId,
            tokens: (s.tokens ?? 0) + tokensOf(e),
            costUsd: (s.costUsd ?? 0) + (e.total_cost_usd ?? 0),
          }));
        }
      });
    } catch (e) {
      push({ role: "error", text: errorText(e) });
    } finally {
      setChatRunning((c) => ({ ...c, [k]: false }));
    }
  };

  const selectPr = (pr: ReviewRequest) => {
    setSelected(pr);
    setFocusPane("inbox");
    setTab("analysis");
    setDiffTarget({ path: null, range: null, finding: null });
    setOutlineKey("f0");
  };

  const openAnchor = (a: Anchor, finding: number | null) => {
    setDiffTarget({ path: a.path, range: a, finding });
    setTab("diff");
  };

  const stepFinding = (delta: number) => {
    if (!analysis?.findings.length) return;
    const n = analysis.findings.length;
    const cur = diffTarget.finding ?? (outlineKey[0] === "f" ? Number(outlineKey.slice(1)) : -1);
    const next = (cur + delta + n) % n;
    if (tab === "diff" && analysis.findings[next].anchors[0]) openAnchor(analysis.findings[next].anchors[0], next);
    setOutlineKey(`f${next}`);
  };

  // j / k move between findings when no text field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "j") stepFinding(1);
      if (e.key === "k") stepFinding(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const details = loaded && loaded.key === key ? loaded.details : null;
  const files = loaded && loaded.key === key ? loaded.files : [];
  const run = key ? runs[key] : undefined;
  const analyzing = useMemo(() => new Set(Object.entries(runs).filter(([, r]) => r.running).map(([k]) => k)), [runs]);
  const critHigh = analysis?.findings.filter((f) => f.severity === "critical" || f.severity === "high").length ?? 0;
  const ci = details?.statusCheckRollup ?? [];
  const ciFailing = ci.some((c) => ["FAILURE", "ERROR", "TIMED_OUT"].includes((c.conclusion ?? c.state ?? "").toUpperCase()));
  const ciPending = ci.some((c) => ["IN_PROGRESS", "QUEUED", "PENDING"].includes((c.status ?? c.state ?? "").toUpperCase()));

  const main = !selected ? (
    <div className="empty">
      <div>
        <InboxIcon size={40} strokeWidth={1.4} style={{ opacity: 0.7 }} />
        <h1 style={{ margin: "8px 0 4px", fontSize: 15, color: "var(--text)" }}>Select a pull request</h1>
        <p style={{ margin: 0 }}>
          {!requests ? "Loading review requests…" : requests.length === 1 ? "1 pull request is waiting for your review." : `${requests.length} pull requests are waiting for your review.`}
        </p>
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <section aria-label="Pull request" className="prhead">
        <div className="prhead-row">
          <h1 className="ellipsis" title={selected.title}>
            {selected.title} <span className="muted" style={{ fontWeight: 400 }}>#{selected.number}</span>
          </h1>
          <div className="seg" role="group" aria-label="View">
            <button type="button" className={tab === "analysis" ? "on" : ""} aria-pressed={tab === "analysis"} onClick={() => setTab("analysis")} title="Analysis">
              <ListChecks size={13} /><span className="lbl-text">Analysis</span>{critHigh > 0 && <span className="cnt crit">{critHigh}</span>}
            </button>
            <button type="button" className={tab === "diff" ? "on" : ""} aria-pressed={tab === "diff"} onClick={() => setTab("diff")} title="Diff">
              <FileDiff size={13} /><span className="lbl-text">Diff</span><span className="cnt">{files.length}</span>
            </button>
          </div>
          <button type="button" className="tb" aria-label="Open on GitHub" title="Open on GitHub" onClick={() => openUrl(selected.url)}><ExternalLink size={15} /></button>
          <button type="button" className="btn" disabled={!session?.worktree} aria-label="Open in editor" title={session?.worktree ?? "The worktree is created when the review starts"} onClick={() => session?.worktree && openUrl(`vscode://file${session.worktree}`)}>
            <Code size={14} /><span className="lbl-text">Open in editor</span>
          </button>
          <button type="button" className="btn primary" disabled aria-label="Submit review" title="Submit review">
            <Send size={14} /><span className="lbl-text">Submit review…</span>{(session?.inReview.length ?? 0) > 0 && <span className="cnt on-primary">{session?.inReview.length}</span>}
          </button>
        </div>
        {details && (
          <div className="prhead-meta muted">
            <span className="opt">{selected.repository.nameWithOwner}</span>
            <span className="opt">{details.author.login}</span>
            <span className="ellipsis" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><GitBranch size={13} style={{ flexShrink: 0 }} /><span className="mono ellipsis">{details.headRefName} → {details.baseRefName}</span></span>
            <span style={{ whiteSpace: "nowrap" }}>+{details.additions} −{details.deletions} · {details.changedFiles} files</span>
            <span className={ciFailing ? "tone-crit" : ciPending ? "tone-high" : "tone-ok"} style={{ whiteSpace: "nowrap" }}>{ci.length === 0 ? "No CI" : ciFailing ? "CI failing" : ciPending ? "CI running" : "CI passing"}</span>
          </div>
        )}
      </section>
      <div style={{ flex: 1, minHeight: 0 }}>
        {loadError && <p className="selectable" style={{ margin: 16, color: "var(--crit)" }}>{loadError}</p>}
        {!loadError && !details && <div className="empty"><Loader size={18} className="spin" /></div>}
        {details && tab === "analysis" && (
          <AnalysisView
            pr={details}
            analysis={analysis}
            analysisRaw={session?.analysisRaw}
            analyzedAt={session?.analyzedAt}
            run={run}
            files={files}
            selected={outlineKey}
            inReview={session?.inReview ?? []}
            onSelect={(k) => { setOutlineKey(k); setFocusPane("outline"); }}
            onOpenAnchor={openAnchor}
            onStart={startAnalysis}
            onCancel={cancelAnalysis}
            onToggleReview={(i) => key && update(key, (s) => ({ ...s, inReview: s.inReview.includes(i) ? s.inReview.filter((x) => x !== i) : [...s.inReview, i] }))}
            onAsk={(text) => { setChatOpen(true); setDraft(text); }}
          />
        )}
        {details && tab === "diff" && (
          <DiffView
            files={files}
            current={diffTarget.path}
            range={diffTarget.range}
            findings={analysis?.findings ?? []}
            activeFinding={diffTarget.finding}
            split={split}
            onSplit={setSplit}
            onPickFile={(path) => setDiffTarget({ path, range: null, finding: null })}
            onBack={() => { if (diffTarget.finding !== null) setOutlineKey(`f${diffTarget.finding}`); setTab("analysis"); }}
            onStepFinding={stepFinding}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="app" ref={appRef}>
      <TitleBar
        title={selected ? `${selected.repository.nameWithOwner} #${selected.number} · ${selected.title}` : "Jump to a PR, file or finding"}
        inboxOpen={inboxOpen}
        chatOpen={chatOpen}
        onToggleInbox={() => setInboxOpen(!inboxOpen)}
        onToggleChat={() => setChatOpen(!chatOpen)}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {inboxMode === "rail" && (
          <div style={{ width: 52, flexShrink: 0, borderRight: "1px solid var(--line)" }}>
            <InboxRail
              requests={requests}
              selected={key}
              sessions={sessions}
              hiddenOrgs={hiddenOrgs}
              analyzing={analyzing}
              onSelect={selectPr}
              onExpand={() => setInboxExpanded(true)}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
        <Group orientation="horizontal">
          {inboxMode === "full" && (
            <>
              <Panel id="inbox" defaultSize={compact ? 260 : 280} minSize={220} maxSize={420}>
                <Inbox
                  requests={requests}
                  error={inboxError}
                  loading={inboxLoading}
                  selected={key}
                  focused={focusPane === "inbox"}
                  sessions={sessions}
                  hiddenOrgs={hiddenOrgs}
                  analyzing={analyzing}
                  onSelect={(pr) => { selectPr(pr); if (compact) setInboxExpanded(false); }}
                  onRefresh={refresh}
                  onHiddenOrgsChange={setHiddenOrgs}
                  onCollapse={compact ? () => setInboxExpanded(false) : undefined}
                />
              </Panel>
              <Separator className="sep-v" />
            </>
          )}
          <Panel id="main" minSize={480}>
            <Group orientation="vertical">
              <Panel id="content" minSize={200}>{main}</Panel>
              {chatOpen && selected && (
                <>
                  <Separator className="sep-h" />
                  <Panel id="chat" defaultSize={220} minSize={120}>
                    <ClaudePanel
                      chat={session?.chat ?? []}
                      running={!!(key && chatRunning[key])}
                      draft={draft}
                      onDraft={setDraft}
                      onSend={sendChat}
                      onCancel={() => key && runIds.current[`chat-${key}`] && api.claudeCancel(runIds.current[`chat-${key}`])}
                      onHide={() => setChatOpen(false)}
                    />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>
        </Group>
        </div>
      </div>
      <footer className="statusbar" aria-label="Status bar">
        <span className="sb"><RefreshCw size={13} className={inboxLoading ? "spin" : undefined} />{syncedAt ? `Synced ${new Date(syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Syncing…"}</span>
        <span className="sb opt"><InboxIcon size={13} />{requests?.length ?? 0} to review</span>
        <span style={{ flex: 1 }} />
        {key && (
          <span className="sb">
            {run?.running || chatRunning[key] ? <Loader size={13} className="spin tone-accent" /> : <MessageSquare size={13} />}
            Claude {run?.running || chatRunning[key] ? "working" : "idle"}{session?.tokens ? ` · ${Math.round(session.tokens / 1000)}k tokens` : ""}
          </span>
        )}
        {details && <span className="sb opt ellipsis"><GitBranch size={13} />{details.headRefName} @ {details.headRefOid.slice(0, 7)}</span>}
        <span className="sb opt"><Lock size={13} />Read-only</span>
      </footer>
    </div>
  );
}
