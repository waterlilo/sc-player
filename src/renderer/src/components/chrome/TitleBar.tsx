import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { call, on } from "@/lib/sky";
import { useNav } from "@/state/nav";
import MarkerEdge from "../deco/MarkerEdge";
import Icon, { type IconName } from "../ui/Icon";

/**
 * Minimize / maximize / close drawn with the marker. With the Window Controls Overlay the real (transparent) Windows
 * buttons sit on top of these drawings — Windows keeps their behaviour, including the Snap Layouts flyout. Without
 * the overlay the drawings are the buttons themselves.
 */
export function WindowButtons() {
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
      <WindowButtons />
      <MarkerEdge side="bottom" seed="a" />
    </header>
  );
}
