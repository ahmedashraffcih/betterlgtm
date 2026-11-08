import { Check, CircleCheck, CircleDot, CircleX, Clock, MessageSquare, PencilLine, X, type LucideIcon } from "lucide-react";
import type { PrDetails, Review } from "../api";

const DECISION: Record<string, { label: string; tone: string; icon: LucideIcon }> = {
  APPROVED: { label: "Approved", tone: "ok", icon: CircleCheck },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "crit", icon: CircleX },
  REVIEW_REQUIRED: { label: "Review required", tone: "high", icon: CircleDot },
  NONE: { label: "No reviews yet", tone: "muted", icon: CircleDot },
  REVIEWED: { label: "Reviewed", tone: "muted", icon: MessageSquare },
};

const STATE: Record<Review["state"], { verb: string; tone: string; icon: LucideIcon }> = {
  APPROVED: { verb: "approved", tone: "tone-ok", icon: Check },
  CHANGES_REQUESTED: { verb: "requested changes", tone: "tone-crit", icon: X },
  COMMENTED: { verb: "commented", tone: "tone-muted", icon: MessageSquare },
  DISMISSED: { verb: "review dismissed", tone: "tone-muted", icon: X },
  PENDING: { verb: "draft review", tone: "tone-muted", icon: PencilLine },
};

function ago(iso?: string): string {
  if (!iso) return "";
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/**
 * The PR's review state on GitHub: the overall decision, where you stand, and each reviewer's
 * latest review or pending request.
 */
export function ReviewStatus({ details, me }: { details: PrDetails; me?: string }) {
  const reviews = (details.latestReviews ?? []).filter((r) => r.author.login !== details.author.login);
  const requests = details.reviewRequests ?? [];
  // Repositories without required reviews report no decision; derive one from the reviews.
  const decision =
    details.reviewDecision ||
    (reviews.some((r) => r.state === "CHANGES_REQUESTED") ? "CHANGES_REQUESTED" : reviews.some((r) => r.state === "APPROVED") ? "APPROVED" : reviews.length ? "REVIEWED" : "NONE");
  const d = DECISION[decision] ?? DECISION.NONE;
  const DecisionIcon = d.icon;

  const mine = me ? reviews.find((r) => r.author.login === me) : undefined;
  const asked = !!me && requests.some((r) => r.login === me);
  const you =
    details.author.login === me ? "Your pull request" : asked ? (mine ? "Your review is requested again" : "Your review is requested") : mine ? `You ${STATE[mine.state].verb}` : null;

  return (
    <div className="review-status" aria-label="Review status">
      <span className={`rs-chip rs-${d.tone}`}><DecisionIcon size={13} />{d.label}</span>
      {you && <span className={asked ? "rs-you rs-asked" : "rs-you"}>{you}</span>}
      {reviews.map((r) => {
        const s = STATE[r.state];
        const Icon = s.icon;
        return (
          <span key={r.author.login} className="rs-person opt" title={`${r.author.login} ${s.verb}${r.submittedAt ? ` ${ago(r.submittedAt)}` : ""}`}>
            <Icon size={12} className={s.tone} />{r.author.login === me ? "You" : r.author.login} {s.verb}
          </span>
        );
      })}
      {requests.length > 0 && (
        <span className="rs-person opt" title="Asked to review and haven't since">
          <Clock size={12} className="tone-muted" />Waiting on {requests.map((r) => (r.login === me ? "you" : (r.login ?? r.name ?? r.slug ?? "a team"))).join(", ")}
        </span>
      )}
    </div>
  );
}
