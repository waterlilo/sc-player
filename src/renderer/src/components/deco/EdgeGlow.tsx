import { useEffect, useRef } from "react";
import { listen } from "@/lib/reactive";
import { useSettings } from "@/state/settings";

/**
 * A soft glow along the edges of the content area that swells with the loud parts of a song ("Sound-reactive sky"), in the
 * cover's colour when the sky takes it, otherwise the theme's yellow. Painted once; only its opacity follows the
 * music. Clicks pass through.
 */
export default function EdgeGlow() {
  const on = useSettings((s) => s.prefs.reactiveSky);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => (on ? listen(el.current) : undefined), [on]);
  if (!on) return null;
  return <div ref={el} aria-hidden="true" className="edge-glow pointer-events-none absolute inset-0 z-30" />;
}
