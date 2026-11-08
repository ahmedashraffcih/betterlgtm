import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, PanelBottom, PanelLeft, Search, Settings2, Square, X } from "lucide-react";
import type { Command } from "../commands";
import { Logo } from "./Logo";
import { MenuBar } from "./MenuBar";
import { flushSessions } from "../sessions";

interface Props {
  title: string;
  commands: Command[];
  inboxOpen: boolean;
  chatOpen: boolean;
  onToggleInbox: () => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
}

export function TitleBar({ title, commands, inboxOpen, chatOpen, onToggleInbox, onToggleChat, onOpenSettings, onOpenPalette }: Props) {
  const win = () => getCurrentWindow();
  return (
    <header className="titlebar" data-tauri-drag-region aria-label="Title bar">
      <Logo />
      <MenuBar commands={commands} />
      <div data-tauri-drag-region style={{ flex: 1, display: "flex", justifyContent: "center", padding: "0 16px" }}>
        <button type="button" className="cmdk" onClick={onOpenPalette} title="Go to… (Ctrl+K)">
          <Search size={14} />
          <span className="ellipsis" style={{ flex: 1 }}>{title}</span>
          <span className="mono kbd-hint" style={{ fontSize: 11 }}>Ctrl K</span>
        </button>
      </div>
      <button type="button" className={inboxOpen ? "tb on" : "tb"} aria-label="Toggle inbox panel (Ctrl+B)" title="Inbox panel (Ctrl+B)" aria-pressed={inboxOpen} onClick={onToggleInbox}>
        <PanelLeft size={16} />
      </button>
      <button type="button" className={chatOpen ? "tb on" : "tb"} aria-label="Toggle Claude panel (Ctrl+J)" title="Claude panel (Ctrl+J)" aria-pressed={chatOpen} onClick={onToggleChat}>
        <PanelBottom size={16} />
      </button>
      <button type="button" className="tb" aria-label="Settings (Ctrl+,)" title="Settings (Ctrl+,)" onClick={onOpenSettings}>
        <Settings2 size={16} />
      </button>
      <span style={{ width: 12 }} />
      <button type="button" className="wc" aria-label="Minimize" onClick={() => win().minimize()}><Minus size={14} /></button>
      <button type="button" className="wc" aria-label="Maximize" onClick={() => win().toggleMaximize()}><Square size={12} /></button>
      <button type="button" className="wc close" aria-label="Close" onClick={() => (flushSessions(), win().close())}><X size={14} /></button>
    </header>
  );
}
