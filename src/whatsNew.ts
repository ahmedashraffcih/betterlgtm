import { getVersion } from "@tauri-apps/api/app";
import { inTauri } from "./mock";

const SEEN_KEY = "better-lgtm.lastSeenVersion";

// Release notes are bundled at build time; only the one being shown is loaded.
const NOTES = import.meta.glob<string>("/release-notes/v*.md", { query: "?raw", import: "default" });

/** The running app's version; in a browser preview, the one in package.json. */
export function appVersion(): Promise<string> {
  return inTauri ? getVersion() : Promise.resolve(__APP_VERSION__);
}

/** -1, 0 or 1, comparing dotted version numbers such as 0.5.0 and 0.10.1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * Decides at startup whether to show What's new, and records this version as seen either way.
 * Shown the first time a newer version opens. Not on a fresh install: someone who hasn't finished
 * setup yet has nothing to compare with. People updating from a version before this check existed
 * have no record, but have finished setup, so they see it once.
 */
let decided: Promise<string | null> | undefined;
export function versionToAnnounce(onboarded: boolean): Promise<string | null> {
  // Once per launch: a second call (React runs effects twice in development) gets the same answer.
  decided ??= decide(onboarded);
  return decided;
}

async function decide(onboarded: boolean): Promise<string | null> {
  const current = await appVersion();
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, current);
  } catch {
    return null;
  }
  const isNewer = seen ? compareVersions(current, seen) > 0 : onboarded;
  return isNewer && hasNotes(current) ? current : null;
}

export function hasNotes(version: string): boolean {
  return `/release-notes/v${version}.md` in NOTES;
}

/** The parts of a version's release notes that describe the app: the install instructions are left out. */
export async function loadNotes(version: string): Promise<{ lead: string; body: string } | null> {
  const load = NOTES[`/release-notes/v${version}.md`];
  if (!load) return null;
  const text = await load();
  const kept = text
    .split(/^(?=## )/m)
    .filter((section) => !/^## (Install|Download)/i.test(section))
    .join("")
    .split("\n")
    .filter((line) => !/choose \*\*Install update\*\*/i.test(line))
    .join("\n")
    .trim();
  const firstSection = kept.search(/^## /m);
  const lead = (firstSection === -1 ? kept : kept.slice(0, firstSection)).trim();
  const body = firstSection === -1 ? "" : kept.slice(firstSection).trim();
  return { lead, body };
}
