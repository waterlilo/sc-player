import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";

/** KeyboardEvent.code → the key part of an Electron accelerator. */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return `num${code.slice(6)}`;
  const map: Record<string, string> = {
    Space: "Space",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    Enter: "Enter",
    Tab: "Tab",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    Delete: "Delete",
    Minus: "-",
    Equal: "=",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Backquote: "`",
    MediaPlayPause: "MediaPlayPause",
    MediaTrackNext: "MediaNextTrack",
    MediaTrackPrevious: "MediaPreviousTrack",
    MediaStop: "MediaStop",
  };
  return map[code] ?? null;
}

const pretty = (accel: string) => accel.replace(/Control/g, "Ctrl").replace(/\+/g, " + ");

/**
 * Click, then press the new shortcut. Needs at least one modifier, except for F-keys and media keys. Esc cancels,
 * Backspace clears. The global shortcuts are switched off meanwhile, so pressing the current one doesn't fire it.
 */
export default function HotkeyRecorder({ value, onChange, label, taken }: { value: string; onChange: (accel: string) => void; label: string; taken: boolean }) {
  const t = useT();
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    void call("hotkeys:suspend", true);
    return () => void call("hotkeys:suspend", false);
  }, [recording]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return setRecording(false);
    if (e.key === "Backspace") {
      setRecording(false);
      return onChange("");
    }
    const key = keyName(e.code);
    if (!key) return; // a modifier alone: wait for the key
    const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
    if (!mods.length && !/^(F\d{1,2}|Media)/.test(key)) return;
    setRecording(false);
    onChange([...mods, key].join("+"));
  };

  return (
    <div className="flex items-center gap-2">
      {taken && !recording && <span className="font-type text-xs text-blood">{t.hkTaken}</span>}
      <button
        type="button"
        aria-label={`${label}: ${value ? pretty(value) : t.hkNone}`}
        onClick={() => setRecording((r) => !r)}
        onKeyDown={onKey}
        onBlur={() => setRecording(false)}
        className={`paper-fill sketch sketch-thin min-w-44 rounded-md px-3 py-1.5 text-center font-type text-sm ${recording ? "text-glow" : value ? "text-text" : "text-muted"}`}
        style={recording ? ({ "--sketch-color": "var(--glow)" } as CSSProperties) : undefined}
      >
        {recording ? t.hkPress : value ? pretty(value) : t.hkNone}
      </button>
    </div>
  );
}
