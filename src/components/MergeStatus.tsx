import { CircleCheck, CircleDashed, CircleX, GitMerge, MessageSquare, PencilLine, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import type { PrDetails, ReviewThread } from "../api";

interface Blocker {
  Icon: LucideIcon;
  tone: string;
  text: string;
}

const FAILED = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];
const RUNNING = ["PENDING", "IN_PROGRESS", "QUEUED", "WAITING", "EXPECTED"];

/** Everything between your PR and merging: draft, conflicts, checks, reviews and open conversations. */
export function blockers(pr: PrDetails, threads: ReviewThread[]): Blocker[] {
  const out: Blocker[] = [];
  if (pr.isDraft) out.push({ Icon: PencilLine, tone: "tone-muted", text: "Still a draft. Mark it ready for review on GitHub when it is." });
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") out.push({ Icon: GitMerge, tone: "tone-crit", text: `Has merge conflicts with ${pr.baseRefName}.` });
  else if (pr.mergeStateStatus === "BEHIND") out.push({ Icon: GitMerge, tone: "tone-high", text: `Behind ${pr.baseRefName}; update the branch before merging.` });
  const checks = pr.statusCheckRollup ?? [];
  const failed = checks.filter((c) => FAILED.includes(c.conclusion ?? c.state ?? ""));
  const running = checks.filter((c) => !c.conclusion && RUNNING.includes(c.status ?? c.state ?? ""));
  const name = (c: (typeof checks)[number]) => c.name ?? c.context ?? "check";
  if (failed.length) out.push({ Icon: CircleX, tone: "tone-crit", text: `Failing ${failed.length === 1 ? "check" : "checks"}: ${failed.map(name).join(", ")}.` });
  if (running.length) out.push({ Icon: CircleDashed, tone: "tone-high", text: `${running.length} ${running.length === 1 ? "check is" : "checks are"} still running.` });
  const changes = (pr.latestReviews ?? []).filter((r) => r.state === "CHANGES_REQUESTED").map((r) => r.author.login);
  if (changes.length) out.push({ Icon: CircleX, tone: "tone-crit", text: `Changes requested by ${changes.join(", ")}.` });
  else if (pr.reviewDecision === "REVIEW_REQUIRED") {
    const waiting = (pr.reviewRequests ?? []).map((r) => r.login ?? r.name ?? r.slug).filter(Boolean);
    out.push({ Icon: Users, tone: "tone-high", text: waiting.length ? `Needs an approval; waiting on ${waiting.join(", ")}.` : "Needs an approval; ask someone to review it." });
  }
  const open = threads.filter((t) => !t.isResolved && t.comments.length).length;
  if (open) out.push({ Icon: MessageSquare, tone: "tone-high", text: `${open} unresolved ${open === 1 ? "conversation" : "conversations"}.` });
  return out;
}

export function MergeStatus({ pr, threads }: { pr: PrDetails; threads: ReviewThread[] }) {
  const list = blockers(pr, threads);
  return (
    <section className="merge-status" aria-label="What's blocking merge">
      <h2 className="section-title">{list.length ? "What's blocking merge" : "Merge status"}</h2>
      {list.length === 0 ? (
        <div className="merge-row"><CircleCheck size={16} className="tone-ok" /><span>Nothing is blocking this pull request. It's ready to merge.</span></div>
      ) : (
        list.map((b, i) => (
          <div key={i} className="merge-row"><b.Icon size={16} className={b.tone} /><span>{b.text}</span></div>
        ))
      )}
      {pr.mergeable === "UNKNOWN" && <div className="merge-row muted"><TriangleAlert size={14} />GitHub is still working out whether it can merge.</div>}
    </section>
  );
}
