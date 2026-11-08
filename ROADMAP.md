# Roadmap

The features BetterLGTM is working towards. Dates aren't fixed; each milestone ships when it's ready. Each item links to its issue; comment or add a 👍 to the ones you want most, and open an [issue](https://github.com/drmas/betterlgtm/issues/new/choose) for new ideas. The original planning list is in [docs/FEATURES.md](docs/FEATURES.md), and what has shipped is in the [changelog](CHANGELOG.md).

## Shipped (0.1 – 0.4)

- Review inbox for requests to you or your teams, and **Mine** for your own PRs, with organization filters
- A worktree per PR, so Claude reads real files, fork PRs included
- Analysis: verdict, short summary, description claims checked against the code, findings linked to diff lines
- Guided review that groups related changes, with progress per change, file and section
- Chat that knows the finding, section or file you're on
- **Submit review** with findings as line comments, and the PR's review status in the header
- Since your last review, re-checked findings, a prioritized inbox with filters, notifications and auto-analyze
- Finding states, suggested changes, a drafted summary, existing conversations, linked issues, risk and test checks, and repository guidelines
- Your own PRs: what's blocking merge, self-review, a Claude-written description and replies to feedback
- A stronger diff: syntax highlighting, hidden lines, whitespace hiding, line comments, and diff and repository search

## Next

Not scheduled yet; vote on the ones you want:

- GitHub Enterprise Server ([#23](https://github.com/drmas/betterlgtm/issues/23))
- Snooze a PR until a date or new commits ([#24](https://github.com/drmas/betterlgtm/issues/24))
- Sync "viewed" files with GitHub ([#25](https://github.com/drmas/betterlgtm/issues/25))
- Let Claude run the build, tests or linters in the worktree (off by default, asks per command) ([#26](https://github.com/drmas/betterlgtm/issues/26))
- Turn a chat answer into a tracked finding ([#27](https://github.com/drmas/betterlgtm/issues/27))
