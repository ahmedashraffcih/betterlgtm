import type { ReviewRequest } from "./api";

export type RiskLevel = "high" | "medium" | "low";

/** Paths that deserve a slower review, by the reason shown to the reviewer. */
const SENSITIVE: [string, RegExp][] = [
  ["auth or security", /(^|\/)(auth|security|crypto|permissions?|session|oauth|login)[^/]*(\/|$)|password|secret|token/i],
  ["database migrations", /(^|\/)migrations?\/|\.sql$|(^|\/)schema\.(rb|prisma|sql)$/i],
  ["CI or infrastructure", /^\.github\/workflows\/|\.gitlab-ci\.yml$|(^|\/)Dockerfile|\.tf$|(^|\/)(helm|k8s|kubernetes|terraform)\//i],
  ["dependencies", /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.(toml|lock)|go\.(mod|sum)|requirements[^/]*\.txt|Gemfile(\.lock)?|composer\.(json|lock)|pyproject\.toml|poetry\.lock)$/],
];

/** A quick risk estimate from size, sensitive paths and CI, with the reasons behind it. */
export function prRisk(pr: ReviewRequest): { level: RiskLevel; reasons: string[] } {
  const lines = (pr.additions ?? 0) + (pr.deletions ?? 0);
  const areas = SENSITIVE.filter(([, re]) => pr.files?.some((f) => re.test(f))).map(([name]) => name);
  const failing = pr.ci === "FAILURE" || pr.ci === "ERROR";
  const reasons = [
    ...(failing ? ["CI is failing"] : []),
    ...(lines > 1000 ? [`large change (${lines.toLocaleString()} lines)`] : lines > 300 ? [`${lines.toLocaleString()} changed lines`] : []),
    ...areas.map((a) => `touches ${a}`),
  ];
  const level: RiskLevel = failing || lines > 1000 || (areas.length > 0 && lines > 300) || areas.length > 1 ? "high" : areas.length > 0 || lines > 300 ? "medium" : "low";
  return { level, reasons };
}

export const RISK_RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

/** When the PR started waiting on you: the review request, or when it was opened. */
export const waitingSince = (pr: ReviewRequest) => pr.requestedAt ?? pr.createdAt ?? pr.updatedAt;
