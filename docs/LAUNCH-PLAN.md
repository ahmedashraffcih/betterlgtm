# BetterLGTM launch plan

Where to list BetterLGTM, what each channel needs, and how to announce it. Status as of 8 Nov 2026: v0.1.1 is out, the macOS build is signed and notarized, Windows is unsigned, the repo is public with 0 stars, and the site is at drmas.github.io/betterlgtm.

## Summary

| Order | Channel | Effort | Blocked by |
|---|---|---|---|
| 1 | Homebrew tap (`drmas/tap`) | 1 hour | Nothing |
| 1 | AUR (`betterlgtm-bin`) | 1 hour | Nothing |
| 1 | Scoop bucket | 1 hour | Nothing |
| 2 | winget | 2 hours | Ideally Windows signing |
| 2 | Launch posts (HN, Reddit, X, Product Hunt…) | 2 days | Demo video, auto-update |
| 3 | Homebrew core cask | 1 hour | 75+ stars, 30 forks, 30 watchers |
| 3 | Microsoft Store (Win32 listing) | 1 day | Windows signing |
| ✗ | Mac App Store | — | App Sandbox would block running `gh`, `claude` and `git` |
| ✗ | Flathub / Snap (strict) | — | Sandbox would block running host tools |

## Before launch: fix these first

These cost far less now than after a public launch brings first impressions and bug reports.

1. **Auto-update.** Add the Tauri updater plugin, so people who install from the website get new versions without coming back. Generate an updater key, add it to the release workflow, and publish `latest.json` with each release. Package-manager installs are updated by their own channel.
2. **First-run check.** If `gh` or `claude` is missing or signed out, show a setup screen with the exact command to fix it, instead of an empty inbox or a failed analysis. This is the most likely first-run failure for new users, especially on macOS when the app is opened from Finder and doesn't get the shell's PATH.
3. **Windows signing.** Apply to [SignPath Foundation](https://signpath.org/) (free for open source) or use Azure Trusted Signing. It removes the SmartScreen warning and is required for the Microsoft Store.
4. **Demo video.** 30–45 seconds: inbox → Start review → verdict and a finding → jump to the line → guided review → ask a question. Record it with sample data (`npm run dev`) so no private code appears. Use it in the README, on the site, and in every post.
5. **Domain.** Point betterlgtm.com at GitHub Pages (`site/CNAME`, DNS A/AAAA records, then set the custom domain in the repo's Pages settings), so the links in posts stay valid if hosting changes.
6. **Submit review (optional).** Approving or requesting changes from inside the app is the most obvious missing piece. Without it, posts should say clearly that the review is submitted on GitHub.

## Stores and package managers

### macOS

**Homebrew tap — now.** Create `drmas/homebrew-tap` with `Casks/betterlgtm.rb`. Users install with `brew install --cask drmas/tap/betterlgtm`. The cask points at the signed DMGs (arm64 and Intel) and lists `gh` as a dependency in its caveats. Add a release-workflow step that bumps the version and sha256 in the tap automatically.

**Homebrew core cask — later.** `homebrew/cask` only accepts apps with enough notability (roughly 75 stars, 30 forks and 30 watchers, and stricter for self-submitted apps). Submit once the launch gets there; until then, the tap is the install path.

**Mac App Store — skip.** App Store apps must run in the App Sandbox, which blocks starting `gh`, `claude` and `git` and reading their config in your home folder. That is the core of how BetterLGTM works. Developer ID with notarization (already done) is the right distribution route for this kind of tool.

### Windows

**Scoop — now.** Add a manifest to your own bucket (`drmas/scoop-bucket`), then propose it to the `extras` bucket after launch. Scoop users accept unsigned apps.

**winget — after signing if possible.** Submit a manifest to `microsoft/winget-pkgs` with [wingetcreate](https://github.com/microsoft/winget-create) pointing at the `.msi` or `.exe`. Unsigned installers are accepted but get flagged more often by Defender's checks. Automate updates with `wingetcreate update` in the release workflow.

**Microsoft Store — after signing.** The Store lists Win32 apps (MSI/EXE) directly, and individual developer accounts are free. The installer must be signed with a certificate from a trusted CA and support silent install. Listing needs screenshots, a privacy policy URL (add a short one to the site: code and reviews stay local; only anonymous usage counts are sent, and they can be turned off in Settings), and age rating.

**Chocolatey — optional.** A moderated community repository; worth it only if users ask.

### Linux

**AUR — now.** Publish `betterlgtm-bin` (repackages the `.deb` or AppImage) so Arch users can `yay -S betterlgtm-bin`. Optionally add a `betterlgtm` source package later.

**Flathub and Snap — skip for now.** Both sandbox the app. BetterLGTM would need to escape the sandbox to run `gh`, `claude` and `git` on the host (`flatpak-spawn --host`, or Snap classic confinement), which reviewers usually refuse or delay. Revisit only if there's demand.

**AppImageHub — optional.** A free listing that points at the AppImage.

## Announcing it

### Launch day (one weekday, Tuesday–Thursday, morning US Eastern)

| Where | Post | Notes |
|---|---|---|
| Hacker News | **Show HN: BetterLGTM – review PRs with Claude Code, in a local desktop app** | Link to the GitHub repo, not the site. Post a first comment on why you built it, how it stays read-only, and what's next. Stay and answer for the first few hours. |
| Product Hunt | Tagline: **Mean it when you say lgtm** | Schedule for 00:01 PT. Needs a gallery (screenshots + demo video), a maker comment, and a few people ready to try it, not vote-begging. |
| X / Bluesky / Mastodon / LinkedIn | Short thread with the demo video | See the draft below. Tag `@AnthropicAI` / Claude Code and `@TauriApps` where appropriate. |
| Reddit | r/ClaudeAI, r/ClaudeCode, r/github, r/rust (Tauri angle) | Use a text post explaining what it does and how, not just a link. Check each subreddit's self-promotion rules first. |

### The week after

- **Blog post** on dev.to or Hashnode: "Making Claude Code review my PRs without letting it touch anything": the read-only tool list, worktrees per PR, and lessons from the guided review.
- **Lists and showcases:** pull requests to `awesome-tauri`, `awesome-claude-code`, and the Tauri showcase.
- **Newsletters:** submit to Changelog News, Console.dev, TLDR, and This Week in Rust (Tauri apps qualify under the project updates section).
- **Communities:** share in the Claude Developers Discord and the Tauri Discord showcase channels.

### Draft copy

**Short pitch (one line):** BetterLGTM is a free desktop app that checks out the PRs waiting on your review, has Claude Code compare the description with the code, and walks you through the change.

**Thread:**

1. Most LGTMs are rubber stamps. I built BetterLGTM so mine aren't. 🧵 [demo video]
2. It lists the PRs where your review is requested (via `gh`), checks each one out in its own git worktree, and runs Claude Code on it.
3. You get a verdict, a 3-line summary, and the findings that need attention, each linked to the exact lines. It also checks every claim in the PR description against the code.
4. Then a guided review: related edits grouped into sections, in reading order. Tick them off as you go.
5. Claude runs read-only. It can read, grep and look at git history, nothing else. No server, no account: it uses your own `gh` and `claude`.
6. Free and open source (MIT), for macOS, Windows and Linux: [site link]

**Show HN first comment:**

> I review a lot of PRs and kept approving things I'd only skimmed. BetterLGTM is my attempt to make the careful review the fast one. It's a Tauri app that shells out to `gh` for GitHub and `claude -p` for analysis, inside a per-PR worktree so Claude sees real files. Claude is limited to Read/Grep/Glob and read-only git commands. Submitting the review still happens on GitHub; that's next on my list. I'd love feedback on the analysis format and on what you'd want it to catch.

## Measuring it

- GitHub stars, forks and watchers (also the Homebrew core threshold)
- Release download counts per platform: `gh api repos/drmas/betterlgtm/releases --jq '.[].assets[] | "\(.name) \(.download_count)"'`
- Issues opened in the first two weeks, sorted by first-run problems vs feature requests
- Referrers in the repo's Insights › Traffic

## Timeline

| When | What |
|---|---|
| Week 1 | Auto-update, first-run check, demo video, domain; apply for Windows signing |
| Week 2 | Homebrew tap, AUR, Scoop; release v0.2.0 with the above |
| Week 3 | Launch day (HN, Product Hunt, social, Reddit) |
| Week 4 | Blog post, lists, newsletters; winget once signing lands |
| Later | Homebrew core cask at 75+ stars; Microsoft Store after signing |
