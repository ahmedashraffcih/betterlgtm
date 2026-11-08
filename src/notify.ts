import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect, useRef } from "react";
import type { ReviewRequest } from "./api";
import { prKey } from "./components/Inbox";
import { inTauri } from "./mock";

const SEEN_KEY = "better-lgtm.seenRequests";

function loadSeen(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function notify(title: string, body: string) {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title, body });
}

/**
 * Sends a desktop notification when a review is requested from you, or requested again, and
 * keeps the app's dock or taskbar badge at the number of PRs waiting. `requests` should already
 * leave out hidden organizations.
 */
export function useReviewNotifications(requests: ReviewRequest[] | null, enabled: boolean) {
  const seen = useRef<Record<string, string> | null>(loadSeen());

  useEffect(() => {
    if (!requests) return;
    const now: Record<string, string> = {};
    for (const pr of requests) now[prKey(pr)] = pr.requestedAt ?? pr.createdAt ?? pr.updatedAt;
    const before = seen.current;
    seen.current = now;
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(now));
    } catch {
      // Notifications still work for this session.
    }
    // The first time ever, everything is new; don't announce the whole inbox.
    if (!before || !enabled || !inTauri) return;
    const fresh = requests.filter((pr) => {
      const was = before[prKey(pr)];
      return !was || new Date(now[prKey(pr)]).getTime() > new Date(was).getTime();
    });
    if (fresh.length === 1) {
      const pr = fresh[0];
      const again = !!before[prKey(pr)];
      notify(again ? "Review requested again" : "Review requested", `${pr.author.login} · ${pr.repository.nameWithOwner}#${pr.number}\n${pr.title}`).catch(() => {});
    } else if (fresh.length > 1) {
      notify(`${fresh.length} new review requests`, fresh.map((pr) => `${pr.repository.name}#${pr.number} ${pr.title}`).slice(0, 4).join("\n")).catch(() => {});
    }
  }, [requests, enabled]);

  useEffect(() => {
    if (!inTauri) return;
    const count = enabled && requests?.length ? requests.length : undefined;
    getCurrentWindow().setBadgeCount(count).catch(() => {});
  }, [requests, enabled]);
}
