import { en as t } from "@/i18n/en";
import { useNav } from "@/state/nav";
import { player, usePlayer } from "@/state/player";
import { useUi } from "@/state/ui";
import { openLink } from "./links";
import { call } from "./sky";

/**
 * Shortcuts inside the window: Space plays / pauses, ← / → jump 5 s, Ctrl+F goes to search, Ctrl+L opens the
 * SoundCloud link on the clipboard. Typing in a field, a slider or the shortcut recorder keeps its keys.
 */
const typing = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable || el.getAttribute("role") === "slider" || !!el.closest("[data-keys-own]"));

function focusSearch() {
  useNav.getState().open("search", { name: "search" });
  // the screen mounts on the next frames
  let tries = 0;
  const focus = () => {
    const box = document.querySelector<HTMLInputElement>('input[type="search"]');
    if (box) {
      box.focus();
      box.select();
    } else if (++tries < 10) requestAnimationFrame(focus);
  };
  requestAnimationFrame(focus);
}

async function openClipboardLink() {
  const text = (await call("clipboard:read").catch(() => "")).trim();
  if (!/^(https?:\/\/)?(www\.|m\.|on\.)?soundcloud\.(com|app\.goo\.gl)\//i.test(text)) {
    useUi.getState().showToast(t.noClipboardLink);
    return;
  }
  try {
    await openLink(text);
  } catch {
    useUi.getState().showToast(t.linkDidntOpen);
  }
}

export function initKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.metaKey) return;
    const ctrl = e.ctrlKey;
    if (ctrl && !e.shiftKey && (e.code === "KeyF" || e.code === "KeyL")) {
      e.preventDefault();
      if (e.code === "KeyF") focusSearch();
      else void openClipboardLink();
      return;
    }
    if (ctrl || e.shiftKey || typing(document.activeElement)) return;
    const hasTrack = usePlayer.getState().index >= 0;
    if (e.code === "Space") {
      // also on a focused button: Space would press it as well as toggle
      e.preventDefault();
      if (!e.repeat && hasTrack) player.toggle();
    } else if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && hasTrack) {
      e.preventDefault();
      player.seekBy(e.code === "ArrowLeft" ? -5 : 5);
    }
  });
}
