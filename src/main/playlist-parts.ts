/**
 * A list longer than a playlist holds, as parts of `max` in order: "Title (1/2)", "Title (2/2)" (the title cut so the
 * suffix fits 100 characters); one part keeps the title as it is. Duplicates are dropped first, the first one kept.
 */
export function playlistParts<T extends { id: number }>(title: string, items: T[], max: number): { title: string; items: T[] }[] {
  const seen = new Set<number>();
  const all = items.filter((i) => !seen.has(i.id) && seen.add(i.id));
  const parts = Math.max(1, Math.ceil(all.length / max));
  return Array.from({ length: parts }, (_, i) => ({
    title: parts > 1 ? `${title.slice(0, 92)} (${i + 1}/${parts})` : title,
    items: all.slice(i * max, (i + 1) * max),
  }));
}
