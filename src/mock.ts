// Sample data so the UI can be previewed in a plain browser (`npm run dev`) without Tauri.
// Only used in development when the Tauri runtime isn't present.
import type { ClaudeEvent, PrDetails, ReviewRequest } from "./api";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const requests: ReviewRequest[] = [
  {
    number: 482,
    title: "Add idempotency keys to charge endpoint",
    url: "https://github.com/acme/payments-api/pull/482",
    isDraft: false,
    updatedAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
    author: { login: "lkowal" },
    repository: { name: "payments-api", nameWithOwner: "acme/payments-api" },
  },
  {
    number: 77,
    title: "Bump terraform AWS provider to 5.80",
    url: "https://github.com/acme/infra/pull/77",
    isDraft: true,
    updatedAt: new Date(Date.now() - 26 * 3600e3).toISOString(),
    author: { login: "renovate" },
    repository: { name: "infra", nameWithOwner: "acme/infra" },
  },
];

const details: PrDetails = {
  number: 482,
  title: "Add idempotency keys to charge endpoint",
  body: "Adds idempotency support to POST /v1/charges.\n\n- Accepts an Idempotency-Key header on charge requests.\n- Keys are stored in Redis for 24 hours.\n- Safe to retry, even when requests arrive concurrently.\n\nTesting: added integration tests for the retry path.",
  url: "https://github.com/acme/payments-api/pull/482",
  author: { login: "lkowal" },
  isDraft: false,
  headRefName: "feat/idempotency-keys",
  baseRefName: "main",
  headRefOid: "4e1b07c9a1b2c3d4",
  additions: 21,
  deletions: 2,
  changedFiles: 2,
  statusCheckRollup: [{ conclusion: "SUCCESS", status: "COMPLETED" }],
};

const diff = `diff --git a/src/idempotency/store.ts b/src/idempotency/store.ts
index 1111111..2222222 100644
--- a/src/idempotency/store.ts
+++ b/src/idempotency/store.ts
@@ -10,7 +10,19 @@ import { redis } from "../infra/redis";
 import type { CachedResponse } from "./types";

 const TTL_SECONDS = 60 * 60 * 24;

-export async function remember() {}
+export async function lookup(key: string) {
+  const raw = await redis.get(\`idem:\${key}\`);
+  return raw ? JSON.parse(raw) : null;
+}
+
+// key comes straight from the request header
+export async function save(key: string, res: CachedResponse) {
+  const existing = await redis.get(\`idem:\${key}\`);
+  if (existing) return JSON.parse(existing);
+  await redis.set(\`idem:\${key}\`, JSON.stringify(res),
+    "EX", TTL_SECONDS);
+  return res;
+}

 export { TTL_SECONDS };
diff --git a/src/http/charges.ts b/src/http/charges.ts
index 3333333..4444444 100644
--- a/src/http/charges.ts
+++ b/src/http/charges.ts
@@ -38,4 +38,11 @@ export const router = Router();
 router.post("/v1/charges", auth, async (req, res) => {
+  const key = req.header("Idempotency-Key");
+  if (key) {
+    const hit = await lookup(key);
+    if (hit) return res.status(hit.status).json(hit.body);
+  }
   const charge = await createCharge(req.merchant, req.body);
-  res.status(201).json(serialize(charge));
+  res.status(201).json(serialize(charge));
 });
diff --git a/package-lock.json b/package-lock.json
index 5555555..6666666 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -120,6 +120,13 @@
       "integrity": "sha512-abc"
     },
+    "node_modules/ioredis": {
+      "version": "5.4.1",
+      "resolved": "https://registry.npmjs.org/ioredis/-/ioredis-5.4.1.tgz",
+      "integrity": "sha512-def",
+      "dependencies": { "cluster-key-slot": "^1.1.0" }
+    },
+    "node_modules/cluster-key-slot": { "version": "1.1.2" },
     "node_modules/zod": {
`;

const bodyHtml = `<h2 dir="auto">Summary</h2>
<p dir="auto">Adds idempotency support to <code class="notranslate">POST /v1/charges</code>. Closes <a class="issue-link" href="https://github.com/acme/payments-api/issues/471">#471</a>. cc <a class="user-mention" href="https://github.com/tchen">@tchen</a></p>
<ul class="contains-task-list">
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> Accepts an <code>Idempotency-Key</code> header on charge requests.</li>
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> Keys are stored in Redis for 24 hours.</li>
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> Safe to retry, even when requests arrive concurrently.</li>
</ul>
<div class="markdown-alert markdown-alert-warning"><p class="markdown-alert-title">Warning</p><p>Needs <code>REDIS_URL</code> in every environment before deploy.</p></div>
<details><summary>Load test results</summary>
<table><thead><tr><th>Scenario</th><th>p50</th><th>p99</th></tr></thead>
<tbody><tr><td>No key</td><td>42 ms</td><td>110 ms</td></tr><tr><td>Cached hit</td><td>8 ms</td><td>21 ms</td></tr></tbody></table>
</details>
<h3>Testing</h3>
<div class="highlight highlight-source-shell"><pre class="notranslate">npm <span class="pl-c1">test</span> -- charges.idempotency</pre></div>`;

const analysis = {
  summary: ["Adds `Idempotency-Key` support to `POST /v1/charges`", "Caches the first response in Redis for 24 h", "Repeats with the same key get the cached response"],
  recommendation: { decision: "request_changes", reason: "Concurrent retries can still double-charge." },
  claims: [
    { text: "Accepts an Idempotency-Key header on charge requests.", verdict: "implemented", anchors: [{ path: "src/http/charges.ts", startLine: 39, endLine: 43 }] },
    { text: "Keys are stored in Redis for 24 hours.", verdict: "partial", note: "The TTL is 24 hours, but keys are shared across merchants.", finding: 1, anchors: [{ path: "src/idempotency/store.ts", startLine: 23, endLine: 24 }] },
    { text: "Safe to retry, even when requests arrive concurrently.", verdict: "contradicted", note: "Two concurrent requests with the same key can both create a charge.", finding: 0, anchors: [] },
  ],
  findings: [
    { severity: "critical", category: "Correctness", title: "Concurrent retries can double-charge", body: ["`save()` reads and writes the key in two calls", "Two requests arriving together both miss the cache", "Both create a charge"], fix: "Reserve the key with `SET NX` before charging.", confidence: "high", anchors: [{ path: "src/idempotency/store.ts", startLine: 21, endLine: 24 }, { path: "src/http/charges.ts", startLine: 41, endLine: 42 }] },
    { severity: "high", category: "Security", title: "Idempotency keys aren't scoped to the merchant", body: "Another merchant who sends the same key gets the first merchant's cached charge back.", fix: "Prefix the key with the merchant ID.", confidence: "high", anchors: [{ path: "src/idempotency/store.ts", startLine: 19, endLine: 21 }] },
    { severity: "low", category: "Data handling", title: "Cached response keeps the full charge body for 24 h", body: "The cached body includes card brand and last4.", confidence: "medium", anchors: [{ path: "src/http/charges.ts", startLine: 45, endLine: 45 }] },
  ],
};

const walkthrough = [
  { title: "Idempotency store in Redis", why: ["New `lookup()` and `save()` keep responses for 24 h", "Replaces the empty `remember()` stub"], changes: [{ path: "src/idempotency/store.ts", startLine: 10, endLine: 28 }] },
  { title: "Charge route uses the store", why: ["Reads `Idempotency-Key` and returns cached responses", "Saves the first response after charging"], changes: [{ path: "src/http/charges.ts", startLine: 38, endLine: 48 }] },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockInvoke(cmd: string, args: Record<string, unknown> = {}, onEvent?: (e: ClaudeEvent) => void): Promise<unknown> {
  await wait(150);
  switch (cmd) {
    case "list_review_requests":
      return requests;
    case "list_orgs":
      return { login: "you", orgs: ["acme", "globex-labs", "oss-collective"] };
    case "tool_status":
      return { gh: "gh version 2.103.3 (2026-10-26)", login: "you", claude: "2.1.318 (Claude Code)", dataDir: "/home/you/.betterlgtm" };
    case "pr_details":
      return details;
    case "pr_diff":
      return diff;
    case "pr_body_html":
      return bodyHtml;
    case "prepare_worktree":
      return "/home/you/.betterlgtm/worktrees/acme/payments-api/pr-482";
    case "claude_run": {
      onEvent?.({ type: "system", subtype: "init", session_id: "mock-session" });
      for (const name of ["Read", "Grep", "Bash"]) {
        await wait(300);
        onEvent?.({ type: "assistant", message: { content: [{ type: "tool_use", name, input: { file_path: "src/idempotency/store.ts", pattern: "redis", command: "git diff origin/main...HEAD" } }] } });
      }
      const prompt = String(args.prompt ?? "");
      const isAnalysis = prompt.includes("reply with only one JSON block");
      const isGuide = !isAnalysis && prompt.includes("guided review");
      const result = isAnalysis
        ? "```json\n" + JSON.stringify({ ...analysis, walkthrough }) + "\n```"
        : isGuide
          ? "```json\n" + JSON.stringify({ walkthrough }) + "\n```"
          : "ok";
      onEvent?.({ type: "assistant", message: { content: [{ type: "text", text: isAnalysis || isGuide ? "Done." : "This is a sample answer from the browser preview." }] } });
      onEvent?.({ type: "result", session_id: "mock-session", result, usage: { input_tokens: 12000, output_tokens: 900 } });
      return null;
    }
    default:
      return null;
  }
}
