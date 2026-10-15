/** 3:07, 1:02:45 */
export function duration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "1.2.0" → "v1.2", "2.0.0" → "v2", "1.2.3" → "v1.2.3" (release names) */
export function shortVersion(semver: string) {
  const [major = "0", minor = "0", patch = "0"] = semver.split(".");
  return `v${major}${patch !== "0" ? `.${minor}.${patch}` : minor !== "0" ? `.${minor}` : ""}`;
}

export function compactNumber(n: number | null) {
  if (n === null) return "";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
