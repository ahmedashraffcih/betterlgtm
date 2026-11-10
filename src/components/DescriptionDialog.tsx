import { Loader, Save, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText } from "../api";
import { Markdown } from "./Markdown";
import { useAgent } from "../harness";

interface Props {
  current: string;
  onDraft: () => Promise<string>;
  onSave: (body: string) => Promise<void>;
  onClose: () => void;
}

/** Claude drafts the PR description; the author edits it and saves it to GitHub. */
export function DescriptionDialog(p: Props) {
  const agent = useAgent().short;
  const [text, setText] = useState(p.current);
  const [busy, setBusy] = useState<"draft" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && p.onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [p, busy]);

  const run = async (kind: "draft" | "save") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "draft") setText(await p.onDraft());
      else {
        await p.onSave(text);
        p.onClose();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={() => !busy && p.onClose()}>
      <div className="dialog review-dialog" role="dialog" aria-label="Pull request description" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 8px 10px 16px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ flex: 1, fontWeight: 600 }}>Pull request description</span>
          <div className="seg" role="group" aria-label="View">
            <button type="button" className={preview ? "" : "on"} onClick={() => setPreview(false)}>Edit</button>
            <button type="button" className={preview ? "on" : ""} onClick={() => setPreview(true)}>Preview</button>
          </div>
          <button type="button" className="tb" aria-label="Close" onClick={p.onClose} disabled={!!busy}><X size={15} /></button>
        </div>
        <div className="review-body">
          {preview ? (
            <div className="excerpt selectable" style={{ padding: "12px 16px", minHeight: 320 }}><Markdown text={text || "_Empty_"} /></div>
          ) : (
            <textarea className="set-input mono" style={{ minHeight: 360, fontSize: 12.5 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Description" disabled={busy === "draft"} />
          )}
        </div>
        <div className="review-foot">
          <button type="button" className="btn" onClick={() => run("draft")} disabled={!!busy}>
            {busy === "draft" ? <Loader size={14} className="spin" /> : <Sparkles size={14} />}{busy === "draft" ? `${agent} is writing…` : `Write with ${agent}`}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={p.onClose} disabled={!!busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => run("save")} disabled={!!busy || text === p.current}>
            <Save size={14} />{busy === "save" ? "Saving…" : "Save to GitHub"}
          </button>
        </div>
        {error && <p className="selectable review-error">{error}</p>}
      </div>
    </div>
  );
}
