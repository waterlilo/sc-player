import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { answer, useDialog } from "@/state/dialog";

/** The app's own confirm / prompt (state/dialog): a small glass card over a dimmed window. Esc or a click outside cancels. */
export default function Dialog() {
  const t = useT();
  const pending = useDialog((s) => s.pending);
  const [text, setText] = useState("");
  // a new question: an empty field
  const [shown, setShown] = useState(pending);
  if (shown !== pending) {
    setShown(pending);
    setText("");
  }

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && answer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    answer(pending.input ? text.trim() : "yes");
  };

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          onPointerDown={(e) => e.target === e.currentTarget && answer(null)}
        >
          <motion.form
            role="alertdialog"
            aria-label={pending.message}
            onSubmit={submit}
            initial={{ y: 6, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            className="s-pop w-[26rem] max-w-[92vw] rounded-[var(--r,10px)] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.5)]"
          >
            <p className="text-[14px] leading-relaxed text-text">{pending.message}</p>
            {pending.input && (
              <label className="field sketch sketch-thin paper-fill mt-3 flex rounded-md">
                <input
                  autoFocus
                  value={text}
                  maxLength={pending.input.maxLength}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={pending.input.placeholder}
                  aria-label={pending.input.placeholder}
                  className="min-w-0 flex-1 px-3 py-2 text-sm text-text placeholder:text-muted/70"
                />
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => answer(null)} className="s-btn">
                {t.cancel}
              </button>
              <button
                type="submit"
                autoFocus={!pending.input}
                disabled={!!pending.input && !text.trim()}
                className={`s-btn ${pending.danger ? "danger" : "pri"} disabled:opacity-50`}
              >
                {pending.confirm}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
