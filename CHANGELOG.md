# Changelog

All notable changes to BetterLGTM are listed here. Versions follow [semantic versioning](https://semver.org/).

## Unreleased

- **Vim-style keys**: move between the inbox, the list and the content with h/l, through items with j/k, jump with gg/G, step through findings with n/N and files or sections with ]/[, mark reviewed with x, add a finding to the review with a, and submit with S. Esc leaves a text field. Press ? for the full list; turn them off in Settings › General. j/k now move within the focused pane; n/N step through findings.
- **Re-check findings** ([#3](https://github.com/drmas/betterlgtm/issues/3)): when a PR has new commits since the analysis, Claude checks each finding and marks it fixed, still open, partly fixed or unclear, with a short note. Fixed findings start unchecked in Submit review.
- **Prioritized inbox** ([#4](https://github.com/drmas/betterlgtm/issues/4)): rows show CI status, review decision, lines changed and a risk estimate (from size, failing CI, and auth, migration, CI or dependency files, with the reasons on hover). A filter button next to the search box holds the sort order and filters for CI, risk, review decision, analysis and drafts, all kept across restarts; the search also matches labels.
- **Notifications** ([#5](https://github.com/drmas/betterlgtm/issues/5)): a desktop notification when a review is requested from you or requested again, and a count of waiting reviews on the app icon (macOS and supported Linux desktops). Hidden organizations are left out; turn it off in Settings › General.

## [0.2.5] — 2026-11-08

- **Since your last review** ([#2](https://github.com/drmas/betterlgtm/issues/2)): when commits land after your last review, a bar shows how many and when you reviewed. Switch the diff to just those changes, or analyze only them.
- **Open any pull request** from the command palette by pasting its link or typing `owner/repo#number`.
- Fixed tool errors (such as mise's "not trusted") when the app was started inside a project folder with its own tool setup.

## [0.2.4] — 2026-11-08

- Fixed "Could not run `gh`" when the app is opened from the Dock, Finder, Spotlight or a desktop launcher. The app now uses your login shell's PATH plus the usual Homebrew, npm and Claude Code folders. ([#1](https://github.com/drmas/betterlgtm/issues/1))

## [0.2.3] — 2026-11-08

- **Mine:** the inbox can switch to your own open pull requests.
- **Submit review:** post a review to GitHub from the app, with the findings you choose as comments on their diff lines. Findings outside the diff go in the review summary. One checkbox selects every finding.
- **Review status:** the PR header shows GitHub's review decision, whether your review is requested, each reviewer's latest review, and who is still being waited on.
- Update checks retry when GitHub's downloads fail, and use a copy of the update feed on the website first.

## [0.2.2] — 2026-11-08

- Fixed pull requests over 20,000 changed lines failing to load; their diff is now built from the local clone.

## [0.2.1] — 2026-11-08

- The app checks for new versions and installs them when you choose **Install update** in the status bar. Turn automatic checks off in Settings › General, or use Help › Check for updates.
- Fixed `git`, `gh` and `claude` crashing with library errors when run from the Linux AppImage.

0.2.0 was tagged but never published; its changes are in 0.2.1.

## [0.1.1] — 2026-11-07

- macOS builds are signed with a Developer ID certificate and notarized by Apple.
- Renamed the app to BetterLGTM; installers are now named `BetterLGTM_<version>_…`.
- Open-sourced under the MIT License, with a website and project docs.

## [0.1.0] — 2026-11-07

The first release.

- Review inbox for pull requests where your review is requested, grouped by organization, with a refresh timer and per-organization hiding.
- A git worktree per pull request next to a shared blobless clone.
- Analysis with Claude Code: a verdict, a short summary, a check of each description claim against the code, and findings linked to diff lines.
- Guided review that groups related changes into sections, with review progress per change, file and section.
- File-by-file unified and split diff with search; generated files are folded by default.
- Chat with Claude that knows the finding, section or file you're looking at.
- Menu bar, command palette, keyboard shortcuts, light and dark themes, and a Settings page.
- Installers for macOS (Apple silicon and Intel), Windows and Linux.

[0.2.5]: https://github.com/drmas/betterlgtm/releases/tag/v0.2.5
[0.2.4]: https://github.com/drmas/betterlgtm/releases/tag/v0.2.4
[0.2.3]: https://github.com/drmas/betterlgtm/releases/tag/v0.2.3
[0.2.2]: https://github.com/drmas/betterlgtm/releases/tag/v0.2.2
[0.2.1]: https://github.com/drmas/betterlgtm/releases/tag/v0.2.1
[0.1.1]: https://github.com/drmas/betterlgtm/releases/tag/v0.1.1
[0.1.0]: https://github.com/drmas/betterlgtm/releases/tag/v0.1.0
