import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitPullRequestArrow, X } from "lucide-react";
import { useEffect, useState } from "react";
import { shortcutLabel, type Command } from "../commands";

/** Keys handled outside the command list. */
const OTHER_KEYS: [string, string][] = [
  ["J / K", "Next / previous finding"],
  ["Enter", "Send a chat message"],
  ["Shift+Enter", "New line in a chat message"],
  ["Esc", "Close menus, dialogs and Settings"],
];

export function InfoDialog({ kind, commands, onClose }: { kind: "shortcuts" | "about"; commands: Command[]; onClose: () => void }) {
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
      <div className="dialog" role="dialog" aria-label={kind === "about" ? "About better-lgtm" : "Keyboard shortcuts"} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 8px 10px 16px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ flex: 1, fontWeight: 600 }}>{kind === "about" ? "About" : "Keyboard shortcuts"}</span>
          <button type="button" className="tb" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
        {kind === "shortcuts" ? (
          <div style={{ padding: "8px 16px 14px", maxHeight: 420, overflowY: "auto" }}>
            {[...keyed.map((c) => [shortcutLabel(c) ?? "", c.label] as [string, string]), ...OTHER_KEYS].map(([k, label]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, height: 30, borderBottom: "1px solid var(--line2)" }}>
                <span style={{ flex: 1 }}>{label}</span>
                <span className="menu-key" style={{ fontSize: 12 }}>{k}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <GitPullRequestArrow size={32} className="tone-accent" />
            <span style={{ fontSize: 15, fontWeight: 600 }}>better-lgtm</span>
            <span className="muted">Version {version}</span>
            <span className="muted" style={{ maxWidth: 320 }}>Reviews GitHub pull requests with the GitHub CLI and Claude Code, in a worktree per PR.</span>
            <button type="button" className="btn sm" onClick={() => openUrl("https://cli.github.com/manual/")}>GitHub CLI manual</button>
          </div>
        )}
      </div>
    </div>
  );
}
