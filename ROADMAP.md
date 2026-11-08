# Roadmap

The features BetterLGTM is working towards. Dates aren't fixed; each milestone ships when it's ready. Each item links to its issue; comment or add a 👍 to the ones you want most, and open an [issue](https://github.com/drmas/betterlgtm/issues/new/choose) for new ideas. The original planning list is in [docs/FEATURES.md](docs/FEATURES.md), and what has shipped is in the [changelog](CHANGELOG.md).

## Shipped (0.1 – 0.2)

- Review inbox for requests to you or your teams, and **Mine** for your own PRs, with organization filters
- A worktree per PR, so Claude reads real files, fork PRs included
- Analysis: verdict, short summary, description claims checked against the code, findings linked to diff lines
- Guided review that groups related changes, with progress per change, file and section
- Chat that knows the finding, section or file you're on
- **Submit review** with findings as line comments, and the PR's review status in the header

## [0.3 — Keeping up with PRs](https://github.com/drmas/betterlgtm/milestone/1)

Spend review time on what changed and what matters most.

- **Since your last review**: on re-requested PRs, show and analyze only the commits pushed since you reviewed ([#2](https://github.com/drmas/betterlgtm/issues/2))
- **Re-check findings**: after the author pushes, Claude checks which of your earlier findings are fixed ([#3](https://github.com/drmas/betterlgtm/issues/3))
- **Prioritized inbox**: CI status, review state, size and risk on each row; sort by risk, size or waiting time ([#4](https://github.com/drmas/betterlgtm/issues/4))
- **Notifications** for new review requests and re-requests, with a count in the tray or dock ([#5](https://github.com/drmas/betterlgtm/issues/5))
- **Auto-analyze** new requests in the background (opt-in, since it uses tokens) ([#6](https://github.com/drmas/betterlgtm/issues/6))

## [0.4 — Better reviews](https://github.com/drmas/betterlgtm/milestone/2)

Help reviewers trust and act on what Claude finds.

- **Finding states**: dismiss with a reason, resolve, or mark as commented, kept across re-runs ([#7](https://github.com/drmas/betterlgtm/issues/7))
- **Suggested changes**: post a finding's fix as a GitHub suggestion the author can apply in one click ([#8](https://github.com/drmas/betterlgtm/issues/8))
- **Drafted review summary**: Claude proposes the summary in Submit review; you edit it ([#9](https://github.com/drmas/betterlgtm/issues/9))
- **Existing review threads** from GitHub shown next to the diff, so findings don't repeat what others said ([#10](https://github.com/drmas/betterlgtm/issues/10))
- **Linked issues**: check the PR against the issues it closes, not only its description ([#11](https://github.com/drmas/betterlgtm/issues/11))
- **Risk summary**: sensitive areas touched (auth, migrations, CI, dependencies) and a test-to-code ratio ([#12](https://github.com/drmas/betterlgtm/issues/12))
- **Test check**: are the changed code paths covered by changed or existing tests? ([#13](https://github.com/drmas/betterlgtm/issues/13))
- **Review guidelines**: follow a repository's `REVIEW.md` and per-repo checklists ([#14](https://github.com/drmas/betterlgtm/issues/14))

## [0.5 — Your own PRs](https://github.com/drmas/betterlgtm/milestone/3)

Make **Mine** useful for the author's side of review.

- **Self-review** before asking for reviews: the same analysis on your PR, so you catch issues first ([#15](https://github.com/drmas/betterlgtm/issues/15))
- **Write the description**: Claude drafts the PR description from the diff for you to edit ([#16](https://github.com/drmas/betterlgtm/issues/16))
- **What's blocking merge**: unresolved threads, requested changes, failing checks and missing approvals in one place ([#17](https://github.com/drmas/betterlgtm/issues/17))
- **Reply to feedback**: see each review comment with the code it's about, and draft replies ([#18](https://github.com/drmas/betterlgtm/issues/18))

## [0.6 — A stronger diff](https://github.com/drmas/betterlgtm/milestone/4)

- Syntax highlighting, expandable context, and hiding whitespace changes ([#19](https://github.com/drmas/betterlgtm/issues/19))
- **Files with findings** filter and finding counts in the file list ([#20](https://github.com/drmas/betterlgtm/issues/20))
- Select lines to **ask Claude** about them or **add a comment** ([#21](https://github.com/drmas/betterlgtm/issues/21))
- Diff search with regex and scopes (added, removed, file paths), and search across the worktree to find callers of changed code ([#22](https://github.com/drmas/betterlgtm/issues/22))

## Later

Worth doing, not scheduled yet:

- GitHub Enterprise Server ([#23](https://github.com/drmas/betterlgtm/issues/23))
- Snooze a PR until a date or new commits ([#24](https://github.com/drmas/betterlgtm/issues/24))
- Sync "viewed" files with GitHub ([#25](https://github.com/drmas/betterlgtm/issues/25))
- Let Claude run the build, tests or linters in the worktree (off by default, asks per command) ([#26](https://github.com/drmas/betterlgtm/issues/26))
- Turn a chat answer into a tracked finding ([#27](https://github.com/drmas/betterlgtm/issues/27))
