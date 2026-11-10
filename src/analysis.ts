import type { LinkedIssue, PrDetails, ReviewThread } from "./api";

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
  /** Where the claim comes from when it isn't the description, such as "#311". */
  source?: string;
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
  /** Set when the finding repeats one from an earlier analysis, so the reviewer's state stays with it. */
  id?: string;
  /** Position of the earlier finding this one repeats, as Claude reported it. Turned into `id`. */
  previous?: number;
  /** The result of the second pass that tried to disprove the finding. */
  check?: { status: "confirmed" | "uncertain"; note: string };
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
  /** Repository guideline files Claude followed, such as REVIEW.md. */
  guidelines?: string[];
  /** Sensitive areas the PR touches. */
  risks?: Risk[];
  /** Whether the main changes are covered by tests. */
  tests?: TestCheck[];
  /** Findings the second pass disproved, with the reason. Not shown as findings. */
  dropped?: { finding: Finding; note: string }[];
}

export interface Risk {
  area: string;
  why: string;
  anchors: Anchor[];
}

export interface TestCheck {
  change: string;
  covered: "yes" | "partly" | "no";
  tests: string[];
  note?: string;
}

const WALKTHROUGH_RULES = `Group the changes into review steps for a guided review:
- Each step collects related changes across files that should be read together
  (for example: a new type, the function that fills it, and the UI that shows it).
- Order the steps so each one builds on the previous: foundations first, then usage, then tests.
- 3–10 steps. Every changed hunk belongs to exactly one step, except in generated files
  (lockfiles, build output, snapshots, generated code): leave those out, the reviewer doesn't read them.
  Put trivial changes (renames, formatting, docs) together in one late step.
- Title up to 8 words. "why" is 1–3 short bullets: what changed and why it matters.
- "changes" lists line ranges in the new version of each file. For deleted files use startLine 0 and endLine 0.`;

const WALKTHROUGH_SHAPE = `"walkthrough": [{ "title": "...", "why": ["..."], "changes": [{ "path": "src/x.ts", "startLine": 10, "endLine": 40 }] }]`;

// Schemas for `claude --json-schema`. They fix the structure; the prompts explain what goes in each field.
const TEXT = { type: "string" };
const LINES = { type: "array", items: TEXT };
const ANCHORS = {
  type: "array",
  items: { type: "object", properties: { path: TEXT, startLine: { type: "integer" }, endLine: { type: "integer" } }, required: ["path", "startLine", "endLine"] },
};
const RECOMMENDATION = {
  type: "object",
  properties: { decision: { enum: ["approve", "comment", "request_changes"] }, reason: TEXT },
  required: ["decision", "reason"],
};

export const WALKTHROUGH_SCHEMA = {
  type: "object",
  properties: {
    walkthrough: { type: "array", items: { type: "object", properties: { title: TEXT, why: LINES, changes: ANCHORS }, required: ["title", "why", "changes"] } },
  },
  required: ["walkthrough"],
};

export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: LINES,
    guidelines: LINES,
    risks: { type: "array", items: { type: "object", properties: { area: TEXT, why: TEXT, anchors: ANCHORS }, required: ["area", "why"] } },
    tests: {
      type: "array",
      items: { type: "object", properties: { change: TEXT, covered: { enum: ["yes", "partly", "no"] }, tests: LINES, note: TEXT }, required: ["change", "covered"] },
    },
    recommendation: RECOMMENDATION,
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: { text: TEXT, verdict: { enum: ["implemented", "partial", "contradicted", "missing"] }, note: TEXT, finding: { type: "integer" }, source: TEXT, anchors: ANCHORS },
        required: ["text", "verdict", "anchors"],
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { enum: ["critical", "high", "medium", "low"] },
          category: TEXT,
          title: TEXT,
          body: LINES,
          fix: TEXT,
          suggestion: TEXT,
          confidence: { enum: ["high", "medium", "low"] },
          notInDescription: { type: "boolean" },
          previous: { type: "integer" },
          anchors: ANCHORS,
        },
        required: ["severity", "category", "title", "body", "anchors"],
      },
    },
  },
  required: ["summary", "recommendation", "claims", "findings"],
};

export const RECHECK_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: { type: "object", properties: { index: { type: "integer" }, status: { enum: ["fixed", "open", "changed", "unclear"] }, note: TEXT }, required: ["index", "status", "note"] },
    },
  },
  required: ["results"],
};

export const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: { type: "object", properties: { index: { type: "integer" }, status: { enum: ["confirmed", "refuted", "uncertain"] }, note: TEXT }, required: ["index", "status", "note"] },
    },
    recommendation: RECOMMENDATION,
  },
  required: ["results"],
};

/** Asks the analysis session to group the PR's changes into guided review steps. */
export function buildWalkthroughPrompt(generatedPatterns: string[] = []): string {
  return `${WALKTHROUGH_RULES}${generatedNote(generatedPatterns)}

Use the PR you analyzed earlier in this session (git diff against the base branch).
Give the result as one JSON object: { ${WALKTHROUGH_SHAPE} }`;
}

/** A finding from the PR's previous analysis, with what the reviewer did with it. */
export interface EarlierFinding {
  finding: Finding;
  state?: FindingState;
}

/** The reviewer's own generated-file globs, for the agent to skip like the built-in ones. */
function generatedNote(patterns: string[]): string {
  const globs = patterns.map((g) => g.trim()).filter((g) => g && !g.startsWith("#"));
  return globs.length ? `\nAlso treat files matching these globs as generated: ${globs.map((g) => `\`${g}\``).join(", ")}.` : "";
}

export interface AnalysisOptions {
  /** The reviewer's own instructions, global and for this repository. */
  instructions?: string;
  /** The reviewer's own generated-file globs. */
  generatedPatterns?: string[];
  /** A re-review: focus on what changed after this commit. */
  since?: string;
  issues?: LinkedIssue[];
  threads?: ReviewThread[];
  /** The reviewer wrote this PR. */
  selfReview?: boolean;
  /** Findings of the previous analysis of this PR. */
  earlier?: EarlierFinding[];
  /** Findings the reviewer dismissed on other PRs in this repository. */
  dismissedInRepo?: { title: string; reason?: string }[];
}

const STATE_NOTE: Record<FindingStateKind, string> = {
  dismissed: "dismissed by the reviewer",
  resolved: "marked resolved by the reviewer",
  commented: "already posted as a review comment",
};

const oneLine = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function buildAnalysisPrompt(pr: PrDetails, o: AnalysisOptions = {}): string {
  const { since, issues = [], threads = [], earlier = [], dismissedInRepo = [] } = o;
  const extra = o.instructions?.trim() ? `\n\nThe reviewer's own instructions (follow them):\n${o.instructions.trim()}` : "";
  const focus = since
    ? `\n\nThis is a re-review. The reviewer last reviewed commit ${since}. Focus on what changed since then: git diff ${since} HEAD (and git log ${since}..HEAD). Use the full PR diff only for context. Report findings only for code changed since ${since}, and check description claims only where the new commits affect them. Mention in the summary that this covers the changes since the last review.`
    : "";
  const linked = issues.length
    ? `\n\nThe PR says it closes these issues. Turn their concrete requirements into claims as well, check them the same way, and set "source" to the issue number (for example "#${issues[0].number}"):\n` +
      issues.map((i) => `<issue number="${i.number}" title="${i.title.replace(/"/g, "'")}">\n${(i.body ?? "").trim().slice(0, 2000) || "(no description)"}\n</issue>`).join("\n")
    : "";
  const open = threads.filter((t) => !t.isResolved && t.comments.length);
  const discussed = open.length
    ? `\n\nReviewers have already raised these points on the PR. Don't report them again as findings; only add what they missed:\n` +
      open.map((t) => `- ${t.path}${t.line ? `:${t.line}` : ""} (${t.comments[0].author}): ${t.comments[0].body.replace(/\s+/g, " ").slice(0, 300)}`).join("\n")
    : "";
  const before = earlier.length
    ? `\n\nAn earlier analysis of this PR reported these findings:\n` +
      earlier
        .map(({ finding: f, state }, i) => {
          const note = state ? ` [${STATE_NOTE[state.state]}${state.reason ? `: ${oneLine(state.reason, 120)}` : ""}]` : "";
          return `[${i}] (${f.severity}) ${f.title} — ${f.anchors.map(anchorLabel).join(", ") || "no location"}${note}`;
        })
        .join("\n") +
      `\nCheck the code again rather than trusting this list. When a finding of yours is the same problem as one of these, keep its title and set "previous" to its number. Leave out the ones that are fixed. Don't report a dismissed one again unless the code changed in a way that makes it matter.`
    : "";
  const habits = dismissedInRepo.length
    ? `\n\nOn other pull requests in this repository, the reviewer dismissed these findings. Don't report the same kind of point here unless it is clearly more serious:\n` +
      dismissedInRepo.map((d) => `- ${oneLine(d.title, 100)}${d.reason ? ` (${oneLine(d.reason, 120)})` : ""}`).join("\n")
    : "";
  const self = o.selfReview
    ? `\n\nThis is the reviewer's own pull request: they wrote it and want to check it before asking others to review. Address them as the author ("you"). In "recommendation", approve means it's ready to ask for reviews, comment means it's worth another look first, and request_changes means fix these before asking anyone.`
    : "";
  return baseAnalysisPrompt(pr, o.generatedPatterns) + linked + discussed + before + habits + self + focus + extra;
}

function baseAnalysisPrompt(pr: PrDetails, generatedPatterns: string[] = []): string {
  return `You are helping a developer review pull request #${pr.number} "${pr.title}" by ${pr.author.login}.
The PR head is checked out in the current directory (detached HEAD). The base branch is origin/${pr.baseRefName}.
See the change with: git diff origin/${pr.baseRefName}...HEAD

PR description (written by the author):
<description>
${pr.body?.trim() || "(empty)"}
</description>

Do this, using only read-only commands:
0. Look for review guidelines in the repository: REVIEW.md, .github/REVIEW.md, docs/REVIEW.md, CODE_REVIEW.md, and any
   review section in CONTRIBUTING.md. If there are any, follow them, and list the files you used in "guidelines".
1. Split the description into concrete claims. For each, check the code and give a verdict:
   implemented, partial, contradicted (the code does the opposite or breaks the claim), or missing (not in the PR).
2. Find the most important things a reviewer should look at: bugs, security problems, behavior changes,
   missing tests, risky data handling. Also report changes the description doesn't mention (set notInDescription).
   Rank them by severity: critical, high, medium, low. Skip style nits.
3. Summarize what the PR does and recommend a decision: approve, comment, or request_changes.
3a. In "risks", list the sensitive areas the PR touches: authentication or permissions, database migrations or schema,
   CI or deployment config, dependencies, public APIs, money or personal data. One line on why it matters here.
3b. In "tests", for each significant behavior change, say whether changed or existing tests exercise it
   (yes, partly, no) and name the test files. Read the tests; don't run anything.

Don't read generated files (lockfiles, build output, snapshots, generated code) line by line;
only mention them if their change is unexpected, for example a lockfile change with no dependency change.${generatedNote(generatedPatterns)}

The reviewer skims. Be brief and concrete:
- Use bullet points, not paragraphs. Every bullet is one short line, at most about 12 words.
- No filler, no hedging, no repeating the title. Say what breaks and why it matters.
- Use \`inline code\` for identifiers. No headings, no bold.
- Limits: title up to 8 words; summary 2–4 bullets; finding body 1–3 bullets; fix one line;
  claim note one line; recommendation reason one line; risk "why" one line.
When a finding's fix is a small, certain change to exactly the lines of its first anchor, add "suggestion":
the full replacement text for those lines (startLine to endLine of the new file), with the original indentation and
no diff markers. Leave it out when the fix touches other lines or you aren't sure.
Line numbers refer to the new version of the file. Paths are relative to the repository root.
When you are done, give the result as one JSON object in this shape:

\`\`\`json
{
  "summary": ["...", "..."],
  "guidelines": ["REVIEW.md"],
  "risks": [{ "area": "Database migration", "why": "...", "anchors": [{ "path": "db/migrate/x.rb", "startLine": 1, "endLine": 20 }] }],
  "tests": [{ "change": "...", "covered": "yes|partly|no", "tests": ["spec/x_spec.rb"], "note": "..." }],
  "recommendation": { "decision": "approve|comment|request_changes", "reason": "..." },
  "claims": [{ "text": "...", "verdict": "implemented|partial|contradicted|missing", "note": "...", "finding": 0, "source": "#12 (only for claims from an issue)",
               "anchors": [{ "path": "src/x.ts", "startLine": 10, "endLine": 14 }] }],
  "findings": [{ "severity": "critical|high|medium|low", "category": "Correctness|Security|Behavior change|Tests|Data handling|Performance|Maintainability",
                 "title": "...", "body": ["...", "..."], "fix": "...", "suggestion": "replacement lines", "confidence": "high|medium|low", "notInDescription": false,
                 "anchors": [{ "path": "src/x.ts", "startLine": 10, "endLine": 14 }] }]
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

/** Anchors with a path and line numbers; anything else would break the views that show them. */
function asAnchors(v: unknown): Anchor[] {
  return asArray<Anchor>(v)
    .filter((a) => a && typeof a.path === "string" && a.path.trim())
    .map((a) => {
      const start = Number.isFinite(Number(a.startLine)) ? Number(a.startLine) : 1;
      const end = Number.isFinite(Number(a.endLine)) ? Number(a.endLine) : start;
      return { path: a.path, startLine: start, endLine: Math.max(start, end) };
    });
}

/** Claude sometimes writes "High" or a level that doesn't exist; unknown levels count as low. */
function asSeverity(v: unknown): Severity {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s in SEVERITY_RANK ? (s as Severity) : "low";
}

function parseSteps(v: unknown): WalkStep[] | undefined {
  const steps = asArray<WalkStep>(v)
    .filter((s) => s && typeof s.title === "string")
    .map((s) => ({ title: s.title, why: asText(s.why), changes: asAnchors(s.changes) }));
  return steps.length ? steps : undefined;
}

/** What a run answered: the data when it was given a schema, otherwise its text. */
export const answerOf = (e: { structured_output?: unknown; result?: string | null }): unknown => e.structured_output ?? e.result ?? "";

/**
 * The objects an answer could be: the data itself when the run had a schema, otherwise the JSON blocks
 * in the text (last first) or the text as a whole. Older Claude Code versions only give text.
 */
function candidates(answer: unknown): Record<string, any>[] {
  if (answer && typeof answer === "object") return [answer as Record<string, any>];
  if (typeof answer !== "string") return [];
  const blocks = [...answer.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const out: Record<string, any>[] = [];
  for (const raw of blocks.length ? blocks.reverse() : [answer]) {
    try {
      const data = JSON.parse(raw.trim());
      if (data && typeof data === "object") out.push(data);
    } catch {
      // not JSON: try the next block
    }
  }
  return out;
}

export function parseWalkthrough(answer: unknown): WalkStep[] | null {
  for (const data of candidates(answer)) {
    const steps = parseSteps(data.walkthrough);
    if (steps) return steps;
  }
  return null;
}

/** Reads the analysis out of Claude's final answer. Returns null when there is none. */
export function parseAnalysis(answer: unknown): Analysis | null {
  for (const data of candidates(answer)) {
    try {
      if (!Array.isArray(data.findings) && !Array.isArray(data.claims)) continue;
      const findings = asArray<Finding>(data.findings).filter((f) => f && typeof f === "object").map((f) => ({
        ...f,
        severity: asSeverity(f.severity),
        category: typeof f.category === "string" ? f.category : "",
        title: typeof f.title === "string" && f.title.trim() ? f.title : "Untitled finding",
        body: asText(f.body),
        fix: f.fix ? asText(f.fix) : undefined,
        suggestion: typeof f.suggestion === "string" && f.suggestion.trim() ? f.suggestion.replace(/\n$/, "") : undefined,
        anchors: asAnchors(f.anchors),
        previous: Number.isInteger(f.previous) ? f.previous : undefined,
        id: undefined,
        check: undefined,
      }));
      const order = findings.map((_, i) => i).sort((a, b) => SEVERITY_RANK[findings[a].severity] - SEVERITY_RANK[findings[b].severity]);
      const remap = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
      const rec = data.recommendation;
      return {
        summary: asText(data.summary) || undefined,
        guidelines: asArray<string>(data.guidelines).filter((g) => typeof g === "string" && g.trim()),
        risks: asArray<Risk>(data.risks)
          .filter((r) => r && typeof r.area === "string")
          .map((r) => ({ area: r.area, why: asText(r.why), anchors: asAnchors(r.anchors) })),
        tests: asArray<TestCheck>(data.tests)
          .filter((t) => t && typeof t.change === "string" && ["yes", "partly", "no"].includes(t.covered))
          .map((t) => ({ change: t.change, covered: t.covered, tests: asArray<string>(t.tests).filter((x) => typeof x === "string"), note: t.note ? asText(t.note) : undefined })),
        recommendation:
          rec && ["approve", "comment", "request_changes"].includes(rec.decision) ? { decision: rec.decision, reason: String(rec.reason ?? "") } : undefined,
        findings: order.map((i) => findings[i]),
        claims: asArray<Claim>(data.claims).map((c) => ({
          ...c,
          note: c.note ? asText(c.note) : undefined,
          source: typeof c.source === "string" && /^#?\d+/.test(c.source) ? `#${c.source.replace(/^#/, "").match(/^\d+/)![0]}` : undefined,
          anchors: asAnchors(c.anchors),
          finding: typeof c.finding === "number" ? remap.get(c.finding) : undefined,
        })),
        walkthrough: parseSteps(data.walkthrough),
      };
    } catch {
      // not the shape of an analysis: try the next one
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

Give the result as this JSON, one entry per finding, and a note of one short sentence saying why:
{"results": [{"index": 0, "status": "fixed", "note": "..."}]}`;
}

/** Results by finding index, keeping only entries with one of `statuses`. */
function parseResults<S extends string>(answer: unknown, statuses: readonly S[]): Record<number, { status: S; note: string }> | null {
  for (const data of candidates(answer)) {
    const results: Record<number, { status: S; note: string }> = {};
    for (const r of asArray<{ index: unknown; status: unknown; note: unknown }>(data.results)) {
      if (r && typeof r.index === "number" && statuses.includes(r.status as S)) {
        results[r.index] = { status: r.status as S, note: asText(r.note) };
      }
    }
    if (Object.keys(results).length) return results;
  }
  return null;
}

export function parseRecheck(answer: unknown): Record<number, FindingCheck> | null {
  return parseResults<CheckStatus>(answer, ["fixed", "open", "changed", "unclear"]);
}

export type VerifyStatus = "confirmed" | "refuted" | "uncertain";

/** Findings worth a second pass: the ones that would change the reviewer's decision. */
export const worthVerifying = (f: Finding) => f.severity !== "low";

/**
 * Asks a fresh session to try to disprove the findings. It hasn't seen the analysis's reasoning,
 * so it doesn't inherit its mistakes. `indexes` are positions in `a.findings`.
 */
export function buildVerifyPrompt(pr: PrDetails, a: Analysis, indexes: number[]): string {
  const list = indexes
    .map((i) => {
      const f = a.findings[i];
      const where = f.anchors.map((x) => `${x.path}:${x.startLine}${x.endLine > x.startLine ? `-${x.endLine}` : ""}`).join(", ") || "no location";
      return `[${i}] (${f.severity}, ${f.category || "uncategorized"}) ${f.title} — ${where}\n${f.body}${f.fix ? `\nSuggested fix: ${f.fix}` : ""}`;
    })
    .join("\n\n");
  const rec = a.recommendation ? `\n\nThe reviewer's recommendation was "${a.recommendation.decision}" (${a.recommendation.reason}). If the findings you refute change it, give the new one in "recommendation" (approve, comment or request_changes, with a one-line reason). Otherwise leave "recommendation" out.` : "";
  return `You are double-checking a code review of pull request #${pr.number} "${pr.title}".
The PR head is checked out in the current directory (detached HEAD). The base branch is origin/${pr.baseRefName}.
See the change with: git diff origin/${pr.baseRefName}...HEAD

Another reviewer reported the findings below. Assume each one may be wrong and try to disprove it, using only read-only commands:
- Read the code at the location and around it. Check that the lines say what the finding claims.
- Follow callers and callees. Look for guards, validation, types, configuration or tests that already handle the case.
- Check whether the problem already existed before this PR and the PR doesn't touch it.

${list}

Statuses:
- confirmed: you read the code and the problem is real as described.
- refuted: the code shows the finding is wrong or already handled. Name the file:line that shows it.
- uncertain: you can't tell from the code either way.
Use refuted only when you can point to code that disproves the finding. A real problem you consider minor is still confirmed.${rec}

Give the result as this JSON, one entry per finding, and a note of one short sentence saying why:
{"results": [{"index": 0, "status": "confirmed", "note": "..."}]}`;
}

export function parseVerify(answer: unknown): { results: Record<number, { status: VerifyStatus; note: string }>; recommendation?: Analysis["recommendation"] } | null {
  const results = parseResults<VerifyStatus>(answer, ["confirmed", "refuted", "uncertain"]);
  if (!results) return null;
  const rec = candidates(answer).map((d) => d.recommendation).find((r) => r && ["approve", "comment", "request_changes"].includes(r.decision));
  return { results, recommendation: rec ? { decision: rec.decision, reason: String(rec.reason ?? "") } : undefined };
}

/** Applies the second pass: refuted findings move to `dropped`, the others keep the result as `check`. */
export function applyVerification(a: Analysis, v: NonNullable<ReturnType<typeof parseVerify>>): Analysis {
  const dropped = a.findings.flatMap((f, i) => (v.results[i]?.status === "refuted" ? [{ finding: f, note: v.results[i].note }] : []));
  const remap = new Map<number, number>();
  const findings: Finding[] = [];
  a.findings.forEach((f, i) => {
    const r = v.results[i];
    if (r?.status === "refuted") return;
    remap.set(i, findings.length);
    findings.push(r ? { ...f, check: { status: r.status as "confirmed" | "uncertain", note: r.note } } : f);
  });
  return {
    ...a,
    findings,
    dropped: dropped.length ? dropped : undefined,
    // A claim explained by a dropped finding keeps its verdict but loses the link.
    claims: a.claims.map((c) => ({ ...c, finding: typeof c.finding === "number" ? remap.get(c.finding) : undefined })),
    recommendation: dropped.length && v.recommendation ? v.recommendation : a.recommendation,
  };
}

/** Gives a finding that repeats an earlier one that finding's id, so the reviewer's state stays with it. */
export function carryFindingIds(a: Analysis, earlier: Finding[]): Analysis {
  const used = new Set<string>();
  return {
    ...a,
    findings: a.findings.map(({ previous, ...f }) => {
      const prev = typeof previous === "number" ? earlier[previous] : undefined;
      const id = prev ? findingId(prev) : undefined;
      if (!id || used.has(id)) return f;
      used.add(id);
      return { ...f, id };
    }),
  };
}

export type FindingStateKind = "dismissed" | "resolved" | "commented";

/** What the reviewer did with a finding. Kept per PR and matched to findings across re-runs. */
export interface FindingState {
  state: FindingStateKind;
  reason?: string;
  at: number;
}

/** Identifies a finding across analysis runs: the id carried over from an earlier run, or its first file and its title. */
export const findingId = (f: Finding) => f.id ?? `${f.anchors[0]?.path ?? ""}|${f.title.trim().toLowerCase()}`;

/** Asks Claude to write the overall summary for the review the user is about to post. */
export function buildSummaryPrompt(event: string, comments: Finding[], notes: string): string {
  const decision = { APPROVE: "approve", REQUEST_CHANGES: "request changes", COMMENT: "comment without a decision" }[event] ?? "comment";
  const list = comments.length ? comments.map((f) => `- (${f.severity}) ${f.title}`).join("\n") : "(no line comments)";
  return `Write the overall summary for the GitHub review I'm about to post on this pull request.
My decision: ${decision}.
Line comments I'm posting:
${list}
${notes.trim() ? `\nWhat I've written so far (keep its intent):\n${notes.trim()}\n` : ""}
Write 2–4 short sentences addressed to the author: what the PR does well if it's worth saying, what must change and why, and what happens next. Be specific and plain; no greetings, no headings, no generic praise, no repeating each comment. Reply with only the summary text.`;
}

/** Asks Claude to write the description for the author's own PR, following the repo's template. */
export function buildDescriptionPrompt(pr: PrDetails): string {
  return `Write the description for my pull request #${pr.number} "${pr.title}". The PR head is checked out here; see the change with: git diff origin/${pr.baseRefName}...HEAD

If the repository has a pull request template (.github/pull_request_template.md, .github/PULL_REQUEST_TEMPLATE.md, docs/pull_request_template.md or a file in .github/PULL_REQUEST_TEMPLATE/), follow its sections.
Current description (keep what's accurate):
<description>
${pr.body?.trim() || "(empty)"}
</description>

Cover what changes and why, how to test it, and anything reviewers should watch for. Use Markdown, short and concrete: bullets over paragraphs, no filler, no marketing words. Don't invent issue numbers or results you can't see. Reply with only the description.`;
}

/** Asks Claude to draft the user's reply to a review conversation. */
export function buildReplyPrompt(thread: ReviewThread, me: string, author: string): string {
  const role = me === author ? "the author of this pull request" : "a reviewer of this pull request";
  return `Write my reply to this conversation on the pull request. I'm ${me}, ${role}.
It's on ${thread.path}${thread.line ? ` line ${thread.line}` : ""}; read the code there first.

${thread.comments.map((c) => `${c.author}: ${c.body}`).join("\n\n")}

Reply in 1–3 plain sentences: agree and say what will change, answer the question, or explain briefly why not. Be specific to the code; no greetings or thanks filler. Reply with only the text.`;
}
