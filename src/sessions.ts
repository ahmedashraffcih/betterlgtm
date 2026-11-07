import { useCallback, useState } from "react";
import type { Analysis } from "./analysis";

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

export function useSessions() {
  const [sessions, setSessions] = useState<Record<string, PrSession>>(load);

  const update = useCallback((key: string, fn: (s: PrSession) => PrSession) => {
    setSessions((all) => {
      const next = { ...all, [key]: fn(all[key] ?? emptySession()) };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // storage full or unavailable: keep the in-memory copy
      }
      return next;
    });
  }, []);

  return { sessions, update };
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
