# better-lgtm

A desktop app for reviewing GitHub pull requests with Claude Code. It lists the PRs where your review is requested (through the `gh` CLI), checks each PR out in its own git worktree, and has Claude Code compare the description with the code and point out what to look at. See [FEATURES.md](FEATURES.md) for the full feature list.

Built with Tauri 2 (Rust) and React + TypeScript.

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

- Clones: `~/.better-lgtm/clones/<owner>/<repo>` (blobless)
- Worktrees: `~/.better-lgtm/worktrees/<owner>/<repo>/pr-<n>`
- Analyses and chat history: the app's local storage
