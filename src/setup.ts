import type { ToolStatus } from "./api";
import { HARNESSES, type Fix, type HarnessId } from "./harness";
import { os } from "./platform";

export type { Fix };

export interface SetupItem {
  id: "gh" | "agent" | "git";
  name: string;
  /** What the app uses it for. */
  purpose: string;
  state: "ok" | "missing" | "signedout";
  /** One line on where things stand, such as the version or what is wrong. */
  detail: string;
  /** The tool's own error, when it gave one. */
  error?: string;
  fixes: Fix[];
}

const INSTALL: Record<"gh" | "git", Record<typeof os, Fix[]>> = {
  gh: {
    mac: [{ label: "Install with Homebrew", command: "brew install gh" }, { label: "Other ways to install", url: "https://cli.github.com" }],
    windows: [{ label: "Install with winget", command: "winget install --id GitHub.cli" }, { label: "Other ways to install", url: "https://cli.github.com" }],
    linux: [{ label: "Install instructions for your distribution", url: "https://github.com/cli/cli/blob/trunk/docs/install_linux.md" }],
  },
  git: {
    mac: [{ label: "Install Apple's command line tools", command: "xcode-select --install" }],
    windows: [{ label: "Install with winget", command: "winget install --id Git.Git" }],
    linux: [{ label: "Install with your package manager, for example", command: "sudo apt install git" }],
  },
};

const PURPOSE = {
  gh: "Lists the pull requests waiting on you and posts your review",
  agent: "Reads the code and writes the analysis, read-only",
  git: "Checks each pull request out into its own folder",
};

const item = (id: SetupItem["id"], name: string, state: SetupItem["state"], detail: string, fixes: Fix[] = [], error?: string): SetupItem => ({ id, name, purpose: PURPOSE[id], state, detail, error, fixes });

/** The version without the product name some agents print around it. */
export const versionOf = (text: string) => text.match(/\d+\.\d+[\w.-]*/)?.[0] ?? text;

/** The three tools the app runs, each with its state and how to fix it. */
export function setupItems(s: ToolStatus): SetupItem[] {
  const agent = HARNESSES[(s.harness as HarnessId) ?? "claude"] ?? HARNESSES.claude;
  const signedIn = s.agentAccount?.signedIn;
  return [
    !s.gh
      ? item("gh", "GitHub CLI", "missing", "Not found on this computer", INSTALL.gh[os], s.ghError)
      : !s.login
        ? item("gh", "GitHub CLI", "signedout", "Installed, but not signed in to GitHub, or GitHub can't be reached", [{ label: "Sign in", command: "gh auth login" }], s.loginError)
        : item("gh", "GitHub CLI", "ok", `Signed in as ${s.login}`),
    !s.agent
      ? item("agent", agent.name, "missing", "Not found on this computer", agent.install[os === "windows" ? "windows" : "unix"], s.agentError)
      : signedIn === false
        ? item("agent", agent.name, "signedout", "Installed, but not signed in", [agent.signIn])
        : // Some versions can't say whether they're signed in; the first analysis will tell.
          item("agent", agent.name, "ok", signedIn ? "Signed in" : `Version ${versionOf(s.agent)}`),
    !s.git ? item("git", "Git", "missing", "Not found on this computer", INSTALL.git[os], s.gitError) : item("git", "Git", "ok", s.git.replace(/^git version\s*/, "Version ")),
  ];
}

/** Whether something the app can't work without is missing or signed out. */
export const setupBroken = (s: ToolStatus) => setupItems(s).some((i) => i.state !== "ok");
