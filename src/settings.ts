import { useCallback, useState } from "react";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  // General
  theme: Theme;
  refreshMinutes: number;
  autoUpdate: boolean;
  /** Single-letter, vim-style keys (j/k, h/l, gg, …) when no text field has focus. */
  vimKeys: boolean;
  /** Desktop notifications and the dock or taskbar count for review requests. */
  notifications: boolean;
  // Organizations and review requests
  orgMode: "all" | "selected";
  /** Used in "all" mode: organizations left out of the inbox. */
  hiddenOrgs: string[];
  /** Used in "selected" mode: the only organizations shown. */
  selectedOrgs: string[];
  /** Repositories (owner/name) left out of the inbox, in any mode. */
  hiddenRepos: string[];
  includePersonal: boolean;
  includeTeams: boolean;
  showDrafts: boolean;
  // Review
  diffMode: "guided" | "files";
  diffLayout: "unified" | "split";
  hideGenerated: boolean;
  // Claude
  model: string;
  effort: string;
  reviewInstructions: string;
  /** Analyze new review requests in the background. */
  autoAnalyze: boolean;
  /** When auto-analyze was turned on; only requests after this are analyzed automatically. */
  autoAnalyzeSince?: number;
  autoAnalyzeDrafts: boolean;
  /** How many analyses auto-analyze runs at once. */
  autoAnalyzeLimit: number;
  // Tools and storage
  ghPath: string;
  claudePath: string;
  dataDir: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  refreshMinutes: 5,
  autoUpdate: true,
  vimKeys: true,
  notifications: true,
  orgMode: "all",
  hiddenOrgs: [],
  selectedOrgs: [],
  hiddenRepos: [],
  includePersonal: true,
  includeTeams: true,
  showDrafts: true,
  diffMode: "guided",
  diffLayout: "unified",
  hideGenerated: true,
  model: "",
  effort: "",
  reviewInstructions: "",
  autoAnalyze: false,
  autoAnalyzeDrafts: false,
  autoAnalyzeLimit: 1,
  ghPath: "gh",
  claudePath: "claude",
  dataDir: "",
};

const KEY = "better-lgtm.settings";

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved) return { ...DEFAULT_SETTINGS, ...saved };
    // Carry over values stored separately before the settings page existed.
    const old = (k: string) => JSON.parse(localStorage.getItem(`better-lgtm.${k}`) ?? "null");
    return {
      ...DEFAULT_SETTINGS,
      hiddenOrgs: old("hiddenOrgs") ?? [],
      diffMode: old("diffMode") ?? DEFAULT_SETTINGS.diffMode,
      diffLayout: old("split") ? "split" : "unified",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // keep the in-memory copy
      }
      return next;
    });
  }, []);
  return [settings, update] as const;
}

/**
 * Whether a PR from `owner` belongs in the inbox. Owners that aren't one of the user's
 * organizations count as personal repositories (the user's own, or other people's).
 */
export function ownerVisible(s: Settings, owner: string, orgs: string[] | null): boolean {
  const isOrg = orgs ? orgs.includes(owner) : true;
  if (!isOrg) return s.includePersonal;
  return s.orgMode === "all" ? !s.hiddenOrgs.includes(owner) : s.selectedOrgs.includes(owner);
}
