# Changelog

All notable changes to BetterLGTM are listed here. Versions follow [semantic versioning](https://semver.org/).

## Unreleased

- **Mine:** the inbox can switch to your own open pull requests.
- **Submit review:** post a review to GitHub from the app, with the findings you choose as comments on their diff lines. Findings outside the diff go in the review summary.
- Update checks retry when GitHub's downloads fail, and use a copy of the update feed on the website first.

## 0.2.2 — 2026-11-08

- Fixed pull requests over 20,000 changed lines failing to load; their diff is now built from the local clone.

## 0.2.1 — 2026-11-08

- The app checks for new versions and installs them when you choose **Install update** in the status bar. Turn automatic checks off in Settings › General, or use Help › Check for updates.
- Fixed `git`, `gh` and `claude` crashing with library errors when run from the Linux AppImage.

0.2.0 was tagged but never published; its changes are in 0.2.1.

## 0.1.1 — 2026-11-07

- macOS builds are signed with a Developer ID certificate and notarized by Apple.
- Renamed the app to BetterLGTM; installers are now named `BetterLGTM_<version>_…`.
- Open-sourced under the MIT License, with a website and project docs.

## 0.1.0 — 2026-11-07

The first release.

- Review inbox for pull requests where your review is requested, grouped by organization, with a refresh timer and per-organization hiding.
- A git worktree per pull request next to a shared blobless clone.
- Analysis with Claude Code: a verdict, a short summary, a check of each description claim against the code, and findings linked to diff lines.
- Guided review that groups related changes into sections, with review progress per change, file and section.
- File-by-file unified and split diff with search; generated files are folded by default.
- Chat with Claude that knows the finding, section or file you're looking at.
- Menu bar, command palette, keyboard shortcuts, light and dark themes, and a Settings page.
- Installers for macOS (Apple silicon and Intel), Windows and Linux.

[0.2.2]: https://github.com/drmas/betterlgtm/releases/tag/v0.2.2
[0.2.1]: https://github.com/drmas/betterlgtm/releases/tag/v0.2.1
[0.1.1]: https://github.com/drmas/betterlgtm/releases/tag/v0.1.1
[0.1.0]: https://github.com/drmas/betterlgtm/releases/tag/v0.1.0
