import { getVersion } from "@tauri-apps/api/app";
import { isSampleMode } from "./api";
import { inTauri } from "./mock";
import { os } from "./platform";

/**
 * Anonymous usage counts, sent to PostHog. Only the event name and the small, fixed set of
 * properties each call passes: never repository or organization names, PR titles or numbers,
 * code, findings, chat text, GitHub logins or file paths. Events carry a random ID made on this
 * computer, so one install's events can be counted together; it isn't tied to any account.
 *
 * Nothing is sent when Settings › General › Share anonymous usage stats is off, in sample mode,
 * in development, or in builds made without VITE_POSTHOG_KEY (anyone building from source).
 */

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = ((import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://eu.i.posthog.com").replace(/\/$/, "");
let version: Promise<string> | undefined;
const ID_KEY = "better-lgtm.installId";

/** The property values an event may carry: categories, counts and switches, never free text from a PR. */
type Props = Record<string, string | number | boolean | undefined>;

export type UsageEvent =
  | "app_opened"
  | "onboarding_finished"
  | "sample_opened"
  | "analysis_finished"
  | "analysis_failed"
  | "walkthrough_ready"
  | "findings_rechecked"
  | "review_submitted"
  | "chat_sent"
  | "description_drafted"
  | "reply_drafted"
  | "update_installed";

function enabled(): boolean {
  if (!KEY || !inTauri || import.meta.env.DEV || isSampleMode()) return false;
  try {
    const s = JSON.parse(localStorage.getItem("better-lgtm.settings") ?? "null");
    return s?.usageStats !== false;
  } catch {
    return true;
  }
}

function installId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

/** Sends one event, best effort: failures are ignored and never reach the UI. */
export function track(event: UsageEvent, props: Props = {}) {
  if (!enabled()) return;
  const timestamp = new Date().toISOString();
  version ??= getVersion().catch(() => "unknown");
  version.then((app_version) => send(event, props, timestamp, app_version));
}

function send(event: UsageEvent, props: Props, timestamp: string, app_version: string) {
  const body = {
    api_key: KEY,
    event,
    distinct_id: installId(),
    timestamp,
    properties: {
      ...props,
      app_version,
      os,
      // No person profiles, no IP-based location.
      $process_person_profile: false,
      $ip: null,
      $geoip_disable: true,
    },
  };
  fetch(`${HOST}/i/v0/e/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
}

/** Buckets a count so events say "about how many", not an exact figure. */
export function bucket(n: number): string {
  if (n <= 0) return "0";
  if (n <= 2) return String(n);
  if (n <= 5) return "3-5";
  if (n <= 10) return "6-10";
  if (n <= 25) return "11-25";
  return "26+";
}

/** Buckets a duration in milliseconds into minutes. */
export function minutes(ms: number): string {
  const m = ms / 60000;
  if (m < 1) return "<1";
  if (m < 3) return "1-3";
  if (m < 10) return "3-10";
  return "10+";
}
