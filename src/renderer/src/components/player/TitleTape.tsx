import { useLayoutEffect, useRef, useState } from "react";
import { getActivity, subscribeActivity } from "@/lib/activity";

const SPEED = 38; // px per second

/**
 * A track title. When it doesn't fit, it becomes a thin torn tape with the words running (site: TapeMarquee): a Web
 * Animation on transform, played by the compositor; it runs only while the window is active, at full quality and
 * without reduced motion.
 */
export default function TitleTape({ text, className = "" }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure) return;
    const check = () => setOverflow(measure.scrollWidth > box.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(box);
    return () => ro.disconnect();
  }, [text]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const copy = copyRef.current;
    if (!overflow || !row || !copy) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const w = copy.offsetWidth;
    const anim = row.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-w}px)` }], { duration: (w / SPEED) * 1000, iterations: Infinity, easing: "linear" });
    const sync = () => {
      const run = getActivity() === "active" && !document.documentElement.dataset.quality;
      if (run && anim.playState !== "running") anim.play();
      else if (!run && anim.playState === "running") anim.pause();
    };
    sync();
    const off = subscribeActivity(sync);
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-quality"] });
    return () => {
      off();
      mo.disconnect();
      anim.cancel();
    };
  }, [overflow, text]);

  return (
    <div ref={boxRef} className={`relative min-w-0 ${className}`} title={text}>
      {/* always laid out (invisible when the tape shows), for measuring and for screen readers */}
      <span ref={measureRef} className={`block truncate whitespace-nowrap font-medium text-text ${overflow ? "invisible" : ""}`}>
        {text}
      </span>
      {overflow && (
        <div aria-hidden="true" className="absolute inset-x-0 -top-0.5 -rotate-1">
          <div className="tape-strip tape-acid absolute inset-0" />
          <div className="relative overflow-hidden py-0.5">
            <div ref={rowRef} className="tape-acid-fg flex w-max text-sm font-semibold will-change-transform">
              <div ref={copyRef} className="flex shrink-0 items-center whitespace-nowrap px-3">
                {text} <span className="px-3 text-[0.8em]">✦</span>
              </div>
              <div className="flex shrink-0 items-center whitespace-nowrap px-3">
                {text} <span className="px-3 text-[0.8em]">✦</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
