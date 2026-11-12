import { openUrl } from "@tauri-apps/plugin-opener";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { loadNotes } from "../whatsNew";
import { Markdown } from "./Markdown";

/** The release notes of the version that just opened, shown once after an update and from Help › What's new. */
export function WhatsNew({ version, onClose }: { version: string; onClose: () => void }) {
  const [notes, setNotes] = useState<{ lead: string; body: string } | null | undefined>(undefined);
  useEffect(() => {
    loadNotes(version).then(setNotes).catch(() => setNotes(null));
  }, [version]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="dialog whats-new" role="dialog" aria-label={`What's new in ${version}`} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 8px 10px 16px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ flex: 1, fontWeight: 600 }}>What's new in {version}</span>
          <button type="button" className="tb" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="whats-new-body">
          {notes === undefined ? null : notes ? (
            <>
              {notes.lead && <p className="whats-new-lead">{notes.lead}</p>}
              {notes.body && <Markdown text={notes.body} />}
            </>
          ) : (
            <p className="muted">The notes for this version couldn't be loaded.</p>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
          <button type="button" className="btn" onClick={() => openUrl(`https://github.com/drmas/betterlgtm/releases/tag/v${version}`)}>Release on GitHub</button>
          <button type="button" className="btn primary" onClick={onClose} autoFocus>Got it</button>
        </div>
      </div>
    </div>
  );
}
