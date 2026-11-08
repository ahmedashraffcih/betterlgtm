import type { PrDetails } from "./api";

export type Verdict = "implemented" | "partial" | "contradicted" | "missing";
export type Severity = "critical" | "high" | "medium" | "low";

export interface Anchor {
  path: string;
  startLine: number;
  endLine: number;
}

export interface Claim {
  text: string;
  verdict: Verdict;
  note?: string;
  anchors: Anchor[];
  /** Index into `findings` when the problem is explained by a finding. */
  finding?: number;
}

export interface Finding {
  severity: Severity;
  category: string;
  title: string;
  body: string;
  fix?: string;
  /** Exact replacement for the lines of the first anchor, when the fix is small and certain. */
  suggestion?: string;
  confidence?: "high" | "medium" | "low";
  notInDescription?: boolean;
  anchors: Anchor[];
}

/** One step of the guided review: related changes across files, read together. */
export interface WalkStep {
  title: string;
  /** Markdown bullets: what changed and why. */
  why: string;
  changes: Anchor[];
}

export type Decision = "approve" | "comment" | "request_changes";

export interface Analysis {
  /** Two or three plain sentences on what the PR does. Missing in analyses from older versions. */
  summary?: string;
  recommendation?: { decision: Decision; reason: string };
  claims: Claim[];
  findings: Finding[];
  /** Guided review steps. Missing in analyses from older versions; can be generated separately. */
  walkthrough?: WalkStep[];
}

const WALKTHROUGH_RULES = `Group the changes into review steps for a guided review:
- Each step collects related changes across files that should be read together
  (for example: a new type, the function that fills it, and the UI that shows it).
- Order the steps so each one builds on the previous: foundations first, then usage, then tests.
- 3–10 steps. Every changed hunk belongs to exactly one step. Put trivial changes (renames,
  formatting, lockfiles, docs) together in one late step.
- Title up to 8 words. "why" is 1–3 short bullets: what changed and why it matters.
- "changes" lists line ranges in the new version of each file. For deleted files use startLine 0 and endLine 0.`;

const WALKTHROUGH_SHAPE = `"walkthrough": [{ "title": "...", "why": ["..."], "changes": [{ "path": "src/x.ts", "startLine": 10, "endLine": 40 }] }]`;

export function buildWalkthroughPrompt(): string {
  return `${WALKTHROUGH_RULES}

Use the PR you analyzed earlier in this session (git diff against the base branch).
Reply with only one JSON block: \`\`\`json { ${WALKTHROUGH_SHAPE} } \`\`\``;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** With `since`, a re-review: focus on what changed after the commit the reviewer last reviewed. */
export function buildAnalysisPrompt(pr: PrDetails, extraInstructions = "", since?: string): string {
  const extra = extraInstructions.trim() ? `\n\nThe reviewer's own instructions (follow them):\n${extraInstructions.trim()}` : "";
  const focus = since
    ? `\n\nThis is a re-review. The reviewer last reviewed commit ${since}. Focus on what changed since then: git diff ${since} HEAD (and git log ${since}..HEAD). Use the full PR diff only for context. Report findings only for code changed since ${since}, and check description claims only where the new commits affect them. Mention in the summary that this covers the changes since the last review.`
    : "";
  return baseAnalysisPrompt(pr) + focus + extra;
}

function baseAnalysisPrompt(pr: PrDetails): string {
  return `You are helping a developer review pull request #${pr.number} "${pr.title}" by ${pr.author.login}.
The PR head is checked out in the current directory (detached HEAD). The base branch is origin/${pr.baseRefName}.
See the change with: git diff origin/${pr.baseRefName}...HEAD

PR description (written by the author):
<description>
${pr.body?.trim() || "(empty)"}
</description>

Do this, using only read-only commands:
1. Split the description into concrete claims. For each, check the code and give a verdict:
   implemented, partial, contradicted (the code does the opposite or breaks the claim), or missing (not in the PR).
2. Find the most important things a reviewer should look at: bugs, security problems, behavior changes,
   missing tests, risky data handling. Also report changes the description doesn't mention (set notInDescription).
   Rank them by severity: critical, high, medium, low. Skip style nits.
3. Summarize what the PR does and recommend a decision: approve, comment, or request_changes.
4. ${WALKTHROUGH_RULES.replace(/\n/g, "\n   ")}

Don't read generated files (lockfiles, build output, snapshots, generated code) line by line;
only mention them if their change is unexpected, for example a lockfile change with no dependency change.

The reviewer skims. Be brief and concrete:
- Use bullet points, not paragraphs. Every bullet is one short line, at most about 12 words.
- No filler, no hedging, no repeating the title. Say what breaks and why it matters.
- Use \`inline code\` for identifiers. No headings, no bold.
- Limits: title up to 8 words; summary 2–4 bullets; finding body 1–3 bullets; fix one line;
  claim note one line; recommendation reason one line; reading-order "why" up to 8 words.
When a finding's fix is a small, certain change to exactly the lines of its first anchor, add "suggestion":
the full replacement text for those lines (startLine to endLine of the new file), with the original indentation and
no diff markers. Leave it out when the fix touches other lines or you aren't sure.
Line numbers refer to the new version of the file. Paths are relative to the repository root.
When you are done, reply with only one JSON block in this shape:

\`\`\`json
{
  "summary": ["...", "..."],
  "recommendation": { "decision": "approve|comment|request_changes", "reason": "..." },
  "claims": [{ "text": "...", "verdict": "implemented|partial|contradicted|missing", "note": "...", "finding": 0,
               "anchors": [{ "path": "src/x.ts", "startLine": 10, "endLine": 14 }] }],
  "findings": [{ "severity": "critical|high|medium|low", "category": "Correctness|Security|Behavior change|Tests|Data handling|Performance|Maintainability",
                 "title": "...", "body": ["...", "..."], "fix": "...", "suggestion": "replacement lines", "confidence": "high|medium|low", "notInDescription": false,
                 "anchors": [{ "path": "src/x.ts", "startLine": 10, "endLine": 14 }] }],
  ${WALKTHROUGH_SHAPE}
}
\`\`\`
"text" on a claim is the claim as the description states it, shortened to one line.
"finding" on a claim is the index of the finding that explains the problem, or omit it.`;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Bullet lists come back as arrays; older analyses used prose strings. Both become Markdown. */
function asText(v: unknown): string {
  if (Array.isArray(v)) return v.map((item) => `- ${String(item).replace(/^[-*•]\s*/, "")}`).join("\n");
  return typeof v === "string" ? v : "";
}

function parseSteps(v: unknown): WalkStep[] | undefined {
  const steps = asArray<WalkStep>(v)
    .filter((s) => s && typeof s.title === "string")
    .map((s) => ({ title: s.title, why: asText(s.why), changes: asArray<Anchor>(s.changes) }));
  return steps.length ? steps : undefined;
}

/** JSON blocks in Claude's answer, last first; the answer itself if it has none. */
function jsonCandidates(text: string): string[] {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.length ? blocks.reverse() : [text];
}

export function parseWalkthrough(text: string): WalkStep[] | null {
  for (const raw of jsonCandidates(text)) {
    try {
      const steps = parseSteps(JSON.parse(raw.trim()).walkthrough);
      if (steps) return steps;
    } catch {
      // try the next block
    }
  }
  return null;
}

/** Pulls the last JSON block out of Claude's final answer. Returns null when there is none. */
export function parseAnalysis(text: string): Analysis | null {
  for (const raw of jsonCandidates(text)) {
    try {
      const data = JSON.parse(raw.trim());
      const findings = asArray<Finding>(data.findings).map((f) => ({
        ...f,
        body: asText(f.body),
        fix: f.fix ? asText(f.fix) : undefined,
        suggestion: typeof f.suggestion === "string" && f.suggestion.trim() ? f.suggestion.replace(/\n$/, "") : undefined,
        anchors: asArray<Anchor>(f.anchors),
      }));
      const order = findings.map((_, i) => i).sort((a, b) => SEVERITY_RANK[findings[a].severity] - SEVERITY_RANK[findings[b].severity]);
      const remap = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
      const rec = data.recommendation;
      return {
        summary: asText(data.summary) || undefined,
        recommendation:
          rec && ["approve", "comment", "request_changes"].includes(rec.decision) ? { decision: rec.decision, reason: String(rec.reason ?? "") } : undefined,
        findings: order.map((i) => findings[i]),
        claims: asArray<Claim>(data.claims).map((c) => ({
          ...c,
          note: c.note ? asText(c.note) : undefined,
          anchors: asArray<Anchor>(c.anchors),
          finding: typeof c.finding === "number" ? remap.get(c.finding) : undefined,
        })),
        walkthrough: parseSteps(data.walkthrough),
      };
    } catch {
      // try the next block
    }
  }
  return null;
}

export function anchorLabel(a: Anchor): string {
  const file = a.path.split("/").pop() ?? a.path;
  return a.startLine === a.endLine ? `${file}:${a.startLine}` : `${file}:${a.startLine}–${a.endLine}`;
}

export type CheckStatus = "fixed" | "open" | "changed" | "unclear";

export interface FindingCheck {
  status: CheckStatus;
  note: string;
}

/** The result of re-checking a PR's findings after new commits. */
export interface FindingChecks {
  /** The commit the findings were made on, and the one they were re-checked at. */
  from: string;
  head: string;
  at: number;
  results: Record<number, FindingCheck>;
}

/** Asks Claude which of the earlier findings the new commits fixed. */
export function buildRecheckPrompt(findings: Finding[], from: string): string {
  const list = findings
    .map((f, i) => {
      const where = f.anchors.map(anchorLabel).join(", ") || "no location";
      return `[${i}] (${f.severity}) ${f.title} — ${where}\n${f.body}`;
    })
    .join("\n\n");
  return `The pull request has new commits since your analysis, which looked at commit ${from}. The current directory is now checked out at the latest head.
See what changed with: git diff ${from} HEAD

Re-check each finding below against the current code:

${list}

Statuses:
- fixed: the problem is gone.
- open: still present as described.
- changed: the code changed but the problem is only partly addressed, or it moved.
- unclear: you can't tell from the code.

Reply with only this JSON, one entry per finding, and a note of one short sentence saying why:
{"results": [{"index": 0, "status": "fixed", "note": "..."}]}`;
}

export function parseRecheck(text: string): Record<number, FindingCheck> | null {
  const statuses: CheckStatus[] = ["fixed", "open", "changed", "unclear"];
  for (const raw of jsonCandidates(text)) {
    try {
      const data = JSON.parse(raw.trim());
      const results: Record<number, FindingCheck> = {};
      for (const r of asArray<{ index: unknown; status: unknown; note: unknown }>(data.results)) {
        if (typeof r.index === "number" && statuses.includes(r.status as CheckStatus)) {
          results[r.index] = { status: r.status as CheckStatus, note: asText(r.note) };
        }
      }
      if (Object.keys(results).length) return results;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export type FindingStateKind = "dismissed" | "resolved" | "commented";

/** What the reviewer did with a finding. Kept per PR and matched to findings across re-runs. */
export interface FindingState {
  state: FindingStateKind;
  reason?: string;
  at: number;
}

/** Identifies a finding across analysis runs: its first file and its title. */
export const findingId = (f: Finding) => `${f.anchors[0]?.path ?? ""}|${f.title.trim().toLowerCase()}`;
