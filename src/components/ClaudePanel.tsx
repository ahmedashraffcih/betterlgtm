import { ArrowUp, ChevronDown, ChevronRight, Eraser, Flag, Loader, MessageSquare, Square, Terminal, TriangleExclamationPoint, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ChatItem } from "../sessions";
import { Markdown } from "./Markdown";
import { useAgent } from "../harness";

export interface ChatContext {
  /** Short label for the chip, e.g. "Finding 2: Keys aren't scoped". */
  label: string;
  /** Sent ahead of the question so Claude knows what "this" is. */
  prompt: string;
  suggestions: string[];
}

interface Props {
  chat: ChatItem[];
  running: boolean;
  context: ChatContext | null;
  /** Compact mode is a single input row, used while there is no conversation yet. */
  compact: boolean;
  focusSignal: number;
  onSend: (text: string, context: ChatContext | null) => void;
  onCancel: () => void;
  onClear: () => void;
  onHide: () => void;
}

type Block = { kind: "item"; item: ChatItem } | { kind: "tools"; items: ChatItem[] };

/** Consecutive tool calls are folded into one line so the answers stay readable. */
function toBlocks(chat: ChatItem[]): Block[] {
  const out: Block[] = [];
  for (const item of chat) {
    const last = out[out.length - 1];
    if (item.role === "tool" && last?.kind === "tools") last.items.push(item);
    else if (item.role === "tool") out.push({ kind: "tools", items: [item] });
    else out.push({ kind: "item", item });
  }
  return out;
}

function ToolGroup({ items }: { items: ChatItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-group">
      <button type="button" className="tool-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Terminal size={13} />
        {items.length === 1 ? items[0].text : `Looked at the code (${items.length} steps)`}
      </button>
      {open && items.length > 1 && (
        <ul className="tool-list mono">
          {items.map((t, i) => <li key={i} className="ellipsis">{t.text}</li>)}
        </ul>
      )}
    </div>
  );
}

export function ClaudePanel(p: Props) {
  const agent = useAgent().short;
  const [draft, setDraft] = useState("");
  const [useContext, setUseContext] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // A new selection brings its chip back even if the previous one was dismissed.
  useEffect(() => setUseContext(true), [p.context?.label]);
  useEffect(() => {
    if (p.focusSignal) input.current?.focus();
  }, [p.focusSignal]);
  useEffect(() => {
    // Newer engines return a Promise from scrollIntoView; an effect must not return it.
    end.current?.scrollIntoView({ block: "end" });
  }, [p.chat, p.running]);
  // Grow the input with its content, up to about five lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [draft]);

  const ctx = useContext ? p.context : null;
  const send = (text: string) => {
    const t = text.trim();
    if (!t || p.running) return;
    p.onSend(t, ctx);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  const suggestions = p.context?.suggestions ?? ["What are the riskiest changes?", "Is this change covered by tests?", "What could this break?"];

  const composer = (
    <div className="composer">
      {ctx && (
        <span className="ctx-chip" title={ctx.label}>
          <Flag size={12} />
          <span className="ellipsis">{ctx.label}</span>
          <button type="button" aria-label="Don't include this" title="Don't include this" onClick={() => setUseContext(false)}><X size={12} /></button>
        </span>
      )}
      <div className="composer-row">
        <textarea
          ref={input}
          rows={1}
          aria-label={`Message ${agent}`}
          placeholder={ctx ? "Ask about this…" : `Ask ${agent} about this PR…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        {p.running ? (
          <button type="button" className="send stop" aria-label="Stop" title="Stop" onClick={p.onCancel}><Square size={12} /></button>
        ) : (
          <button type="button" className="send" aria-label="Send (Enter)" title="Send (Enter) · new line (Shift+Enter)" disabled={!draft.trim()} onClick={() => send(draft)}>
            <ArrowUp size={15} />
          </button>
        )}
      </div>
    </div>
  );

  if (p.compact) {
    return (
      <section aria-label={agent} className="chat chat-compact">
        <div className="chat-suggest">
          <MessageSquare size={14} className="tone-muted" style={{ flexShrink: 0 }} />
          {suggestions.slice(0, 3).map((s) => (
            <button key={s} type="button" className="chip-btn" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
        {composer}
      </section>
    );
  }

  return (
    <section aria-label={agent} className="chat">
      <div className="chat-head">
        <MessageSquare size={14} className="tone-muted" />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{agent}</span>
        <span className="muted" style={{ fontSize: 12 }}>· continues the analysis session</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="tb" aria-label="Clear conversation" title="Clear conversation" onClick={p.onClear} disabled={p.running}><Eraser size={14} /></button>
        <button type="button" className="tb" aria-label="Hide panel" title="Hide panel" onClick={p.onHide}><ChevronDown size={14} /></button>
      </div>
      <div className="scroll selectable chat-log">
        {toBlocks(p.chat).map((b, i) =>
          b.kind === "tools" ? (
            <ToolGroup key={i} items={b.items} />
          ) : b.item.role === "user" ? (
            <div key={i} className="msg-user">
              {b.item.context && <span className="msg-ctx"><Flag size={11} />{b.item.context}</span>}
              <div className="bubble">{b.item.text}</div>
            </div>
          ) : b.item.role === "error" ? (
            <div key={i} className="msg-error"><TriangleExclamationPoint size={14} />{b.item.text}</div>
          ) : (
            <div key={i} className="answer"><Markdown text={b.item.text} /></div>
          ),
        )}
        {p.running && <div className="muted thinking"><Loader size={13} className="spin" />{agent} is working…</div>}
        {!p.running && (
          <div className="chat-suggest" style={{ paddingTop: 2 }}>
            {suggestions.map((s) => (
              <button key={s} type="button" className="chip-btn" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>
      {composer}
    </section>
  );
}
