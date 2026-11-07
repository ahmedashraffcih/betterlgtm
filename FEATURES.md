# betterlgtm — Feature List

A local desktop app for reviewing GitHub pull requests with Claude Code. It uses the machine's `gh` CLI for GitHub access and the `claude` CLI for analysis. Every review runs in its own git worktree checked out on the PR branch.

Priority: **P0** = MVP, **P1** = soon after, **P2** = later.

---

## 1. Setup and environment

| # | Feature | Pri |
|---|---|---|
| 1.1 | Detect `gh` (installed + `gh auth status`); onboarding screen with fix-it steps if missing or logged out | P0 |
| 1.2 | Detect `claude` CLI and its auth; show version | P0 |
| 1.3 | Repo → local clone mapping. Auto-discover existing clones under chosen folders; offer to clone missing repos into an app-managed cache | P0 |
| 1.4 | Worktree root setting (default `~/.betterlgtm/worktrees/<owner>/<repo>/pr-<n>`) | P0 |
| 1.5 | Support multiple `gh` hosts (github.com + GHES) via `gh auth status --hostname` | P2 |

## 2. Review inbox (auto-fetched)

| # | Feature | Pri |
|---|---|---|
| 2.1 | Auto-fetch open PRs where review is requested from the user, directly or via a team (`gh search prs --review-requested=@me --state=open`, plus team requests via `gh api graphql`) | P0 |
| 2.2 | Background polling (interval setting, default 5 min) plus manual refresh; cached list shown instantly on launch | P0 |
| 2.3 | Row content: title, `owner/repo#n`, author avatar, age, `+/-` lines, file count, CI status, draft badge, labels, review state | P0 |
| 2.4 | "New commits since your last review" indicator on re-requested PRs | P1 |
| 2.5 | Group by org / repo, or flat list; sort by requested-at, updated, size, CI | P0 |
| 2.6 | Inbox tabs: **Needs review**, **Re-requested**, **Waiting on author**, **Done** | P1 |
| 2.7 | Quick filter box (title, author, repo, label) | P0 |
| 2.8 | Desktop notification + tray badge count for new review requests | P1 |
| 2.9 | Snooze a PR until a date or until new commits | P2 |

## 3. Organization visibility

| # | Feature | Pri |
|---|---|---|
| 3.1 | List orgs from `gh api user/orgs` and from orgs seen in fetched PRs | P0 |
| 3.2 | Show/hide toggle per org; hidden orgs are excluded from the inbox, counts and notifications | P0 |
| 3.3 | Toggle for personal (non-org) repos | P0 |
| 3.4 | Per-repo hide inside a visible org | P1 |
| 3.5 | Mode switch: "show all except hidden" or "show only selected" (newly joined orgs follow the mode) | P1 |
| 3.6 | Quick hide from an inbox row's context menu | P1 |

## 4. Review session (worktree + Claude Code)

| # | Feature | Pri |
|---|---|---|
| 4.1 | **Start review**: fetch `refs/pull/<n>/head` and run `git worktree add` on the PR head. Works for fork PRs | P0 |
| 4.2 | Start a local Claude Code session with `cwd` set to the worktree (Agent SDK / `claude -p --output-format stream-json`); store the session ID per PR | P0 |
| 4.3 | Session status steps: Preparing worktree → Fetching PR context → Verifying description → Finding key points → Ready | P0 |
| 4.4 | Resume the same session after an app restart (`--resume <id>`) | P0 |
| 4.5 | New-commits banner: "3 new commits pushed — update worktree & analyze the delta" | P1 |
| 4.6 | Worktree lifecycle: auto-clean when the PR is merged or closed, manual "remove worktree", disk usage in settings | P1 |
| 4.7 | "Open worktree in editor / terminal" (VS Code, Cursor, JetBrains, system terminal) | P1 |
| 4.8 | Concurrency limit for analyses running at once (setting) | P1 |

## 5. AI analysis

### 5a. Description ↔ implementation check (runs first)

| # | Feature | Pri |
|---|---|---|
| 5.1 | Parse the PR description (and linked issues via `gh issue view`) into discrete **claims** | P0 |
| 5.2 | Verdict per claim: ✅ Implemented · 🟡 Partial · ❌ Not found · ⚠️ Contradicted, with evidence anchors (`file:line`) | P0 |
| 5.3 | **Undocumented changes**: behavior changes in the diff that the description doesn't mention (scope creep, stray debug code, unrelated refactors) | P0 |
| 5.4 | Overall match score shown at a glance ("6/7 claims verified, 2 undocumented changes") | P0 |
| 5.5 | Flag empty or template-only descriptions | P1 |

### 5b. Key review points

| # | Feature | Pri |
|---|---|---|
| 5.6 | Ranked findings: severity (Critical / High / Medium / Low / Nit) × category (correctness, security, performance, API/breaking change, data/migrations, tests, maintainability) | P0 |
| 5.7 | Each finding has a title, a short explanation, **one or more diff anchors**, an optional suggested fix and a confidence level | P0 |
| 5.8 | **Where to start**: a recommended reading order of files, with one-line reasons | P0 |
| 5.9 | PR risk summary: size, sensitive areas touched (auth, migrations, CI config, deps), test-to-code ratio | P1 |
| 5.10 | Test coverage check: are the changed code paths exercised by changed or existing tests? | P1 |
| 5.11 | Finding states: Open / Dismissed (with reason) / Resolved / Turned into a comment | P0 |
| 5.12 | Re-run analysis (full or delta-only); keep findings history across runs | P1 |
| 5.13 | Repo-specific review guidance: reads `CLAUDE.md`, `REVIEW.md`, and custom checklists from settings | P1 |
| 5.14 | Optional: let Claude run the build, tests or linters in the worktree (off by default; asks per command) | P2 |
| 5.15 | Live streaming of findings as they're produced; token/cost readout per run | P0 |

## 6. Finding ↔ diff navigation

| # | Feature | Pri |
|---|---|---|
| 6.1 | Every anchor renders as a clickable chip (`src/auth/session.ts:42–58`) | P0 |
| 6.2 | Clicking a chip opens the diff panel scrolled to that file and range, with the lines highlighted | P0 |
| 6.3 | Diff gutter markers for lines with findings; hover previews the finding, click selects it in the list | P0 |
| 6.4 | Description claims' evidence anchors behave the same way | P0 |
| 6.5 | Keyboard: `j`/`k` next/previous finding, `Enter` open in diff, `Esc` close diff | P0 |
| 6.6 | File references in chat answers are auto-linked to the diff (or to the worktree file if it's outside the diff) | P0 |

## 7. Diff view (secondary surface)

| # | Feature | Pri |
|---|---|---|
| 7.1 | Opens as a resizable side panel or drawer; the analysis stays the main view | P0 |
| 7.2 | File tree with per-file `+/-`, finding count badges and "viewed" checkboxes | P0 |
| 7.3 | Unified / split toggle, syntax highlighting, expand context, hide whitespace | P0 |
| 7.4 | Filter: "only files with findings" | P1 |
| 7.5 | Commit range picker: all changes, a single commit, or since my last review | P1 |
| 7.6 | Sync "viewed" state with GitHub (`markFileAsViewed` GraphQL) | P2 |
| 7.7 | Select lines → "Ask Claude about this" or "Add comment" | P1 |

## 8. Search

| # | Feature | Pri |
|---|---|---|
| 8.1 | Search across the PR diff: plain text or regex, case toggle | P0 |
| 8.2 | Scope filter: added lines / removed lines / all hunks / file paths | P0 |
| 8.3 | Results grouped by file with line previews; click jumps into the diff | P0 |
| 8.4 | Optional: widen the search to the whole worktree (ripgrep) to find callers of changed code | P1 |
| 8.5 | Command palette (`⌘K`/`Ctrl+K`): jump to PR, file, finding, setting | P1 |

## 9. Persistent chat

| # | Feature | Pri |
|---|---|---|
| 9.1 | A chat docked below the analysis and findings, scoped to the PR; it continues the same Claude Code session | P0 |
| 9.2 | History persists across app restarts and re-analysis | P0 |
| 9.3 | Attach context: "Ask about this finding", a diff selection, or a file | P0 |
| 9.4 | Quick prompts: *Explain this change*, *Is this tested?*, *What could break?*, *Draft a review comment* | P1 |
| 9.5 | Claude can research inside the worktree (read, grep, git log/blame); read-only by default, with a permission-mode setting | P0 |
| 9.6 | Stop/interrupt a running answer; show the tool calls Claude makes (collapsible) | P0 |
| 9.7 | "Promote to finding": turn a chat answer into a tracked finding | P2 |

## 10. Posting the review to GitHub (always user-initiated)

| # | Feature | Pri |
|---|---|---|
| 10.1 | Turn a finding into a draft inline comment (editable) on the right line | P1 |
| 10.2 | Pending-review tray: batch comments, then submit **Approve / Request changes / Comment** via `gh api repos/{o}/{r}/pulls/{n}/reviews` | P1 |
| 10.3 | AI-drafted review summary that the user edits before posting | P1 |
| 10.4 | Show existing review threads from GitHub alongside the diff | P2 |
| 10.5 | Never posts anything without an explicit click; preview before submit | P0 |

## 11. Settings

- Org and repo visibility (§3)
- Polling interval, notifications
- Repo → local clone paths, clone cache, worktree root, auto-cleanup
- Claude: model, effort, permission mode for chat, max concurrent analyses, auto-analyze new requests (opt-in, since it costs tokens)
- Custom review prompts and checklists (global and per-repo)
- Editor and terminal integration
- Theme (light/dark/system), keyboard shortcuts

## 12. Non-functional

- **Local-first**: no backend. Credentials stay inside `gh` and `claude`; the app never stores tokens
- **Cross-platform**: macOS, Linux, Windows (Tauri or Electron shell)
- **Fast**: cached inbox, analysis streams in as it runs, diff virtualized for large PRs
- **Safe**: worktrees are isolated from the user's working checkouts; Claude is read-only by default
- **Transparent**: shows the CLI commands it runs (debug log panel) and the tokens used per PR
