# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately through GitHub: go to the [Security tab](https://github.com/drmas/betterlgtm/security) and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within a week. Once a fix is released, you'll be credited in the release notes unless you'd rather not be.

## Supported versions

Only the latest release gets security fixes.

## What's in scope

BetterLGTM runs other people's code-review content through Claude Code on your machine, so these matter most:

- Anything that lets a pull request (its title, description, diff or files) make Claude write files, run commands outside the allowed read-only set, or reach the network.
- Script injection through rendered PR descriptions, Markdown or diffs.
- The app reading or exposing GitHub or Anthropic credentials.
- Worktree or clone handling that writes outside the configured data folder.

Problems in `gh`, `claude`, Tauri or WebKit themselves should go to those projects.
