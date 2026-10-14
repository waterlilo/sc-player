import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { call, on } from "@/lib/sky";
import { toggleTheme, useTheme } from "@/lib/theme";
import { useNav } from "@/state/nav";
import Icon, { type IconName } from "../ui/Icon";

/** Small scribbled moon/sun switch (site: ThemeToggle); both icons stay rendered and crossfade with the theme. */
function ThemeToggle() {
  const t = useT();
  const { theme } = useTheme();
  const label = theme === "night" ? t.switchToDay : t.switchToNight;
  return (
    <button type="button" onClick={() => void toggleTheme()} aria-label={label} title={label} className="no-drag sketch sketch-thin paper-fill grid h-7 w-7 shrink-0 rotate-3 place-items-center rounded-md text-glow transition-transform hover:rotate-0">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" style={{ filter: "drop-shadow(0 0 4px var(--glow))" }}>
        <path className="theme-ico theme-ico-night" d="M15 3 C 8 3, 4 8, 4 13 C 4 18, 9 22, 15 21 C 11 19, 9 16, 9 12 C 9 8, 11 5, 15 3 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <g className="theme-ico theme-ico-day" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <path d="M12 1.5 L 12.4 4.5 M12 19.5 L 11.6 22.5 M1.5 12 L 4.5 11.6 M19.5 12.4 L 22.5 12 M4.3 4.5 L 6.4 6.6 M17.6 17.4 L 19.7 19.5 M4.5 19.7 L 6.6 17.6 M17.4 6.4 L 19.5 4.3" />
        </g>
      </svg>
    </button>
  );
}

/**
 * Minimize / maximize / close drawn with the marker. With the Window Controls Overlay the real (transparent) Windows
 * buttons sit on top of these drawings — Windows keeps their behaviour, including the Snap Layouts flyout. Without
 * the overlay the drawings are the buttons themselves.
 */
function WindowButtons() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  const overlay = !!(navigator as Navigator & { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay?.visible;
  useEffect(() => on("win:maximized", setMaximized), []);

  const buttons: { icon: IconName; label: string; action: () => void; danger?: boolean }[] = [
    { icon: "minimize", label: t.minimize, action: () => void call("win:minimize") },
    { icon: maximized ? "restore" : "maximize", label: maximized ? t.restore : t.maximize, action: () => void call("win:toggleMaximize") },
    { icon: "close", label: t.close, action: () => void call("win:close"), danger: true },
  ];

  if (overlay) {
    return (
      <div aria-hidden="true" className="pointer-events-none flex h-full shrink-0" style={{ width: "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))" }}>
        {buttons.map((b) => (
          <div key={b.icon} className="grid flex-1 place-items-center text-muted">
            <Icon name={b.icon} size={16} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="no-drag flex h-full shrink-0">
      {buttons.map((b) => (
        <button key={b.icon} type="button" aria-label={b.label} title={b.label} onClick={b.action} className={`grid h-full w-12 place-items-center text-muted hover:text-text ${b.danger ? "hover:bg-[var(--blood)] hover:text-white" : "hover:bg-[var(--row-hover)]"}`}>
          <Icon name={b.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

/** Own title bar: drag anywhere on it, double-click maximizes (Windows handles both). */
export default function TitleBar() {
  const t = useT();
  const canGoBack = useNav((s) => s.stack.length > 0);
  const back = useNav((s) => s.back);
  return (
    <header className="panel drag relative z-30 flex h-10 items-center gap-2 pl-2">
      <button type="button" onClick={back} disabled={!canGoBack} aria-label={t.back} title={t.back} className="no-drag grid h-8 w-8 place-items-center rounded-full text-muted enabled:hover:text-text disabled:opacity-30">
        <Icon name="back" size={18} />
      </button>
      <div className="display-heading pointer-events-none -rotate-2 pl-1 text-[1.6rem] leading-none text-text">{t.appName}</div>
      <div className="flex-1" />
      <ThemeToggle />
      <div className="w-1" />
      <WindowButtons />
    </header>
  );
}
