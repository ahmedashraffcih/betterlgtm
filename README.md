# betterlgtm

A desktop app for reviewing GitHub pull requests with Claude Code. It lists the PRs where your review is requested (through the `gh` CLI), checks each PR out in its own git worktree, and has Claude Code compare the description with the code and point out what to look at. See [FEATURES.md](FEATURES.md) for the full feature list.

Built with Tauri 2 (Rust) and React + TypeScript.

## Install

Download the installer for your platform from [Releases](../../releases). Builds aren't code-signed yet; the release notes explain how to open them on macOS and Windows.

## Release

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Add `release-notes/v<version>.md`.
3. Commit, then tag and push: `git tag v<version> && git push origin v<version>`.

The Release workflow builds macOS (Apple silicon and Intel), Windows and Linux installers, attaches them to the release, and publishes it once every build succeeds.

## Requirements

- Rust (stable) and Node.js 22+
- [GitHub CLI](https://cli.github.com/) signed in: `gh auth status`
- [Claude Code](https://claude.com/claude-code) signed in: `claude`
- Linux: WebKitGTK 4.1 (`webkit2gtk-4.1`)

## Develop

```bash
npm install
npm run tauri dev
```

Running `npm run dev` alone opens the UI in a browser with sample data instead of `gh` and `claude`, which is handy for layout work.

## Where things are stored

- Clones: `~/.betterlgtm/clones/<owner>/<repo>` (blobless)
- Worktrees: `~/.betterlgtm/worktrees/<owner>/<repo>/pr-<n>`
- Analyses and chat history: the app's local storage
