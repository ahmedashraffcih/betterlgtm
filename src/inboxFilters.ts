import type { ReviewRequest } from "./api";
import { prRisk, RISK_RANK, waitingSince } from "./risk";

export type SortKey = "risk" | "waiting" | "size" | "updated";

export const SORTS: [SortKey, string][] = [
  ["risk", "Riskiest first"],
  ["waiting", "Waiting longest"],
  ["size", "Largest first"],
  ["updated", "Recently updated"],
];

export interface Filters {
  ci: "any" | "passing" | "failing" | "running";
  risk: "any" | "high" | "medium";
  review: "any" | "waiting" | "approved" | "changes";
  analysis: "any" | "none" | "done";
}

export const NO_FILTERS: Filters = { ci: "any", risk: "any", review: "any", analysis: "any" };

export const FILTER_GROUPS: { key: keyof Filters; label: string; options: [string, string][] }[] = [
  { key: "ci", label: "CI", options: [["any", "Any"], ["passing", "Passing"], ["failing", "Failing"], ["running", "Running"]] },
  { key: "risk", label: "Risk", options: [["any", "Any"], ["medium", "Medium+"], ["high", "High"]] },
  { key: "review", label: "Review", options: [["any", "Any"], ["waiting", "Pending"], ["changes", "Changes"], ["approved", "Approved"]] },
  { key: "analysis", label: "Analysis", options: [["any", "Any"], ["none", "Not yet"], ["done", "Analyzed"]] },
];

export function matchesFilters(pr: ReviewRequest, f: Filters, analyzed: boolean): boolean {
  const ci = pr.ci === "SUCCESS" ? "passing" : pr.ci === "FAILURE" || pr.ci === "ERROR" ? "failing" : pr.ci ? "running" : null;
  if (f.ci !== "any" && ci !== f.ci) return false;
  const risk = prRisk(pr).level;
  if (f.risk === "high" && risk !== "high") return false;
  if (f.risk === "medium" && risk === "low") return false;
  if (f.review === "approved" && pr.reviewDecision !== "APPROVED") return false;
  if (f.review === "changes" && pr.reviewDecision !== "CHANGES_REQUESTED") return false;
  if (f.review === "waiting" && (pr.reviewDecision === "APPROVED" || pr.reviewDecision === "CHANGES_REQUESTED")) return false;
  if (f.analysis === "none" && analyzed) return false;
  if (f.analysis === "done" && !analyzed) return false;
  return true;
}

const time = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0);
const lines = (pr: ReviewRequest) => (pr.additions ?? 0) + (pr.deletions ?? 0);

export const COMPARE: Record<SortKey, (a: ReviewRequest, b: ReviewRequest) => number> = {
  risk: (a, b) => RISK_RANK[prRisk(a).level] - RISK_RANK[prRisk(b).level] || time(waitingSince(a)) - time(waitingSince(b)),
  waiting: (a, b) => time(waitingSince(a)) - time(waitingSince(b)),
  size: (a, b) => lines(b) - lines(a),
  updated: (a, b) => time(b.updatedAt) - time(a.updatedAt),
};

