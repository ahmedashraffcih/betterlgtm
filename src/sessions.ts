import { useCallback, useState } from "react";
import type { Analysis, FindingChecks, FindingState } from "./analysis";
import type { DraftComment } from "./components/DiffView";

export interface ChatItem {
  role: "user" | "assistant" | "tool" | "error";
  text: string;
  /** What the question was about (a finding, claim or file), shown as a small tag. */
  context?: string;
}

/** Everything the app remembers about one PR review, persisted across restarts. */
export interface PrSession {
  worktree?: string;
  sessionId?: string;
  analysis?: Analysis;
  analysisRaw?: string;
  analyzedAt?: number;
  /** Set when the last analysis covered only the changes after this commit (a re-review). */
  analysisSince?: string;
  /** The PR head the analysis looked at. */
  analysisHead?: string;
  /** Findings re-checked after new commits. */
  findingChecks?: FindingChecks;
  /** Dismissed, resolved or commented findings, keyed by `findingId`. */
  findingStates?: Record<string, FindingState>;
  /** Comments written on selected diff lines, waiting for Submit review. */
  draftComments?: DraftComment[];
  headOid?: string;
  chat: ChatItem[];
  tokens?: number;
  costUsd?: number;
  inReview: number[];
  /** Hunks the user marked as reviewed (see `hunkKey`); drives step and file progress. */
  reviewedHunks?: string[];
}

const KEY = "better-lgtm.sessions";

function load(): Record<string, PrSession> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function emptySession(): PrSession {
  return { chat: [], inReview: [] };
}

// Sessions hold chats and analyses, so writing all of them on every change is slow; writes are batched.
let unsaved: Record<string, PrSession> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Writes pending session changes now (before quitting or restarting). */
export function flushSessions() {
  clearTimeout(saveTimer);
  if (!unsaved) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(unsaved));
  } catch {
    // storage full or unavailable: keep the in-memory copy
  }
  unsaved = null;
}

function save(all: Record<string, PrSession>) {
  unsaved = all;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSessions, 800);
}

window.addEventListener("pagehide", flushSessions);
window.addEventListener("beforeunload", flushSessions);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushSessions());

export function useSessions() {
  const [sessions, setSessions] = useState<Record<string, PrSession>>(load);

  const update = useCallback((key: string, fn: (s: PrSession) => PrSession) => {
    setSessions((all) => {
      const next = { ...all, [key]: fn(all[key] ?? emptySession()) };
      save(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setSessions({});
    unsaved = null;
    clearTimeout(saveTimer);
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  }, []);

  return { sessions, update, clearAll };
}

export function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // ignore
      }
    },
    [key],
  );
  return [value, set] as const;
}
