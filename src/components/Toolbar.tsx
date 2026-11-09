import { PanelBottom, PanelLeft, Search, Settings2 } from "lucide-react";
import { comboLabel } from "../commands";
import { Logo } from "./Logo";

interface Props {
  title: string;
  inboxOpen: boolean;
  chatOpen: boolean;
  onToggleInbox: () => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
}

/**
 * The toolbar. On macOS it is the title bar too (the traffic lights sit at its left); elsewhere it
 * sits under the system title bar. Menus live in the native menu bar (see nativeMenu.ts).
 */
export function Toolbar({ title, inboxOpen, chatOpen, onToggleInbox, onToggleChat, onOpenSettings, onOpenPalette }: Props) {
  const k = (key: string) => comboLabel({ key, ctrl: true });
  return (
    <header className="toolbar" data-tauri-drag-region aria-label="Toolbar">
      <Logo />
      <div data-tauri-drag-region style={{ flex: 1, display: "flex", justifyContent: "center", padding: "0 16px", minWidth: 0 }}>
        <button type="button" className="cmdk" onClick={onOpenPalette} title={`Go to… (${k("k")})`}>
          <Search size={14} />
          <span className="ellipsis" style={{ flex: 1 }}>{title}</span>
          <span className="kbd-hint" style={{ fontSize: 11 }}>{k("k")}</span>
        </button>
      </div>
      <button type="button" className={inboxOpen ? "tb on" : "tb"} aria-label={`Toggle inbox panel (${k("b")})`} title={`Inbox panel (${k("b")})`} aria-pressed={inboxOpen} onClick={onToggleInbox}>
        <PanelLeft size={16} />
      </button>
      <button type="button" className={chatOpen ? "tb on" : "tb"} aria-label={`Toggle Claude panel (${k("j")})`} title={`Claude panel (${k("j")})`} aria-pressed={chatOpen} onClick={onToggleChat}>
        <PanelBottom size={16} />
      </button>
      <button type="button" className="tb" aria-label={`Settings (${k(",")})`} title={`Settings (${k(",")})`} onClick={onOpenSettings}>
        <Settings2 size={16} />
      </button>
    </header>
  );
}
