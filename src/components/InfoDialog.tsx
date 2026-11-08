import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { shortcutLabel, type Command } from "../commands";
import { Logo } from "./Logo";

/** Keys handled outside the command list. */
const OTHER_KEYS: [string, string][] = [
  ["Enter", "Send a chat message"],
  ["Shift+Enter", "New line in a chat message"],
  ["Esc", "Leave a text field; close menus, dialogs and Settings"],
];

/** Single keys, used when no text field has focus (Settings › General › Vim-style keys). */
const VIM_KEYS: [string, string][] = [
  ["h / l", "Previous / next pane: inbox, list, content"],
  ["j / k", "Next / previous item, or scroll the content"],
  ["gg / G", "First / last item, or top / bottom"],
  ["Enter", "Go into the next pane"],
  ["Ctrl+D / Ctrl+U", "Scroll the content half a page"],
  ["n / N", "Next / previous finding"],
  ["] / [", "Next / previous file or section"],
  ["1 / 2", "Analysis / Diff"],
  ["x", "Mark the current file or section reviewed"],
  ["a", "Add the current finding to the review"],
  ["S", "Submit review"],
  ["i", "Ask Claude"],
  ["/", "Filter the inbox, or go to anything"],
  ["r", "Refresh pull requests"],
  ["O", "Open on GitHub"],
  ["?", "This list"],
];

export function InfoDialog({ kind, commands, vim, onClose }: { kind: "shortcuts" | "about"; commands: Command[]; vim?: boolean; onClose: () => void }) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (kind === "about") getVersion().then(setVersion).catch(() => setVersion("dev"));
  }, [kind]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const keyed = commands.filter((c) => c.keys);
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label={kind === "about" ? "About BetterLGTM" : "Keyboard shortcuts"} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 8px 10px 16px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ flex: 1, fontWeight: 600 }}>{kind === "about" ? "About" : "Keyboard shortcuts"}</span>
          <button type="button" className="tb" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
        {kind === "shortcuts" ? (
          <div style={{ padding: "8px 16px 14px", maxHeight: 420, overflowY: "auto" }}>
            {[
              ...(vim ? [["Vim-style keys", VIM_KEYS] as const] : []),
              ["Other shortcuts", [...keyed.map((c) => [shortcutLabel(c) ?? "", c.label] as [string, string]), ...OTHER_KEYS]] as const,
            ].map(([title, keys]) => (
              <div key={title}>
                <div className="menu-head" style={{ padding: "10px 0 4px" }}>{title}</div>
                {keys.map(([k, label]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, height: 30, borderBottom: "1px solid var(--line2)" }}>
                    <span style={{ flex: 1 }}>{label}</span>
                    <span className="menu-key" style={{ fontSize: 12 }}>{k}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <Logo size={44} />
            <span style={{ fontSize: 15, fontWeight: 600 }}>BetterLGTM</span>
            <span className="muted">Version {version}</span>
            <span className="muted" style={{ maxWidth: 320 }}>Reviews GitHub pull requests with the GitHub CLI and Claude Code, in a worktree per PR.</span>
            <button type="button" className="btn sm" onClick={() => openUrl("https://cli.github.com/manual/")}>GitHub CLI manual</button>
          </div>
        )}
      </div>
    </div>
  );
}
