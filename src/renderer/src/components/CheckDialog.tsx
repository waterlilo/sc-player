import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { closeCheck, useCheck } from "@/state/check";
import { useUi } from "@/state/ui";
import { MarkerButton, PaperButton } from "./ui/Buttons";

/**
 * SoundCloud's bot protection stopped an action. Two ways on: do it on soundcloud.com in a window of the app (the
 * site runs its own check, a captcha if it wants one; after that the app's actions usually go through again for a
 * while), or in the browser. After the window closes the action is tried again.
 */
export default function CheckDialog() {
  const t = useT();
  const pending = useCheck((s) => s.pending);
  const toast = useUi((s) => s.showToast);
  const [state, setState] = useState<"ask" | "waiting" | "failed">("ask");

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && state !== "waiting" && closeCheck();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, state]);

  const close = () => {
    closeCheck();
    setState("ask");
  };

  const inApp = async () => {
    if (!pending) return;
    setState("waiting");
    try {
      await call("auth:check", pending.url);
      if (await pending.retry()) {
        toast(t.checkDone);
        close();
      } else setState("failed");
    } catch {
      setState("failed");
    }
  };

  const inBrowser = () => {
    if (pending) void call("shell:open", pending.url);
    close();
  };

  return (
    <AnimatePresence>
      {pending && (
        <motion.div className="fixed inset-0 z-[75] grid place-items-center bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
          <div role="dialog" aria-label={t.checkTitle} className="float-card paper-fill sketch sketch-thin w-[36rem] max-w-[92vw] rounded-md p-5 shadow-[4px_6px_0_rgba(0,0,0,0.5)]">
            <h2 className="display-heading -rotate-1 text-2xl text-text">{t.checkTitle.toLowerCase()}</h2>
            <p className="mt-3 text-sm leading-relaxed text-text/90">{pending.passOnly ? t.checkPassText(pending.action) : t.checkText(pending.action)}</p>
            {state === "waiting" && <p className="mt-3 font-type text-sm text-glow">{t.checkWaiting}</p>}
            {state === "failed" && <p className="mt-3 text-sm text-muted">{t.checkFailed}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <PaperButton onClick={close} disabled={state === "waiting"}>
                {t.cancel}
              </PaperButton>
              {/* a check passed in the browser doesn't count for the app's own requests */}
              {!pending.passOnly && <PaperButton onClick={inBrowser}>{t.checkBrowser}</PaperButton>}
              {state !== "failed" && (
                <MarkerButton onClick={() => void inApp()} disabled={state === "waiting"}>
                  {t.checkInApp}
                </MarkerButton>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
