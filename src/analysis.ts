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
  confidence?: "high" | "medium" | "low";
  notInDescription?: boolean;
  anchors: Anchor[];
}

export interface ReadingStep {
  path: string;
  why: string;
}

export type Decision = "approve" | "comment" | "request_changes";

export interface Analysis {
  /** Two or three plain sentences on what the PR does. Missing in analyses from older versions. */
  summary?: string;
  recommendation?: { decision: Decision; reason: string };
  claims: Claim[];
  findings: Finding[];
  readingOrder: ReadingStep[];
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function buildAnalysisPrompt(pr: PrDetails): string {
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
3. Suggest an order for reading the changed files.
4. Summarize what the PR does in two or three plain sentences, and recommend a decision:
   approve, comment, or request_changes, with a one-sentence reason.

Write for a busy reviewer: short sentences, everyday words, no filler. Explain why something matters,
not just what it is. You may use Markdown in "summary", "note", "body" and "fix" (for example
\`inline code\` for identifiers and short lists), but no headings.
Line numbers refer to the new version of the file. Paths are relative to the repository root.
When you are done, reply with only one JSON block in this shape:

\`\`\`json
{
  "summary": "...",
  "recommendation": { "decision": "approve|comment|request_changes", "reason": "..." },
  "claims": [{ "text": "...", "verdict": "implemented|partial|contradicted|missing", "note": "...", "finding": 0,
               "anchors": [{ "path": "src/x.ts", "startLine": 10, "endLine": 14 }] }],
  "findings": [{ "severity": "critical|high|medium|low", "category": "Correctness|Security|Behavior change|Tests|Data handling|Performance|Maintainability",
                 "title": "...", "body": "...", "fix": "...", "confidence": "high|medium|low", "notInDescription": false,
                 "anchors": [{ "path": "src/x.ts", "startLine": 10, "endLine": 14 }] }],
  "readingOrder": [{ "path": "src/x.ts", "why": "..." }]
}
\`\`\`
"finding" on a claim is the index of the finding that explains the problem, or omit it.`;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Pulls the last JSON block out of Claude's final answer. Returns null when there is none. */
export function parseAnalysis(text: string): Analysis | null {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.length ? blocks.reverse() : [text];
  for (const raw of candidates) {
    try {
      const data = JSON.parse(raw.trim());
      const findings = asArray<Finding>(data.findings).map((f) => ({ ...f, anchors: asArray<Anchor>(f.anchors) }));
      const order = findings.map((_, i) => i).sort((a, b) => SEVERITY_RANK[findings[a].severity] - SEVERITY_RANK[findings[b].severity]);
      const remap = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
      const rec = data.recommendation;
      return {
        summary: typeof data.summary === "string" ? data.summary : undefined,
        recommendation:
          rec && ["approve", "comment", "request_changes"].includes(rec.decision) ? { decision: rec.decision, reason: String(rec.reason ?? "") } : undefined,
        findings: order.map((i) => findings[i]),
        claims: asArray<Claim>(data.claims).map((c) => ({
          ...c,
          anchors: asArray<Anchor>(c.anchors),
          finding: typeof c.finding === "number" ? remap.get(c.finding) : undefined,
        })),
        readingOrder: asArray<ReadingStep>(data.readingOrder),
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
