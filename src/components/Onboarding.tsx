import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, CircleCheck, CircleX, Copy, ExternalLink, FolderCog, Loader, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { ToolStatus } from "../api";
import { ownerVisible, type Settings } from "../settings";
import { HARNESSES, HARNESS_IDS, harnessOf } from "../harness";
import { os } from "../platform";
import { setupItems, versionOf, type Fix, type SetupItem } from "../setup";
import { Logo } from "./Logo";

interface Props {
  /**
   * `tools`: what's installed and signed in. `agent`: the coding agents found on this computer, which one to use and how it runs.
   * `choices`: what the inbox shows. The last two appear once, on the first run.
   */
  step: "tools" | "agent" | "choices";
  /** Null while the first check runs. */
  status: ToolStatus | null;
  checking: boolean;
  /** The app has never finished onboarding on this computer. */
  firstRun: boolean;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  orgs: { login: string; orgs: string[] } | null;
  onCheck: () => void;
  /** Opens Settings › Tools, to set a full path for a tool the app can't find. */
  onSetPaths: () => void;
  onSample: () => void;
  /** Leaves the setup screen, whether or not everything is fixed. */
  onContinue: () => void;
  /** Moves between the first-run steps. */
  onStep: (step: "tools" | "agent" | "choices") => void;
  onDone: () => void;
}

const PLAN: Record<string, string> = { max: "Max plan", pro: "Pro plan", team: "Team plan", enterprise: "Enterprise plan", free: "Free plan" };
const METHOD: Record<string, string> = { "claude.ai": "a Claude account", console: "an Anthropic Console account", api_key: "an API key", apiKey: "an API key", ChatGPT: "ChatGPT" };

/** "Step 2 of 3", on the first run only. */
function StepLabel({ n, show }: { n: number; show: boolean }) {
  return show ? <span className="onb-step">Step {n} of 3</span> : null;
}

/** A text setting saved on Enter or when the field loses focus. */
function PathField({ value, placeholder, label, onSave }: { value: string; placeholder: string; label: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => draft.trim() !== value && onSave(draft.trim());
  return (
    <input
      className="set-input mono"
      style={{ width: 260 }}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && save()}
    />
  );
}

/** A command to run in a terminal, with a button that copies it. */
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  return (
    <span className="onb-cmd">
      <code className="selectable">{text}</code>
      <button type="button" className="tb" aria-label={`Copy ${text}`} title={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <Check size={13} className="status-ok" /> : <Copy size={13} />}
      </button>
    </span>
  );
}

function FixLine({ fix }: { fix: Fix }) {
  if (fix.command) return <div className="onb-fix"><span>{fix.label}:</span><Command text={fix.command} /></div>;
  return (
    <div className="onb-fix">
      <button type="button" className="link" onClick={() => fix.url && openUrl(fix.url).catch(() => {})}>{fix.label}<ExternalLink size={11} style={{ marginLeft: 4 }} /></button>
    </div>
  );
}

function ToolRow({ item }: { item: SetupItem }) {
  const ok = item.state === "ok";
  return (
    <div className="set-row" style={{ alignItems: "flex-start" }}>
      {ok ? <CircleCheck size={16} className="status-ok" style={{ marginTop: 2, flexShrink: 0 }} /> : <CircleX size={16} className="status-bad" style={{ marginTop: 2, flexShrink: 0 }} />}
      <div className="set-label">
        <span>{item.name}</span>
        <span>{item.purpose}</span>
        <span className={ok ? undefined : "status-bad"} style={{ marginTop: 3 }}>{item.detail}</span>
        {item.fixes.map((f) => <FixLine key={f.label} fix={f} />)}
        {item.error && <details className="onb-error"><summary>What the tool said</summary><pre className="mono selectable">{item.error}</pre></details>}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="set-row" style={{ cursor: "default" }}>
      <div className="set-label"><span>{label}</span>{hint && <span>{hint}</span>}</div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ margin: 0, accentColor: "var(--accent)" }} />
    </label>
  );
}

/** First-run and setup screens: get gh, claude and git working, then choose what the inbox shows. */
export function Onboarding(p: Props) {
  const items = p.status ? setupItems(p.status) : null;
  const broken = items?.filter((i) => i.state !== "ok") ?? [];
  const missing = broken.some((i) => i.state === "missing");
  /** Without a working gh there are no organizations to wait for. */
  const ghReady = !broken.some((i) => i.id === "gh");

  // People fix these in a terminal and come back: check again when the window gets focus.
  useEffect(() => {
    if (p.step !== "tools") return;
    window.addEventListener("focus", p.onCheck);
    return () => window.removeEventListener("focus", p.onCheck);
  }, [p.step, p.onCheck]);

  if (p.step === "tools") {
    return (
      <div className="onb" role="region" aria-label="Setup">
        <div className="onb-body">
          <Logo />
          <StepLabel n={1} show={p.firstRun} />
          <h1>{p.firstRun ? "Welcome to BetterLGTM" : broken.length ? "Setup needs attention" : "Setup"}</h1>
          <p className="lead">
            BetterLGTM has no account or server of its own. It runs three tools installed on this computer, with your own sign-ins.
          </p>
          <div className="set-group">
            {items ? items.map((i) => <ToolRow key={i.id} item={i} />) : <div className="set-row muted"><Loader size={14} className="spin" />Checking what's installed…</div>}
          </div>
          {missing && (
            <p className="onb-note">
              Already installed? Apps started from a launcher don't always see what your terminal sees.{" "}
              <button type="button" className="link" onClick={p.onSetPaths}><FolderCog size={12} style={{ marginRight: 4, verticalAlign: -2 }} />Set the full path</button>
            </p>
          )}
          <div className="onb-actions">
            {broken.length > 0 || !items ? (
              <button type="button" className="btn primary" disabled={p.checking} onClick={p.onCheck}>
                <RefreshCw size={14} className={p.checking ? "spin" : undefined} />Check again
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={p.onContinue}>Continue</button>
            )}
            <button type="button" className="btn" onClick={p.onSample}><Sparkles size={14} />Try a sample pull request</button>
            <span style={{ flex: 1 }} />
            {broken.length > 0 && <button type="button" className="link" onClick={p.onContinue}>Continue anyway</button>}
          </div>
          {broken.length > 0 && <p className="onb-note">The sample needs none of this: it shows a finished review on built-in data, without GitHub or a coding agent.</p>}
        </div>
      </div>
    );
  }

  const s = p.settings;

  if (p.step === "agent") {
    const st = p.status;
    const chosen = harnessOf(s);
    // The check answers for the agent that was chosen when it ran; while a new choice is being checked, show nothing stale.
    const current = st && st.harness === chosen.id ? st : null;
    const acct = current?.agentAccount;
    const found = !!current?.agent;
    const account = !found
      ? null
      : acct?.signedIn === false
        ? "Not signed in"
        : acct?.signedIn
          ? [`Signed in${acct.method ? ` with ${METHOD[acct.method] ?? acct.method}` : ""}`, acct.email, acct.plan && (PLAN[acct.plan] ?? `${acct.plan} plan`)].filter(Boolean).join(" · ")
          : "This version can't report its sign-in; the first review will tell";
    const fileOf = (id: string) => st?.agents?.find((a) => a.id === id)?.file ?? null;
    const custom = !!s.model && !chosen.models.some(([v]) => v === s.model);
    return (
      <div className="onb" role="region" aria-label="Coding agent">
        <div className="onb-body">
          <Logo />
          <StepLabel n={2} show={p.firstRun} />
          <h1>Choose who reads the code</h1>
          <p className="lead">
            Every analysis, guided review and chat answer comes from a coding agent on this computer, using its own sign-in and limits. It only gets to read.
          </p>
          <div className="set-group" role="radiogroup" aria-label="Coding agent">
            <div className="set-title" style={{ display: "flex", alignItems: "center" }}>
              <span style={{ flex: 1 }}>Found on this computer</span>
              <button type="button" className="tb" style={{ width: 22, height: 22 }} aria-label="Look again" title="Look again" onClick={p.onCheck}><RefreshCw size={13} className={p.checking ? "spin" : undefined} /></button>
            </div>
            {!st && <div className="set-row muted"><Loader size={14} className="spin" />Looking for coding agents…</div>}
            {st && HARNESS_IDS.map((id) => {
              const h = HARNESSES[id];
              const file = fileOf(id);
              const on = chosen.id === id;
              return (
                <label key={id} className={`set-row onb-agent${on ? " on" : ""}`} style={{ alignItems: "flex-start", cursor: "default" }}>
                  <input type="radio" name="harness" checked={on} onChange={() => p.update({ harness: id, model: "" })} style={{ margin: "3px 0 0", accentColor: "var(--accent)" }} />
                  <div className="set-label">
                    <span>{h.name} <span className="muted" style={{ fontWeight: 400 }}>· {h.maker}</span></span>
                    {file ? <span className="mono selectable">{file}</span> : <span>Not found</span>}
                    {on && found && <span>Version {versionOf(current!.agent!)}{account ? ` · ${account}` : ""}</span>}
                    {on && current && acct?.signedIn === false && <FixLine fix={h.signIn} />}
                    {on && current && !found && h.install[os === "windows" ? "windows" : "unix"].map((f) => <FixLine key={f.label} fix={f} />)}
                    {on && !current && <span><Loader size={11} className="spin" style={{ marginRight: 5, verticalAlign: -1 }} />Checking…</span>}
                    {on && h.limits && <span>{h.limits}</span>}
                  </div>
                  {file ? <CircleCheck size={16} className="status-ok" style={{ marginTop: 2, flexShrink: 0 }} /> : <CircleX size={16} className="muted" style={{ marginTop: 2, flexShrink: 0 }} />}
                </label>
              );
            })}
            <div className="set-row">
              <div className="set-label"><span>Command for {chosen.name}</span><span>Give a full path if it's installed somewhere the app doesn't look</span></div>
              <PathField
                value={s[chosen.pathKey] === chosen.command ? "" : s[chosen.pathKey]}
                placeholder={chosen.command}
                label={`${chosen.name} command or full path`}
                onSave={(v) => p.update({ [chosen.pathKey]: v || (chosen.id === "claude" ? "claude" : "") })}
              />
            </div>
          </div>
          <div className="set-group">
            <div className="set-title">How {chosen.name} runs</div>
            <div className="set-row">
              <div className="set-label"><span>Model</span><span>Default follows {chosen.name}'s own setting</span></div>
              {chosen.models.length ? (
                <select className="set-input" aria-label="Model" value={custom ? "custom" : s.model} onChange={(e) => e.target.value !== "custom" && p.update({ model: e.target.value })}>
                  <option value="">Default</option>
                  {chosen.models.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  {custom && <option value="custom">{s.model}</option>}
                </select>
              ) : (
                <PathField value={s.model} placeholder="Default" label="Model name" onSave={(v) => p.update({ model: v })} />
              )}
            </div>
            {chosen.effort && (
              <div className="set-row">
                <div className="set-label"><span>Effort</span><span>Higher is more thorough, slower and uses more tokens</span></div>
                <select className="set-input" aria-label="Effort" value={s.effort} onChange={(e) => p.update({ effort: e.target.value })}>
                  <option value="">Default</option>
                  {["low", "medium", "high", "xhigh", "max"].map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                </select>
              </div>
            )}
            <Toggle
              label="Double-check findings"
              hint="A second pass tries to disprove each finding and drops the ones the code doesn't support. Slower, and uses more tokens."
              checked={s.verifyFindings}
              onChange={(v) => p.update({ verifyFindings: v })}
            />
          </div>
          <div className="onb-actions">
            <button type="button" className="btn primary" onClick={() => p.onStep("choices")}>Continue</button>
            <button type="button" className="btn" onClick={() => p.onStep("tools")}>Back</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="link" onClick={p.onSample}>Try a sample pull request</button>
          </div>
        </div>
      </div>
    );
  }

  const orgs = p.orgs?.orgs ?? [];
  const shown = (org: string) => ownerVisible(s, org, orgs);
  const showOrg = (org: string, show: boolean) =>
    s.orgMode === "all"
      ? p.update({ hiddenOrgs: show ? s.hiddenOrgs.filter((o) => o !== org) : [...new Set([...s.hiddenOrgs, org])] })
      : p.update({ selectedOrgs: show ? [...new Set([...s.selectedOrgs, org])] : s.selectedOrgs.filter((o) => o !== org) });
  return (
    <div className="onb" role="region" aria-label="Welcome">
      <div className="onb-body">
        <Logo />
        <StepLabel n={3} show={p.firstRun} />
        <h1>Choose what shows up</h1>
        <p className="lead">
          {items && !broken.length ? `Everything is set up${p.status?.login ? `, and you're signed in to GitHub as ${p.status.login}` : ""}. ` : ""}
          You can change all of this later in Settings.
        </p>
        <div className="set-group">
          <div className="set-title">Pull requests from</div>
          {!p.orgs && ghReady && <div className="set-row muted"><Loader size={14} className="spin" />Loading your organizations…</div>}
          {orgs.map((org) => <Toggle key={org} label={org} checked={shown(org)} onChange={(v) => showOrg(org, v)} />)}
          <Toggle label="Personal repositories" hint="Yours and other people's, outside your organizations" checked={s.includePersonal} onChange={(v) => p.update({ includePersonal: v })} />
          <Toggle label="Requests to my teams" hint="Not only the ones that name you" checked={s.includeTeams} onChange={(v) => p.update({ includeTeams: v })} />
        </div>
        <div className="set-group">
          <div className="set-title">When a review is requested</div>
          <Toggle label="Notify me" hint="A desktop notification, and a count on the app icon" checked={s.notifications} onChange={(v) => p.update({ notifications: v })} />
          <Toggle
            label="Analyze it right away"
            hint="Results are ready when you open the pull request. Uses the agent's tokens for every new request; off, you start each review yourself."
            checked={s.autoAnalyze}
            onChange={(v) => p.update({ autoAnalyze: v, ...(v ? { autoAnalyzeSince: Date.now() } : {}) })}
          />
        </div>
        <div className="onb-actions">
          <button type="button" className="btn primary" onClick={p.onDone}>Open my inbox</button>
          <button type="button" className="btn" onClick={() => p.onStep("agent")}>Back</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={p.onSample}><Sparkles size={14} />Try a sample pull request first</button>
        </div>
      </div>
    </div>
  );
}
