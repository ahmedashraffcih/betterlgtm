import { ArrowUp, ChevronDown, FlaskConical, Loader, MessageSquare, Square, Terminal, TriangleExclamationPoint } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatItem } from "../sessions";
import { Markdown } from "./Markdown";

interface Props {
  chat: ChatItem[];
  running: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string) => void;
  onCancel: () => void;
  onHide: () => void;
}

export function ClaudePanel(p: Props) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Newer engines return a Promise from scrollIntoView; an effect must not return it.
    end.current?.scrollIntoView({ block: "end" });
  }, [p.chat]);

  const submit = () => {
    const text = p.draft.trim();
    if (text && !p.running) {
      p.onSend(text);
      p.onDraft("");
    }
  };

  return (
    <section aria-label="Claude" style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 6px 0 12px", borderBottom: "1px solid var(--line2)", flexShrink: 0 }}>
        <MessageSquare size={14} className="tone-muted" />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Claude</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="tb" aria-label="Hide panel" onClick={p.onHide}><ChevronDown size={14} /></button>
      </div>
      <div className="scroll selectable" style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {p.chat.length === 0 && <p className="muted" style={{ margin: 0 }}>Ask anything about this PR. Claude can read the worktree and run read-only git commands.</p>}
        {p.chat.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="bubble">{m.text}</div>
          ) : m.role === "tool" ? (
            <span key={i} className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
              <Terminal size={13} /><span className="mono ellipsis">{m.text}</span>
            </span>
          ) : m.role === "error" ? (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--crit)" }}><TriangleExclamationPoint size={14} />{m.text}</span>
          ) : (
            <div key={i} className="answer"><Markdown text={m.text} /></div>
          ),
        )}
        {p.running && <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Loader size={13} className="spin" />Working…</span>}
        <div ref={end} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px 10px", flexShrink: 0 }}>
        <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 4px 0 10px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--line)" }}>
          <input
            aria-label="Message Claude"
            placeholder="Ask a follow-up"
            value={p.draft}
            onChange={(e) => p.onDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none" }}
          />
          {p.running ? (
            <button type="button" className="tb" aria-label="Stop" style={{ width: 24, height: 24 }} onClick={p.onCancel}><Square size={12} /></button>
          ) : (
            <button type="button" className="tb" aria-label="Send (Enter)" style={{ width: 24, height: 24, background: "var(--accent)", color: "var(--on-accent)" }} onClick={submit}>
              <ArrowUp size={14} />
            </button>
          )}
        </label>
        <button type="button" className="btn sm" onClick={() => p.onSend("Is this change covered by tests? Point to the tests or say what's missing.")} disabled={p.running}>
          <FlaskConical size={13} />Is this tested?
        </button>
      </div>
    </section>
  );
}
