import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Links in rendered content open in the system browser, never inside the app window. */
function openLinksExternally(e: MouseEvent<HTMLElement>) {
  const a = (e.target as HTMLElement).closest("a");
  const href = a?.getAttribute("href");
  if (!a || !href) return;
  e.preventDefault();
  if (/^https?:\/\//.test(href)) openUrl(href);
}

/** Markdown written by Claude (findings, notes, chat answers). Raw HTML is not rendered. */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`md ${className}`} onClick={openLinksExternally}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") node.setAttribute("rel", "noreferrer");
});

/**
 * HTML that GitHub rendered from the PR description. GitHub already handles mentions, issue
 * links, alerts, task lists and collapsible sections; this only sanitizes and styles it.
 */
export function GithubHtml({ html, fallback }: { html?: string; fallback?: string }) {
  if (!html) {
    return fallback?.trim() ? <Markdown text={fallback} className="md-body" /> : <p className="muted">No description.</p>;
  }
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ["details", "summary"],
    ADD_ATTR: ["open", "dir"],
    FORBID_TAGS: ["style", "form", "button", "iframe"],
  });
  return <div className="md md-body" onClick={openLinksExternally} dangerouslySetInnerHTML={{ __html: clean }} />;
}
