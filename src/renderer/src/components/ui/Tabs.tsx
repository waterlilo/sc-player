import { useSettings } from "@/state/settings";
import Chip from "./Chip";

/**
 * Tabs and filters over a page: in studio the flat segmented switch of its Home and queue, in og the torn-paper
 * chips. One of `options` is `value`.
 */
export default function Tabs<T extends string>({ options, value, onChange, label, className = "" }: { options: [T, string][]; value: T; onChange: (v: T) => void; label?: string; className?: string }) {
  const studio = useSettings((s) => s.prefs.look.design === "studio");
  if (studio)
    return (
      <div role="tablist" aria-label={label} className={`s-seg w-fit ${className}`}>
        {options.map(([key, text]) => (
          <button key={key} type="button" role="tab" aria-selected={value === key} className={value === key ? "on" : ""} onClick={() => onChange(key)}>
            {text}
          </button>
        ))}
      </div>
    );
  return (
    <div role="tablist" aria-label={label} className={`flex flex-wrap gap-2 ${className}`}>
      {options.map(([key, text], i) => (
        <Chip key={key} index={i} active={value === key} onClick={() => onChange(key)}>
          {text}
        </Chip>
      ))}
    </div>
  );
}
