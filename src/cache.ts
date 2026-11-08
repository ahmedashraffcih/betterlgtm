import type { ReviewRequest } from "./api";

/** The inbox as last loaded, shown at startup while GitHub is asked again. */
export interface InboxCache {
  requests: ReviewRequest[];
  myPrs: ReviewRequest[];
  orgs: { login: string; orgs: string[] } | null;
  syncedAt: number;
}

const INBOX_KEY = "better-lgtm.inboxCache";

export function readInboxCache(): InboxCache | null {
  try {
    return JSON.parse(localStorage.getItem(INBOX_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function writeInboxCache(patch: Partial<InboxCache>) {
  try {
    const prev = readInboxCache() ?? { requests: [], myPrs: [], orgs: null, syncedAt: 0 };
    localStorage.setItem(INBOX_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {
    // The cache only speeds up startup.
  }
}

/**
 * Recently opened PRs, kept in memory so going back to one is instant. The entry is shown at once
 * and then refreshed from GitHub.
 */
export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private size: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
  }
  delete(key: string) {
    this.map.delete(key);
  }
}
