import { Channel, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { inTauri, mockInvoke } from "./mock";

// Outside Tauri (browser preview during development) the backend is replaced by sample data.
const invoke = <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  inTauri || !import.meta.env.DEV ? tauriInvoke<T>(cmd, args) : (mockInvoke(cmd, args) as Promise<T>);

export interface ReviewRequest {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  author: { login: string };
  repository: { name: string; nameWithOwner: string };
}

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

/** A review comment on the new version of a file; `line` (and `start_line`) must be inside the diff. */
export interface ReviewComment {
  path: string;
  line: number;
  start_line?: number;
  body: string;
}

export interface CheckRun {
  conclusion?: string;
  status?: string;
  state?: string;
}

export interface PrDetails {
  number: number;
  title: string;
  body: string;
  url: string;
  author: { login: string };
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  statusCheckRollup: CheckRun[];
}

/** One line of `claude -p --output-format stream-json`. Only the fields we read are typed. */
export interface ClaudeEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  text?: string;
}

export const api = {
  listReviewRequests: (includeTeams: boolean) => invoke<ReviewRequest[]>("list_review_requests", { includeTeams }),
  listMyPrs: () => invoke<ReviewRequest[]>("list_my_prs"),
  listOrgs: () => invoke<{ login: string; orgs: string[] }>("list_orgs"),
  setConfig: (config: { ghPath: string; claudePath: string; dataDir: string; model: string; effort: string }) => invoke<void>("set_config", { config }),
  toolStatus: () =>
    invoke<{ gh?: string; ghError?: string; login?: string; claude?: string; claudeError?: string; dataDir: string }>("tool_status"),
  prDetails: (repo: string, number: number) => invoke<PrDetails>("pr_details", { repo, number }),
  prDiff: (repo: string, number: number) => invoke<string>("pr_diff", { repo, number }),
  prBodyHtml: (repo: string, number: number) => invoke<string>("pr_body_html", { repo, number }),
  submitReview: (repo: string, number: number, review: { commitId: string; event: ReviewEvent; body: string; comments: ReviewComment[] }) =>
    invoke<string>("submit_review", { repo, number, ...review }),
  prepareWorktree: (repo: string, number: number, baseRef: string) =>
    invoke<string>("prepare_worktree", { repo, number, baseRef }),
  claudeRun: (
    runId: string,
    cwd: string,
    prompt: string,
    resume: string | undefined,
    onEvent: (e: ClaudeEvent) => void,
  ) => {
    if (!inTauri && import.meta.env.DEV) {
      return mockInvoke("claude_run", { runId, cwd, prompt }, onEvent) as Promise<void>;
    }
    const channel = new Channel<ClaudeEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("claude_run", { runId, cwd, prompt, resume: resume ?? null, onEvent: channel });
  },
  claudeCancel: (runId: string) => invoke<void>("claude_cancel", { runId }),
};

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

/** Short description of a tool call, for progress lines and the chat transcript. */
export function describeToolUse(name: string, input: Record<string, unknown> = {}): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "Read":
      return `Read ${s("file_path")}`;
    case "Grep":
      return `Searched for ${s("pattern")}`;
    case "Glob":
      return `Listed ${s("pattern")}`;
    case "Bash":
      return `Ran ${s("command")}`;
    default:
      return name;
  }
}
