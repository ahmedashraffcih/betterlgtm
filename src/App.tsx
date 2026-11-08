import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Code, Download, ExternalLink, History, FileDiff, GitBranch, GitPullRequestArrow, Inbox as InboxIcon, ListChecks, ListOrdered, Loader, Lock, MessageSquare, RefreshCw, RotateCw, Send, Terminal, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { parseDiff, type FileData } from "react-diff-view";
import { api, describeToolUse, errorText, type ClaudeEvent, type LastReview, type PrDetails, type ReviewRequest } from "./api";
import { anchorLabel, buildAnalysisPrompt, buildRecheckPrompt, buildWalkthroughPrompt, parseAnalysis, parseRecheck, parseWalkthrough, type Anchor } from "./analysis";
import { AnalysisView, type OutlineKey, type RunState } from "./components/AnalysisView";
import { ClaudePanel, type ChatContext } from "./components/ClaudePanel";
import { DiffView, type DiffMode } from "./components/DiffView";
import { GuidedReview } from "./components/GuidedReview";
import { Inbox, InboxRail, prKey, type InboxView } from "./components/Inbox";
import { TitleBar } from "./components/TitleBar";
import { useElementWidth } from "./hooks";
import { matches, shortcutLabel, type Command } from "./commands";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette";
import { InfoDialog } from "./components/InfoDialog";
import { SubmitReview } from "./components/SubmitReview";
import { FilterDialog, type OwnerRow, type RepoRow } from "./components/FilterDialog";
import { FILTER_GROUPS, NO_FILTERS, type Filters, type SortKey } from "./inboxFilters";
import { ReviewStatus } from "./components/ReviewStatus";
import { filePath } from "./diffUtils";
import { fileIcon, SEVERITY } from "./icons";
import { emptySession, useSessions, useStoredState, type ChatItem } from "./sessions";
import { Settings, type SettingsSection } from "./components/Settings";
import { ownerVisible, useSettings } from "./settings";
import { useUpdater } from "./updates";
import { useReviewNotifications } from "./notify";

interface Loaded {
  key: string;
  details: PrDetails;
  bodyHtml: string;
  files: FileData[];
}

type Pane = "inbox" | "outline" | "content";
const PANES: Pane[] = ["inbox", "outline", "content"];
const paneEl = (p: Pane) => document.querySelector<HTMLElement>(`[data-pane="${p}"]`);
const navItems = (p: Pane) => [...(paneEl(p)?.querySelectorAll<HTMLElement>("[data-nav]") ?? [])];
const isCurrent = (el: HTMLElement) => el.matches(".sel, .cur, [aria-current='true']");

/** Your last review of a PR and, once loaded, what changed after it. */
interface SinceReview {
  review: LastReview | null;
  commits?: { oid: string; subject: string }[];
  files?: FileData[];
  loading?: boolean;
  error?: string;
}

const REVIEW_VERB: Record<string, string> = { APPROVED: "approved", CHANGES_REQUESTED: "requested changes", COMMENTED: "commented", DISMISSED: "reviewed" };

function ago(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

type ClaudeUsage = Pick<ClaudeEvent, "usage" | "total_cost_usd">;
const tokensOf = (e: ClaudeUsage) =>
  (e.usage?.input_tokens ?? 0) + (e.usage?.output_tokens ?? 0) + (e.usage?.cache_read_input_tokens ?? 0) + (e.usage?.cache_creation_input_tokens ?? 0);

export default function App() {
  const [requests, setRequests] = useState<ReviewRequest[] | null>(null);
  const [myPrs, setMyPrs] = useState<ReviewRequest[] | null>(null);
  const [inboxView, setInboxView] = useStoredState<InboxView>("better-lgtm.inboxView", "review");
  const [inboxSort, setInboxSort] = useStoredState<SortKey>("better-lgtm.inboxSort", "risk");
  const [storedFilters, setInboxFilters] = useStoredState<Filters>("better-lgtm.inboxFilters", NO_FILTERS);
  const inboxFilters = { ...NO_FILTERS, ...storedFilters };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [settings, updateSettings] = useSettings();
  const updater = useUpdater(settings.autoUpdate);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [infoDialog, setInfoDialog] = useState<"shortcuts" | "about" | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [recheckRuns, setRecheckRuns] = useState<Record<string, { running: boolean; error?: string }>>({});
  const [sinceReviews, setSinceReviews] = useState<Record<string, SinceReview>>({});
  /** Diff tab: the whole PR, or only what changed since your last review. */
  const [diffRange, setDiffRange] = useState<"all" | "since">("all");
  /** The last review posted from the app, per PR, so the status bar can link to it. */
  const [postedReviews, setPostedReviews] = useState<Record<string, string>>({});
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [orgs, setOrgs] = useState<{ login: string; orgs: string[] } | null>(null);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [inboxOpen, setInboxOpen] = useStoredState("better-lgtm.inboxOpen", true);
  const [chatOpen, setChatOpen] = useStoredState("better-lgtm.chatOpen", true);
  const split = settings.diffLayout === "split";
  const setSplit = (v: boolean) => updateSettings({ diffLayout: v ? "split" : "unified" });
  const diffMode = settings.diffMode;
  const setDiffMode = (m: DiffMode) => updateSettings({ diffMode: m });
  const [guideStep, setGuideStep] = useState(0);
  const [guideRuns, setGuideRuns] = useState<Record<string, { running: boolean; error?: string }>>({});
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
  const [focusPane, setFocusPane] = useState<Pane>("inbox");
  const [outlineKey, setOutlineKey] = useState<OutlineKey>("s0");
  const [diffTarget, setDiffTarget] = useState<{ path: string | null; range: Anchor | null; finding: number | null }>({ path: null, range: null, finding: null });

  const { sessions, update, clearAll } = useSessions();
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [chatRunning, setChatRunning] = useState<Record<string, boolean>>({});
  const [chatFocus, setChatFocus] = useState(0);
  const runIds = useRef<Record<string, string>>({});

  const key = selected ? prKey(selected) : null;
  const session = key ? sessions[key] ?? emptySession() : null;
  const analysis = session?.analysis;

  // The backend needs tool paths, the data folder and Claude options before it runs anything.
  useEffect(() => {
    api
      .setConfig({ ghPath: settings.ghPath, claudePath: settings.claudePath, dataDir: settings.dataDir, model: settings.model, effort: settings.effort })
      .then(() => setConfigReady(true))
      .catch(() => setConfigReady(true));
  }, [settings.ghPath, settings.claudePath, settings.dataDir, settings.model, settings.effort]);

  useEffect(() => {
    if (settings.theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const reloadOrgs = useCallback(() => {
    setOrgsError(null);
    api.listOrgs().then(setOrgs).catch((e) => setOrgsError(errorText(e)));
  }, []);
  useEffect(() => {
    if (configReady) reloadOrgs();
  }, [configReady, settings.ghPath, reloadOrgs]);

  const refresh = useCallback(async () => {
    setInboxLoading(true);
    try {
      const [review, mine] = await Promise.all([api.listReviewRequests(settings.includeTeams), api.listMyPrs()]);
      setRequests(review);
      setMyPrs(mine);
      setInboxError(null);
      setSyncedAt(Date.now());
    } catch (e) {
      setInboxError(errorText(e));
    } finally {
      setInboxLoading(false);
    }
  }, [settings.includeTeams, settings.ghPath]);

  useEffect(() => {
    if (!configReady) return;
    refresh();
    const t = setInterval(refresh, settings.refreshMinutes * 60 * 1000);
    return () => clearInterval(t);
  }, [refresh, configReady, settings.refreshMinutes]);

  // Shortcuts come from the command list (menus and palette use the same list); Escape closes Settings.
  const commandsRef = useRef<Command[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && settingsOpen && !paletteOpen && !infoDialog) {
        setSettingsOpen(false);
        return;
      }
      const t = e.target;
      const typing = t instanceof Element && !!t.closest("input, textarea, select");
      for (const c of commandsRef.current) {
        // While typing, only Ctrl shortcuts and function keys apply, so letters still reach the field.
        if (c.keys && c.enabled !== false && matches(e, c.keys) && (!typing || c.keys.ctrl || /^F\d+$/.test(c.keys.key))) {
          e.preventDefault();
          c.run();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, paletteOpen, infoDialog]);

  /** PRs that pass the organization and draft settings. */
  const visibleOf = useCallback(
    (list: ReviewRequest[] | null) =>
      list?.filter(
        (r) =>
          (settings.showDrafts || !r.isDraft) &&
          ownerVisible(settings, r.repository.nameWithOwner.split("/")[0], orgs?.orgs ?? null) &&
          !settings.hiddenRepos.includes(r.repository.nameWithOwner),
      ) ?? null,
    [settings, orgs],
  );
  const visibleRequests = useMemo(() => visibleOf(requests), [visibleOf, requests]);
  const visibleMine = useMemo(() => visibleOf(myPrs), [visibleOf, myPrs]);
  const inboxList = inboxView === "mine" ? visibleMine : visibleRequests;
  useReviewNotifications(visibleRequests, settings.notifications);
  const hiddenCount = inboxView === "mine" ? (myPrs?.length ?? 0) - (visibleMine?.length ?? 0) : (requests?.length ?? 0) - (visibleRequests?.length ?? 0);
  /** The inbox's "hide" button: drops an organization, or personal repositories, from the inbox. */
  /** Shows or hides an organization (or personal repositories) in the inbox, following the organization mode. */
  const setOwnerVisible = (owner: string, show: boolean) => {
    if (orgs && !orgs.orgs.includes(owner)) updateSettings({ includePersonal: show });
    else if (settings.orgMode === "all")
      updateSettings({ hiddenOrgs: show ? settings.hiddenOrgs.filter((o) => o !== owner) : [...new Set([...settings.hiddenOrgs, owner])] });
    else updateSettings({ selectedOrgs: show ? [...new Set([...settings.selectedOrgs, owner])] : settings.selectedOrgs.filter((o) => o !== owner) });
  };
  const hideOwner = (owner: string) => setOwnerVisible(owner, false);
  const setRepoVisible = (repo: string, show: boolean) =>
    updateSettings({ hiddenRepos: show ? settings.hiddenRepos.filter((r) => r !== repo) : [...new Set([...settings.hiddenRepos, repo])] });

  // Every owner and repository with an open PR in either list, for the filter dialog.
  const allPrs = useMemo(() => [...(requests ?? []), ...(myPrs ?? [])], [requests, myPrs]);
  const ownerRows: OwnerRow[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pr of allPrs) {
      const owner = pr.repository.nameWithOwner.split("/")[0];
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, visible: ownerVisible(settings, name, orgs?.orgs ?? null), personal: !!orgs && !orgs.orgs.includes(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allPrs, settings, orgs]);
  const repoRows: RepoRow[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pr of allPrs) counts.set(pr.repository.nameWithOwner, (counts.get(pr.repository.nameWithOwner) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count, visible: !settings.hiddenRepos.includes(name) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allPrs, settings.hiddenRepos]);
  const activeFilters = FILTER_GROUPS.filter((g) => inboxFilters[g.key] !== "any").length + (settings.showDrafts ? 0 : 1) + (settings.hiddenRepos.length ? 1 : 0);
  const clearFilters = () => {
    setInboxFilters(NO_FILTERS);
    updateSettings({ showDrafts: true, hiddenRepos: [] });
  };
  const openSettings = (section: SettingsSection) => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  // Load PR details and diff when the selection changes.
  useEffect(() => {
    if (!selected || !key) return;
    let stale = false;
    setLoadError(null);
    const repo = selected.repository.nameWithOwner;
    Promise.all([
      api.prDetails(repo, selected.number),
      api.prDiff(repo, selected.number),
      // The rendered description is a nicety; fall back to the raw Markdown if it fails.
      api.prBodyHtml(repo, selected.number).catch(() => ""),
    ])
      .then(([details, diff, bodyHtml]) => !stale && setLoaded({ key, details, bodyHtml, files: parseDiff(diff, { nearbySequences: "zip" }) }))
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

  const startAnalysis = async (opts: { since?: string } = {}) => {
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
      await api.claudeRun(runId, wt, buildAnalysisPrompt(details, settings.reviewInstructions, opts.since), undefined, (e) => {
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
        analysisSince: parsed ? opts.since : s.analysisSince,
        analysisHead: parsed ? details.headRefOid : s.analysisHead,
        findingChecks: parsed ? undefined : s.findingChecks,
        tokens: (s.tokens ?? 0) + tokensOf(usage),
        costUsd: (s.costUsd ?? 0) + (usage.total_cost_usd ?? 0),
      }));
      if (parsed) {
        setGuideStep(0);
        setOutlineKey("s0");
        setFocusPane("outline");
      }
      setRun(k, (r) => ({ ...r, running: false, step: "", error: parsed ? undefined : "Claude finished, but its answer didn't contain a readable result." }));
    } catch (e) {
      setRun(k, (r) => ({ ...r, running: false, error: errorText(e) }));
    }
  };

  const cancelAnalysis = () => key && runIds.current[key] && api.claudeCancel(runIds.current[key]);

  const sendChat = async (text: string, context: ChatContext | null) => {
    if (!selected || !loaded || loaded.key !== key || !key) return;
    const k = key;
    const push = (item: ChatItem) => update(k, (s) => ({ ...s, chat: [...s.chat, item] }));
    push({ role: "user", text, context: context?.label });
    const prompt = context ? `${context.prompt}\n\n${text}` : text;
    setChatRunning((c) => ({ ...c, [k]: true }));
    const runId = `chat-${k}-${Date.now()}`;
    runIds.current[`chat-${k}`] = runId;
    try {
      const wt = await ensureWorktree(k, selected, loaded.details);
      await api.claudeRun(runId, wt, prompt, sessions[k]?.sessionId, (e) => {
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
    setOutlineKey("s0");
    setGuideStep(0);
  };

  const openAnchor = (a: Anchor, finding: number | null) => {
    setDiffTarget({ path: a.path, range: a, finding });
    setDiffMode("files");
    setTab("diff");
  };

  /** Asks the analysis session to group the changes into steps, for analyses made before the guided review existed. */
  const generateWalkthrough = async () => {
    const s = key ? sessions[key] : undefined;
    if (!key || !s?.worktree || !s.sessionId) return;
    const k = key;
    setGuideRuns((g) => ({ ...g, [k]: { running: true } }));
    try {
      let text = "";
      let sessionId = s.sessionId;
      let usage: ClaudeUsage = {};
      await api.claudeRun(`guide-${k}-${Date.now()}`, s.worktree, buildWalkthroughPrompt(), s.sessionId, (e) => {
        if (e.type === "result") {
          text = e.result ?? "";
          sessionId = e.session_id ?? sessionId;
          usage = e;
        }
      });
      const steps = parseWalkthrough(text);
      if (!steps) throw new Error("Claude's answer didn't contain review steps. Try again.");
      update(k, (x) => ({
        ...x,
        sessionId,
        analysis: x.analysis ? { ...x.analysis, walkthrough: steps } : x.analysis,
        tokens: (x.tokens ?? 0) + tokensOf(usage),
        costUsd: (x.costUsd ?? 0) + (usage.total_cost_usd ?? 0),
      }));
      setGuideStep(0);
      setGuideRuns((g) => ({ ...g, [k]: { running: false } }));
    } catch (e) {
      setGuideRuns((g) => ({ ...g, [k]: { running: false, error: errorText(e) } }));
    }
  };

  /** After new commits, asks Claude which of the existing findings are fixed. */
  const recheckFindings = async () => {
    const s = key ? sessions[key] : undefined;
    const from = s?.analysisHead ?? s?.headOid;
    if (!key || !selected || !loaded || loaded.key !== key || !s?.analysis?.findings.length || !from) return;
    const k = key;
    const details = loaded.details;
    const findings = s.analysis.findings;
    setRecheckRuns((r) => ({ ...r, [k]: { running: true } }));
    try {
      const wt = await ensureWorktree(k, selected, details);
      let text = "";
      let sessionId = s.sessionId;
      let usage: ClaudeUsage = {};
      await api.claudeRun(`recheck-${k}-${Date.now()}`, wt, buildRecheckPrompt(findings, from), s.sessionId, (e) => {
        if (e.type === "result") {
          text = e.result ?? "";
          sessionId = e.session_id ?? sessionId;
          usage = e;
        }
      });
      const results = parseRecheck(text);
      if (!results) throw new Error("Claude's answer didn't say which findings are fixed. Try again.");
      update(k, (x) => ({
        ...x,
        sessionId,
        findingChecks: { from, head: details.headRefOid, at: Date.now(), results },
        tokens: (x.tokens ?? 0) + tokensOf(usage),
        costUsd: (x.costUsd ?? 0) + (usage.total_cost_usd ?? 0),
      }));
      setRecheckRuns((r) => ({ ...r, [k]: { running: false } }));
    } catch (e) {
      setRecheckRuns((r) => ({ ...r, [k]: { running: false, error: errorText(e) } }));
    }
  };

  const stepFinding = (delta: number) => {
    if (!analysis?.findings.length) return;
    const n = analysis.findings.length;
    const cur = diffTarget.finding ?? (outlineKey[0] === "f" ? Number(outlineKey.slice(1)) : -1);
    const next = (cur + delta + n) % n;
    if (tab === "diff" && analysis.findings[next].anchors[0]) openAnchor(analysis.findings[next].anchors[0], next);
    setOutlineKey(`f${next}`);
  };

  // Vim-style keys when no text field has focus: h/l pick a pane (inbox, side list, content),
  // j/k move inside it, and single letters run common actions. Ctrl shortcuts live in `commands`.
  const vimRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const pendingG = useRef(0);
  vimRef.current = (e: KeyboardEvent) => {
    const t = e.target;
    const typing = t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable]");
    if (typing) {
      // Esc leaves a text field, back to the keys.
      if (e.key === "Escape" && t instanceof HTMLElement && !paletteOpen && !reviewOpen) t.blur();
      return;
    }
    if (!settings.vimKeys || paletteOpen || infoDialog || reviewOpen || filtersOpen || settingsOpen || e.metaKey || e.altKey) return;
    // A focused button already handles Enter and Space itself.
    if (t instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;

    const panes = PANES.filter((p) => paneEl(p));
    const pane: Pane = panes.includes(focusPane) ? focusPane : panes[0] ?? "inbox";
    const scrollContent = (dy: number | "top" | "bottom") => {
      const el = paneEl("content");
      if (!el) return;
      if (dy === "top") el.scrollTo({ top: 0 });
      else if (dy === "bottom") el.scrollTo({ top: el.scrollHeight });
      else el.scrollBy({ top: dy });
    };
    const move = (p: Pane, to: number | "first" | "last") => {
      const list = navItems(p);
      if (!list.length) return;
      const cur = list.findIndex(isCurrent);
      const i = to === "first" ? 0 : to === "last" ? list.length - 1 : Math.min(list.length - 1, Math.max(0, (cur < 0 ? (to > 0 ? -1 : list.length) : cur) + to));
      list[i].click();
      list[i].scrollIntoView({ block: "nearest" });
    };
    const go = (to: number | "first" | "last") => {
      if (pane === "content") scrollContent(to === "first" ? "top" : to === "last" ? "bottom" : to * 80);
      else move(pane, to);
    };
    const switchPane = (d: number) => {
      const i = panes.indexOf(pane);
      const next = panes[Math.min(panes.length - 1, Math.max(0, i + d))];
      if (next) setFocusPane(next);
    };

    if (e.ctrlKey) {
      const half = (paneEl("content")?.clientHeight ?? 600) / 2;
      if (e.key === "d") { e.preventDefault(); scrollContent(half); }
      if (e.key === "u") { e.preventDefault(); scrollContent(-half); }
      return;
    }

    const now = Date.now();
    const g = e.key === "g" && now - pendingG.current < 600;
    pendingG.current = e.key === "g" && !g ? now : 0;
    const run = (f: () => void) => { e.preventDefault(); f(); };
    switch (e.key) {
      case "j": case "ArrowDown": return run(() => go(1));
      case "k": case "ArrowUp": return run(() => go(-1));
      case "g": return g ? run(() => go("first")) : undefined;
      case "G": return run(() => go("last"));
      case "h": return run(() => switchPane(-1));
      case "l": case "Enter": return run(() => switchPane(1));
      case "n": return run(() => stepFinding(1));
      case "N": return run(() => stepFinding(-1));
      case "]": return run(() => move("outline", 1));
      case "[": return run(() => move("outline", -1));
      case "1": return run(() => setTab("analysis"));
      case "2": return run(() => setTab("diff"));
      case "x": return run(() => document.querySelector<HTMLElement>("[data-review-toggle]")?.click());
      case "a": return run(() => document.querySelector<HTMLElement>('[data-key="add-review"]')?.click());
      case "i": return selected ? run(() => { setChatOpen(true); setChatFocus((c) => c + 1); }) : undefined;
      case "/": return run(() => (pane === "inbox" ? document.querySelector<HTMLElement>('[data-key="filter"]')?.focus() : setPaletteOpen(true)));
      case "r": return run(refresh);
      case "S": return details ? run(() => setReviewOpen(true)) : undefined;
      case "O": return selected ? run(() => openUrl(selected.url)) : undefined;
      case "?": return run(() => setInfoDialog("shortcuts"));
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => vimRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Show which pane the keys act on. React doesn't manage this attribute, so it survives renders.
  useEffect(() => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-pane]")) el.toggleAttribute("data-focused", el.dataset.pane === focusPane);
  });

  const details = loaded && loaded.key === key ? loaded.details : null;
  const files = loaded && loaded.key === key ? loaded.files : [];
  const since = key ? sinceReviews[key] : undefined;
  const lastReview = since?.review ?? null;
  const hasNewCommits = !!(details && lastReview && lastReview.commitId !== details.headRefOid);
  const diffFiles = diffRange === "since" && since?.files ? since.files : files;
  const analysisHead = session?.analysisHead ?? session?.headOid;
  /** The findings were made on an older commit than the PR's current head. */
  const analysisOutdated = !!(details && analysis?.findings.length && analysisHead && analysisHead !== details.headRefOid);
  const checks = session?.findingChecks && details && session.findingChecks.head === details.headRefOid ? session.findingChecks : undefined;
  const recheck = key ? recheckRuns[key] : undefined;

  // Your last review of the selected PR, to offer "since your review" when new commits arrived.
  const login = orgs?.login;
  useEffect(() => {
    if (!key || !details || !selected || !login || sinceReviews[key]) return;
    const k = key;
    api
      .lastReview(selected.repository.nameWithOwner, details.number, login)
      .then((review) => setSinceReviews((all) => ({ ...all, [k]: { review } })))
      .catch(() => setSinceReviews((all) => ({ ...all, [k]: { review: null } })));
  }, [key, details, login]);
  useEffect(() => setDiffRange("all"), [key]);

  const showSinceReview = () => {
    if (!key || !details || !selected || !lastReview) return;
    setTab("diff");
    setDiffRange("since");
    if (since?.files || since?.loading) return;
    const k = key;
    setSinceReviews((all) => ({ ...all, [k]: { ...all[k], loading: true, error: undefined } }));
    api
      .diffSince(selected.repository.nameWithOwner, details.number, details.baseRefName, lastReview.commitId)
      .then((r) => setSinceReviews((all) => ({ ...all, [k]: { ...all[k], loading: false, commits: r.commits, files: parseDiff(r.diff, { nearbySequences: "zip" }) } })))
      .catch((e) => {
        setSinceReviews((all) => ({ ...all, [k]: { ...all[k], loading: false, error: errorText(e) } }));
        setDiffRange("all");
      });
  };
  const run = key ? runs[key] : undefined;
  const analyzing = useMemo(() => new Set(Object.entries(runs).filter(([, r]) => r.running).map(([k]) => k)), [runs]);
  const critHigh = analysis?.findings.filter((f) => f.severity === "critical" || f.severity === "high").length ?? 0;
  const ci = details?.statusCheckRollup ?? [];
  const ciFailing = ci.some((c) => ["FAILURE", "ERROR", "TIMED_OUT"].includes((c.conclusion ?? c.state ?? "").toUpperCase()));
  const ciPending = ci.some((c) => ["IN_PROGRESS", "QUEUED", "PENDING"].includes((c.status ?? c.state ?? "").toUpperCase()));

  // Review progress, shared by the guided steps and the file list.
  const reviewedHunks = useMemo(() => new Set(session?.reviewedHunks ?? []), [session?.reviewedHunks]);
  const setReviewed = (hunkKeys: string[], value: boolean) =>
    key &&
    update(key, (s) => {
      const set = new Set(s.reviewedHunks ?? []);
      hunkKeys.forEach((h) => (value ? set.add(h) : set.delete(h)));
      return { ...s, reviewedHunks: [...set] };
    });

  // What the chat question is about: the finding, claim or file the user is looking at.
  const chatContext = ((): ChatContext | null => {
    if (tab === "analysis" && analysis) {
      const k = outlineKey[0];
      const i = Number(outlineKey.slice(1));
      const f = k === "f" ? analysis.findings[i] : undefined;
      if (f) {
        return {
          label: `Finding ${i + 1}: ${f.title}`,
          prompt: `The question is about finding ${i + 1} from your analysis: "${f.title}" (${f.anchors.map(anchorLabel).join(", ")}).`,
          suggestions: ["Is this a real problem?", "How would you fix it?", "Draft a review comment for this"],
        };
      }
      const c = k === "c" ? analysis.claims[i] : undefined;
      if (c) {
        return {
          label: `Claim ${i + 1}: ${c.text}`,
          prompt: `The question is about this claim from the PR description: "${c.text}" (your verdict: ${c.verdict}).`,
          suggestions: ["Where is this implemented?", "What is missing?", "Draft a review comment for this"],
        };
      }
    }
    const step = tab === "diff" && diffMode === "guided" ? analysis?.walkthrough?.[guideStep] : undefined;
    if (step) {
      return {
        label: `Step ${guideStep + 1}: ${step.title}`,
        prompt: `The question is about step ${guideStep + 1} of the guided review, "${step.title}", which covers ${step.changes.map(anchorLabel).join(", ")}.`,
        suggestions: ["Explain this step", "What could go wrong here?", "Is this covered by tests?"],
      };
    }
    if (tab === "diff" && diffMode === "files" && diffTarget.path) {
      const r = diffTarget.range;
      const where = r && r.startLine > 0 ? anchorLabel(r) : diffTarget.path.split("/").pop() ?? diffTarget.path;
      return {
        label: where,
        prompt: `The question is about ${diffTarget.path}${r && r.startLine > 0 ? ` lines ${r.startLine}-${r.endLine}` : ""} in this PR.`,
        suggestions: ["Explain this change", "What calls this code?", "Is this covered by tests?"],
      };
    }
    return null;
  })();
  const chatHasContent = (session?.chat.length ?? 0) > 0 || !!(key && chatRunning[key]);
  const chatProps = {
    chat: session?.chat ?? [],
    running: !!(key && chatRunning[key]),
    context: chatContext,
    focusSignal: chatFocus,
    onSend: sendChat,
    onCancel: () => key && runIds.current[`chat-${key}`] && api.claudeCancel(runIds.current[`chat-${key}`]),
    onClear: () => key && update(key, (s) => ({ ...s, chat: [] })),
    onHide: () => setChatOpen(false),
  };

  const openInEditor = () => session?.worktree && openUrl(`vscode://file${session.worktree}`);
  const canAnalyze = !!(details && !run?.running);
  const commands: Command[] = [
    { id: "refresh", menu: "File", label: "Refresh pull requests", keys: { key: "F5" }, run: refresh },
    { id: "github", menu: "File", label: "Open pull request on GitHub", enabled: !!selected, run: () => selected && openUrl(selected.url), separatorBefore: true },
    { id: "editor", menu: "File", label: "Open worktree in VS Code", enabled: !!session?.worktree, run: openInEditor },
    { id: "settings", menu: "File", label: "Settings…", keys: { key: ",", ctrl: true }, run: () => openSettings("general"), separatorBefore: true },
    { id: "quit", menu: "File", label: "Quit", keys: { key: "q", ctrl: true }, run: () => getCurrentWindow().close(), separatorBefore: true },

    { id: "filters", menu: "View", label: "Sort and filter…", run: () => setFiltersOpen(true) },
    { id: "palette", menu: "View", label: "Go to…", keys: { key: "k", ctrl: true }, run: () => setPaletteOpen(true) },
    { id: "inbox", menu: "View", label: "Inbox panel", checked: inboxOpen, keys: { key: "b", ctrl: true }, run: () => setInboxOpen(!inboxOpen), separatorBefore: true },
    { id: "chat", menu: "View", label: "Claude panel", checked: chatOpen, keys: { key: "j", ctrl: true }, run: () => setChatOpen(!chatOpen) },
    { id: "tab-analysis", menu: "View", label: "Analysis", checked: !!selected && tab === "analysis", enabled: !!selected, keys: { key: "1", ctrl: true }, run: () => setTab("analysis"), separatorBefore: true },
    { id: "tab-diff", menu: "View", label: "Diff", checked: !!selected && tab === "diff", enabled: !!selected, keys: { key: "2", ctrl: true }, run: () => setTab("diff") },
    { id: "guided", menu: "View", label: "Guided review", checked: diffMode === "guided", run: () => { setDiffMode("guided"); if (selected) setTab("diff"); }, separatorBefore: true },
    { id: "files", menu: "View", label: "All files", checked: diffMode === "files", run: () => { setDiffMode("files"); if (selected) setTab("diff"); } },
    { id: "split", menu: "View", label: "Split diff", checked: split, run: () => setSplit(!split) },
    { id: "theme-system", menu: "View", label: "System theme", checked: settings.theme === "system", run: () => updateSettings({ theme: "system" }), separatorBefore: true },
    { id: "theme-light", menu: "View", label: "Light theme", checked: settings.theme === "light", run: () => updateSettings({ theme: "light" }) },
    { id: "theme-dark", menu: "View", label: "Dark theme", checked: settings.theme === "dark", run: () => updateSettings({ theme: "dark" }) },

    { id: "analyze", menu: "Review", label: analysis ? "Re-run analysis" : "Start review", enabled: canAnalyze, run: () => { setTab("analysis"); startAnalysis(); } },
    { id: "guide", menu: "Review", label: "Create guided review", enabled: !!(analysis && !analysis.walkthrough && session?.sessionId && !(key && guideRuns[key]?.running)), run: () => { setDiffMode("guided"); setTab("diff"); generateWalkthrough(); } },
    { id: "next", menu: "Review", label: "Next finding", hint: "J", enabled: !!analysis?.findings.length, run: () => stepFinding(1), separatorBefore: true },
    { id: "prev", menu: "Review", label: "Previous finding", hint: "K", enabled: !!analysis?.findings.length, run: () => stepFinding(-1) },
    { id: "submit", menu: "Review", label: "Submit review…", keys: { key: "Enter", ctrl: true, shift: true }, enabled: !!details, run: () => setReviewOpen(true), separatorBefore: true },
    { id: "ask", menu: "Review", label: "Ask Claude", keys: { key: "l", ctrl: true }, enabled: !!selected, run: () => { setChatOpen(true); setChatFocus((n) => n + 1); }, separatorBefore: true },
    { id: "clear-chat", menu: "Review", label: "Clear conversation", enabled: !!session?.chat.length, run: () => key && update(key, (s) => ({ ...s, chat: [] })) },

    { id: "shortcuts", menu: "Help", label: "Keyboard shortcuts", keys: { key: "/", ctrl: true }, run: () => setInfoDialog("shortcuts") },
    { id: "updates", menu: "Help", label: "Check for updates…", enabled: updater.supported, run: () => updater.checkNow(true), separatorBefore: true },
    { id: "about", menu: "Help", label: "About BetterLGTM", run: () => setInfoDialog("about") },
  ];
  commandsRef.current = commands;

  /** A palette item that opens any PR typed as a GitHub link or owner/repo#number. */
  const openPrItem = (q: string): PaletteItem | null => {
    const m = q.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/) ?? q.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
    if (!m) return null;
    const [repo, number] = [m[1], Number(m[2])];
    return {
      id: `open-${repo}#${number}`,
      group: "Open",
      label: `Open ${repo}#${number}`,
      icon: <GitPullRequestArrow size={14} />,
      run: () =>
        selectPr({
          number,
          title: `${repo}#${number}`,
          url: `https://github.com/${repo}/pull/${number}`,
          isDraft: false,
          updatedAt: new Date().toISOString(),
          author: { login: "" },
          repository: { name: repo.split("/")[1], nameWithOwner: repo },
        }),
    };
  };

  // Everything the Ctrl+K palette can jump to.
  const paletteItems: PaletteItem[] = paletteOpen
    ? [
        ...[...(visibleRequests ?? []), ...(visibleMine ?? []).filter((m) => !visibleRequests?.some((r) => prKey(r) === prKey(m)))].map((pr) => ({
          id: `pr-${prKey(pr)}`,
          group: "Pull requests",
          label: pr.title,
          detail: `${pr.repository.nameWithOwner} #${pr.number}`,
          icon: <GitPullRequestArrow size={14} />,
          run: () => selectPr(pr),
        })),
        ...(analysis?.findings ?? []).map((f, i) => {
          const sev = SEVERITY[f.severity];
          return {
            id: `f-${i}`,
            group: "Findings",
            label: f.title,
            detail: `${sev.label} · finding ${i + 1}`,
            icon: <sev.icon size={14} className={sev.tone} />,
            run: () => { setTab("analysis"); setOutlineKey(`f${i}`); setFocusPane("outline"); },
          };
        }),
        ...(analysis?.walkthrough ?? []).map((s, i) => ({
          id: `s-${i}`,
          group: "Guided review sections",
          label: s.title,
          detail: `Section ${i + 1}`,
          icon: <ListOrdered size={14} />,
          run: () => { setDiffMode("guided"); setTab("diff"); setGuideStep(i); },
        })),
        ...files.map((f) => {
          const path = filePath(f);
          const Icon = fileIcon(path);
          return {
            id: `file-${path}`,
            group: "Changed files",
            label: path.split("/").pop() ?? path,
            detail: path,
            icon: <Icon size={14} />,
            run: () => openAnchor({ path, startLine: 0, endLine: -1 }, null),
          };
        }),
        ...commands
          .filter((c) => c.enabled !== false && c.id !== "palette")
          .map((c) => ({ id: `cmd-${c.id}`, group: "Commands", label: c.label, detail: shortcutLabel(c), icon: <Terminal size={14} />, run: c.run })),
      ]
    : [];

  const main = !selected ? (
    <div className="empty">
      <div>
        <InboxIcon size={40} strokeWidth={1.4} style={{ opacity: 0.7 }} />
        <h1 style={{ margin: "8px 0 4px", fontSize: 15, color: "var(--text)" }}>Select a pull request</h1>
        <p style={{ margin: 0 }}>
          {!visibleRequests ? "Loading review requests…" : visibleRequests.length === 1 ? "1 pull request is waiting for your review." : `${visibleRequests.length} pull requests are waiting for your review.`}
        </p>
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <section aria-label="Pull request" className="prhead">
        <div className="prhead-row">
          <h1 className="ellipsis" title={details?.title ?? selected.title}>
            {details?.title ?? selected.title} <span className="muted" style={{ fontWeight: 400 }}>#{selected.number}</span>
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
          <button type="button" className="btn primary" disabled={!details} aria-label="Submit review" title="Submit review on GitHub" onClick={() => setReviewOpen(true)}>
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
        {details && <ReviewStatus details={details} me={orgs?.login} />}
      </section>
      {(hasNewCommits || analysisOutdated) && (
        <div className="since-bar" role="status" title={since?.commits?.map((c) => `${c.oid.slice(0, 7)} ${c.subject}`).join("\n")}>
          {since?.loading || recheck?.running ? <Loader size={14} className="spin" /> : <History size={14} className="tone-accent" />}
          <span className="ellipsis" style={{ minWidth: 0 }}>
            {hasNewCommits && lastReview ? (
              <>
                <strong>{since?.commits ? `${since.commits.length} new ${since.commits.length === 1 ? "commit" : "commits"}` : "New commits"}</strong>
                {` since you ${REVIEW_VERB[lastReview.state] ?? "reviewed"} ${ago(lastReview.submittedAt)}`}
              </>
            ) : (
              <strong>New commits since the analysis</strong>
            )}
            {checks ? (
              <span className="muted">{` · ${Object.values(checks.results).filter((r) => r.status === "fixed").length} of ${analysis?.findings.length ?? 0} findings fixed`}</span>
            ) : recheck?.running ? (
              <span className="muted"> · Claude is re-checking the findings…</span>
            ) : null}
            {hasNewCommits && lastReview && session?.analysisSince === lastReview.commitId && <span className="muted"> · analysis covers them</span>}
          </span>
          <span style={{ flex: 1 }} />
          {hasNewCommits && lastReview && (
            <div className="seg" role="group" aria-label="Changes to show">
              <button type="button" className={tab === "diff" && diffRange === "since" ? "" : "on"} aria-pressed={!(tab === "diff" && diffRange === "since")} onClick={() => setDiffRange("all")}>All changes</button>
              <button type="button" className={tab === "diff" && diffRange === "since" ? "on" : ""} aria-pressed={tab === "diff" && diffRange === "since"} onClick={showSinceReview}>Since your review</button>
            </div>
          )}
          {analysisOutdated && !checks && (
            <button type="button" className="btn sm" disabled={!!recheck?.running || !!run?.running} onClick={() => { setTab("analysis"); recheckFindings(); }}>
              Re-check findings
            </button>
          )}
          {hasNewCommits && lastReview && (
            <button type="button" className="btn sm" disabled={!canAnalyze} onClick={() => { setTab("analysis"); startAnalysis({ since: lastReview.commitId }); }}>
              Analyze new changes
            </button>
          )}
        </div>
      )}
      {recheck?.error && <div className="since-bar tone-high" role="alert">{recheck.error}</div>}
      {since?.error && <div className="since-bar tone-high" role="alert">{since.error}</div>}
      <div style={{ flex: 1, minHeight: 0 }}>
        {loadError && <p className="selectable" style={{ margin: 16, color: "var(--crit)" }}>{loadError}</p>}
        {!loadError && !details && <div className="empty"><Loader size={18} className="spin" /></div>}
        {details && tab === "analysis" && (
          <AnalysisView
            pr={details}
            bodyHtml={loaded?.bodyHtml}
            analysis={analysis}
            analysisRaw={session?.analysisRaw}
            analyzedAt={session?.analyzedAt}
            run={run}
            files={files}
            selected={outlineKey}
            inReview={session?.inReview ?? []}
            checks={checks?.results}
            onSelect={(k) => { setOutlineKey(k); setFocusPane("outline"); }}
            onOpenAnchor={openAnchor}
            onStart={() => startAnalysis()}
            onCancel={cancelAnalysis}
            onToggleReview={(i) => key && update(key, (s) => ({ ...s, inReview: s.inReview.includes(i) ? s.inReview.filter((x) => x !== i) : [...s.inReview, i] }))}
            onAsk={() => { setChatOpen(true); setChatFocus((n) => n + 1); }}
          />
        )}
        {/* Guided review covers the whole PR, so "since your review" always uses the file diff. */}
        {details && tab === "diff" && diffMode === "guided" && diffRange === "all" && (
          <GuidedReview
            files={diffFiles}
            steps={analysis?.walkthrough}
            findings={analysis?.findings ?? []}
            current={guideStep}
            reviewed={reviewedHunks}
            split={split}
            generating={key ? guideRuns[key] : undefined}
            canGenerate={!!(session?.sessionId && session.worktree)}
            onSplit={setSplit}
            onMode={setDiffMode}
            onStep={setGuideStep}
            onReviewed={setReviewed}
            onGenerate={generateWalkthrough}
            hideGenerated={settings.hideGenerated}
          />
        )}
        {details && tab === "diff" && (diffMode === "files" || diffRange === "since") && (
          <DiffView
            onMode={(m) => { if (m === "guided") setDiffRange("all"); setDiffMode(m); }}
            reviewed={reviewedHunks}
            onReviewed={setReviewed}
            hideGenerated={settings.hideGenerated}
            files={diffFiles}
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
        onOpenSettings={() => openSettings("general")}
        onOpenPalette={() => setPaletteOpen(true)}
        commands={commands}
      />
      {settingsOpen && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <Settings
            settings={settings}
            update={updateSettings}
            section={settingsSection}
            onSection={setSettingsSection}
            orgs={orgs}
            orgsError={orgsError}
            requests={requests}
            onReloadOrgs={reloadOrgs}
            onClearData={clearAll}
            onClose={() => setSettingsOpen(false)}
          />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: settingsOpen ? "none" : "flex" }}>
        {inboxMode === "rail" && (
          <div style={{ width: 52, flexShrink: 0, borderRight: "1px solid var(--line)" }}>
            <InboxRail
              requests={inboxList}
              selected={key}
              sessions={sessions}
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
                  view={inboxView}
                  counts={{ review: visibleRequests?.length ?? 0, mine: visibleMine?.length ?? 0 }}
                  onViewChange={setInboxView}
                  sort={inboxSort}
                  filters={inboxFilters}
                  activeFilters={activeFilters}
                  onOpenFilters={() => setFiltersOpen(true)}
                  onClearFilters={clearFilters}
                  requests={inboxList}
                  hiddenCount={hiddenCount}
                  error={inboxError}
                  loading={inboxLoading}
                  selected={key}
                  focused={focusPane === "inbox"}
                  sessions={sessions}
                  analyzing={analyzing}
                  onSelect={(pr) => { selectPr(pr); if (compact) setInboxExpanded(false); }}
                  onRefresh={refresh}
                  onHideOwner={hideOwner}
                  onManage={() => openSettings("orgs")}
                  onCollapse={compact ? () => setInboxExpanded(false) : undefined}
                />
              </Panel>
              <Separator className="sep-v" />
            </>
          )}
          <Panel id="main" minSize={420}>
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: 1, minHeight: 0 }}>
            <Group orientation="vertical">
              <Panel id="content" minSize={200}>{main}</Panel>
              {chatOpen && selected && chatHasContent && (
                <>
                  <Separator className="sep-h" />
                  <Panel id="chat" defaultSize={260} minSize={140}>
                    <ClaudePanel {...chatProps} compact={false} />
                  </Panel>
                </>
              )}
            </Group>
            </div>
            {chatOpen && selected && !chatHasContent && <ClaudePanel {...chatProps} compact />}
            </div>
          </Panel>
        </Group>
        </div>
      </div>
      <footer className="statusbar" aria-label="Status bar">
        <span className="sb"><RefreshCw size={13} className={inboxLoading ? "spin" : undefined} />{syncedAt ? `Synced ${new Date(syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Syncing…"}</span>
        <span className="sb opt"><InboxIcon size={13} />{visibleRequests?.length ?? 0} to review</span>
        <span style={{ flex: 1 }} />
        {key && postedReviews[key] && (
          <button type="button" className="sb sb-btn" onClick={() => openUrl(postedReviews[key])}><Check size={13} />Review posted · View on GitHub</button>
        )}
        <UpdateStatus {...updater} />
        {key && (
          <span className="sb">
            {run?.running || chatRunning[key] ? <Loader size={13} className="spin tone-accent" /> : <MessageSquare size={13} />}
            Claude {run?.running || chatRunning[key] ? "working" : "idle"}{session?.tokens ? ` · ${Math.round(session.tokens / 1000)}k tokens` : ""}
          </span>
        )}
        {details && <span className="sb opt ellipsis"><GitBranch size={13} />{details.headRefName} @ {details.headRefOid.slice(0, 7)}</span>}
        <span className="sb opt"><Lock size={13} />Read-only</span>
      </footer>
      {paletteOpen && <CommandPalette items={paletteItems} extra={openPrItem} onClose={() => setPaletteOpen(false)} />}
      {filtersOpen && (
        <FilterDialog
          sort={inboxSort}
          onSort={setInboxSort}
          filters={inboxFilters}
          onFilters={setInboxFilters}
          showDrafts={settings.showDrafts}
          onShowDrafts={(v) => updateSettings({ showDrafts: v })}
          owners={ownerRows}
          onOwner={setOwnerVisible}
          repos={repoRows}
          onRepo={setRepoVisible}
          onClear={clearFilters}
          onManageOrgs={() => { setFiltersOpen(false); openSettings("orgs"); }}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      {reviewOpen && selected && details && key && (
        <SubmitReview
          repo={selected.repository.nameWithOwner}
          details={details}
          analysis={analysis}
          files={files}
          inReview={session?.inReview ?? []}
          ownPr={!!orgs?.login && details.author.login === orgs.login}
          checks={checks?.results}
          onClose={() => setReviewOpen(false)}
          onSubmitted={(url) => {
            setReviewOpen(false);
            // Show the new review state, and drop the PR from "To review" if the request is done.
            const repo = selected.repository.nameWithOwner;
            api.prDetails(repo, selected.number).then((d) => setLoaded((l) => (l && l.key === key ? { ...l, details: d } : l))).catch(() => {});
            refresh();
            setPostedReviews((all) => ({ ...all, [key]: url }));
            update(key, (s) => ({ ...s, inReview: [] }));
          }}
        />
      )}
      {infoDialog && <InfoDialog kind={infoDialog} commands={commands} vim={settings.vimKeys} onClose={() => setInfoDialog(null)} />}
    </div>
  );
}

function UpdateStatus({ state, install, restart }: ReturnType<typeof useUpdater>) {
  switch (state.kind) {
    case "checking":
      return state.manual ? <span className="sb"><Loader size={13} className="spin" />Checking for updates…</span> : null;
    case "current":
      return state.manual ? <span className="sb"><Check size={13} />BetterLGTM is up to date</span> : null;
    case "error":
      return state.manual ? <span className="sb tone-high" title={state.message}><TriangleAlert size={13} />Couldn't update</span> : null;
    case "available":
      return <button type="button" className="sb sb-btn" onClick={install}><Download size={13} />Install update {state.version}</button>;
    case "installing":
      return <span className="sb"><Loader size={13} className="spin" />Updating{state.percent !== null ? ` ${state.percent}%` : "…"}</span>;
    case "ready":
      return <button type="button" className="sb sb-btn" onClick={() => restart()}><RotateCw size={13} />Restart to finish updating</button>;
    default:
      return null;
  }
}
