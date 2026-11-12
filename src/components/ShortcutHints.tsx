import { useEffect, useState, type RefObject } from "react";
import { comboLabel, isMac, type Command, type KeyCombo } from "../commands";

/** How long ⌘/Ctrl must be held alone before the hints show, so quick ⌘C or ⌘K presses don't flash them. */
const HOLD_MS = 400;
/** The key that shows the hints: ⌘ on macOS, Ctrl elsewhere (the same key `matches` treats as the command key). */
const HOLD_KEY = isMac ? "Meta" : "Control";

interface Badge {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** The first ⌘/Ctrl combo of a command, if it has one. */
function cmdCombo(c: Command): KeyCombo | undefined {
  return [c.keys, ...(c.altKeys ?? [])].find((k) => k?.ctrl);
}

/** The rest of the combo once ⌘/Ctrl is held: "K", "⇧↩" or "Shift+Enter". */
function restLabel(k: KeyCombo): string {
  return comboLabel({ ...k, ctrl: false });
}

/** Whether the element is on screen and not covered by a dialog or another pane. */
function visible(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const cx = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
  const cy = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
  if (cx !== r.left + r.width / 2 || cy !== r.top + r.height / 2) return null;
  const top = document.elementFromPoint(cx, cy);
  return top && (top === el || el.contains(top)) ? r : null;
}

/**
 * Hold ⌘ (macOS) or Ctrl (Windows, Linux) and every on-screen control that has a shortcut shows the
 * key that runs it; press that key while still holding to run it. Controls opt in with
 * `data-cmd="<command id>"`, so the label always comes from the same command list as the menus.
 * Shortcuts with no control on screen are listed in a small card at the bottom.
 */
export function ShortcutHints({ commandsRef }: { commandsRef: RefObject<Command[]> }) {
  const [shown, setShown] = useState<{ badges: Badge[]; others: Command[] } | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const hide = () => {
      clearTimeout(timer);
      timer = undefined;
      setShown(null);
    };
    const show = () => {
      const commands = commandsRef.current ?? [];
      const byId = new Map(commands.map((c) => [c.id, c]));
      const badges: Badge[] = [];
      const onScreen = new Set<string>();
      document.querySelectorAll<HTMLElement>("[data-cmd]").forEach((el) => {
        const c = byId.get(el.dataset.cmd ?? "");
        const k = c && c.enabled !== false && cmdCombo(c);
        if (!c || !k || el.matches(":disabled")) return;
        const r = visible(el);
        if (!r) return;
        onScreen.add(c.id);
        // Pin the badge to the control's top-right corner, kept inside the window.
        badges.push({ id: `${c.id}-${badges.length}`, label: restLabel(k), x: Math.min(window.innerWidth - 4, r.right + 4), y: Math.max(4, r.top - 6) });
      });
      const others = commands.filter((c) => c.enabled !== false && cmdCombo(c) && !onScreen.has(c.id));
      setShown({ badges, others });
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === HOLD_KEY && !e.altKey && !e.repeat) {
        clearTimeout(timer);
        timer = window.setTimeout(show, HOLD_MS);
        return;
      }
      // Shift only adds to the combo; any other key runs (or doesn't run) a shortcut, so the hints go.
      if (e.key !== "Shift" && e.key !== HOLD_KEY) hide();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === HOLD_KEY) hide();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    window.addEventListener("mousedown", hide, true);
    window.addEventListener("wheel", hide, { capture: true, passive: true });
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
      window.removeEventListener("mousedown", hide, true);
      window.removeEventListener("wheel", hide, true);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [commandsRef]);

  if (!shown) return null;
  const held = isMac ? "⌘" : "Ctrl";
  return (
    <div className="key-hints" aria-hidden="true">
      {shown.badges.map((b) => (
        <span key={b.id} className="key-badge" style={{ left: b.x, top: b.y }}>{b.label}</span>
      ))}
      {shown.others.length > 0 && (
        <div className="key-legend">
          <span className="key-legend-title">{held} +</span>
          {shown.others.map((c) => (
            <span key={c.id} className="key-legend-item">
              <kbd>{restLabel(cmdCombo(c)!)}</kbd>
              {c.label.replace(/…$/, "")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
