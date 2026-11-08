# Roadmap

The features BetterLGTM is working towards. Dates aren't fixed; each milestone ships when it's ready. Each item links to its issue; comment or add a 👍 to the ones you want most, and open an [issue](https://github.com/drmas/betterlgtm/issues/new/choose) for new ideas. The original planning list is in [docs/FEATURES.md](docs/FEATURES.md), and what has shipped is in the [changelog](CHANGELOG.md).

## Shipped (0.1 – 0.3)

- Review inbox for requests to you or your teams, and **Mine** for your own PRs, with organization filters
- A worktree per PR, so Claude reads real files, fork PRs included
- Analysis: verdict, short summary, description claims checked against the code, findings linked to diff lines
- Guided review that groups related changes, with progress per change, file and section
- Chat that knows the finding, section or file you're on
- **Submit review** with findings as line comments, and the PR's review status in the header
- Since your last review, re-checked findings, a prioritized inbox with filters, notifications and auto-analyze
- Finding states, suggested changes, a drafted summary, existing conversations, linked issues, risk and test checks, and repository guidelines

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
