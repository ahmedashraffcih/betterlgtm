import { getCurrentWindow } from "@tauri-apps/api/window";
import { GitPullRequestArrow, Menu, Minus, PanelBottom, PanelLeft, Search, Settings2, Square, X } from "lucide-react";

interface Props {
  title: string;
  inboxOpen: boolean;
  chatOpen: boolean;
  onToggleInbox: () => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
}

const MENUS = ["File", "Edit", "View", "Review", "Go", "Help"];

export function TitleBar({ title, inboxOpen, chatOpen, onToggleInbox, onToggleChat, onOpenSettings }: Props) {
  const win = () => getCurrentWindow();
  return (
    <header className="titlebar" data-tauri-drag-region aria-label="Title bar">
      <GitPullRequestArrow size={16} className="logo" aria-label="better-lgtm" />
      {MENUS.map((m) => (
        <button key={m} type="button" className="menu">{m}</button>
      ))}
      <button type="button" className="tb menu-btn" aria-label="Menu" title="Menu"><Menu size={16} /></button>
      <div data-tauri-drag-region style={{ flex: 1, display: "flex", justifyContent: "center", padding: "0 16px" }}>
        <button type="button" className="cmdk">
          <Search size={14} />
          <span className="ellipsis" style={{ flex: 1 }}>{title}</span>
          <span className="mono kbd-hint" style={{ fontSize: 11 }}>Ctrl K</span>
        </button>
      </div>
      <button type="button" className={inboxOpen ? "tb on" : "tb"} aria-label="Toggle inbox panel" aria-pressed={inboxOpen} onClick={onToggleInbox}>
        <PanelLeft size={16} />
      </button>
      <button type="button" className={chatOpen ? "tb on" : "tb"} aria-label="Toggle Claude panel" aria-pressed={chatOpen} onClick={onToggleChat}>
        <PanelBottom size={16} />
      </button>
      <button type="button" className="tb" aria-label="Settings (Ctrl+,)" title="Settings (Ctrl+,)" onClick={onOpenSettings}>
        <Settings2 size={16} />
      </button>
      <span style={{ width: 12 }} />
      <button type="button" className="wc" aria-label="Minimize" onClick={() => win().minimize()}><Minus size={14} /></button>
      <button type="button" className="wc" aria-label="Maximize" onClick={() => win().toggleMaximize()}><Square size={12} /></button>
      <button type="button" className="wc close" aria-label="Close" onClick={() => win().close()}><X size={14} /></button>
    </header>
  );
}
