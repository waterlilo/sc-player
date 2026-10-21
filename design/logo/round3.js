// Round 3 of the logo sheet (logos3.html loads this): motifs of the "angel" look — halo, wings, clouds, deep blue
// sky, soft light — kept minimal. Original marks; nothing traced from any artwork.
const TILE = "M50 2 C 86 2, 98 14, 98 50 C 98 86, 86 98, 50 98 C 14 98, 2 86, 2 50 C 2 14, 14 2, 50 2 Z";
const sky = () => `<path d="${TILE}" fill="url(#gSky)"/>`;
// a soft cloud bank along the bottom (puffs of blurred white), cut to the tile
const clouds = (y = 82, op = 0.85) =>
  `<g clip-path="url(#cl)" filter="url(#haze)" opacity="${op}">${[[8, 0, 16], [26, -4, 18], [46, 1, 17], [64, -3, 19], [84, 0, 16], [100, -2, 14]]
    .map(([x, dy, r]) => `<circle cx="${x}" cy="${y + dy + 10}" r="${r}" fill="#f4f8ff"/>`)
    .join("")}</g>`;
// light rays from the top left
const rays = () => `<g opacity=".16" clip-path="url(#cl)"><path d="M8 -4 L 30 -4 L 70 104 L 52 104 Z" fill="#fff"/><path d="M34 -4 L 42 -4 L 88 104 L 80 104 Z" fill="#fff"/></g>`;
// a halo: a thin glowing ellipse
const halo = (cx, cy, rx, ry, w = 2.4) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#fff" stroke-width="${w * 2.4}" opacity=".35" filter="url(#soft)"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#fff" stroke-width="${w}"/>`;
// a wing of feather lines fanning out (a spectrum read as feathers); side -1 left, 1 right
function wing(cx, cy, side, n = 9, spread = 1) {
  let g = "";
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = ((-70 + t * 95) * Math.PI) / 180;
    const len = (22 - Math.abs(t - 0.35) * 18) * spread;
    const x1 = cx + side * 3, y1 = cy + t * 6;
    const x2 = x1 + side * Math.cos(a) * len, y2 = y1 + Math.sin(a) * len;
    g += `<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} Q ${((x1 + x2) / 2 + side * 2).toFixed(2)} ${((y1 + y2) / 2 - 3).toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="url(#gPearl)" stroke-width="2.2" stroke-linecap="round" opacity="${(0.55 + 0.45 * (1 - t)).toFixed(2)}"/>`;
  }
  return g;
}
const defs = `<defs><clipPath id="cl"><path d="${TILE}"/></clipPath></defs>`;

// R1 — Halo disc: the record from A2 under a floating halo, in the sky
const r1 = () =>
  `<svg viewBox="0 0 100 100">${defs}${sky()}${clouds(84, 0.7)}${rays()}<circle cx="50" cy="58" r="20" fill="url(#gGlow)" opacity=".7"/><circle cx="50" cy="58" r="15" fill="url(#gPearl)"/><circle cx="50" cy="58" r="9.5" fill="none" stroke="#9fc4ff" stroke-width=".8" opacity=".7"/><circle cx="50" cy="58" r="2.6" fill="#1f3f9e"/>${halo(50, 30, 15, 4.6)}</svg>`;
// R2 — Winged sound: three bars of a waveform with wings of feather lines and a small halo
const r2 = () =>
  `<svg viewBox="0 0 100 100">${defs}${sky()}${clouds(86, 0.55)}${wing(42, 46, -1)}${wing(58, 46, 1)}<rect x="44.2" y="40" width="3.4" height="22" rx="1.7" fill="#fff"/><rect x="48.3" y="34" width="3.4" height="34" rx="1.7" fill="#fff"/><rect x="52.4" y="42" width="3.4" height="18" rx="1.7" fill="#fff"/>${halo(50, 25, 9, 2.8, 1.8)}</svg>`;
// R3 — Halo: nothing but the ring and its light over a cloud
const r3 = () =>
  `<svg viewBox="0 0 100 100">${defs}${sky()}${clouds(70, 0.95)}${rays()}<ellipse cx="50" cy="44" rx="30" ry="12" fill="url(#gGlow)" opacity=".55"/>${halo(50, 44, 24, 7.5, 3.2)}</svg>`;
// R4 — Feather: one feather whose barbs are a waveform
function r4() {
  let barbs = "";
  for (let i = 0; i < 13; i++) {
    const t = i / 12, y = 26 + t * 44, h = (4 + 12 * Math.abs(Math.sin(i * 1.3 + 0.5))) * (1 - Math.abs(t - 0.45) * 0.9);
    barbs += `<path d="M50 ${y.toFixed(1)} q -${(h * 0.6).toFixed(1)} -2 -${h.toFixed(1)} -6" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".9"/><path d="M50 ${y.toFixed(1)} q ${(h * 0.6).toFixed(1)} -2 ${h.toFixed(1)} -6" stroke="#dff3ff" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".75"/>`;
  }
  return `<svg viewBox="0 0 100 100">${defs}${sky()}${clouds(90, 0.5)}<g transform="rotate(-18 50 50)">${barbs}<path d="M50 20 L 50 80" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g></svg>`;
}
// R5 — Angel cover: a pale cover under a halo, fine wings behind it
const r5 = () =>
  `<svg viewBox="0 0 100 100">${defs}${sky()}${clouds(88, 0.6)}${wing(34, 50, -1, 9, 1.05)}${wing(66, 50, 1, 9, 1.05)}<rect x="34" y="40" width="32" height="32" rx="5" fill="url(#gPearl)"/><rect x="34" y="40" width="32" height="32" rx="5" fill="none" stroke="#fff" stroke-opacity=".6"/>${halo(50, 30, 12, 3.6, 2)}</svg>`;
// R6 — R1 for light backgrounds and print
const r6 = () =>
  `<svg viewBox="0 0 100 100"><path d="${TILE}" fill="#f6f8ff"/><path d="${TILE}" fill="none" stroke="#000" stroke-opacity=".06"/><circle cx="50" cy="58" r="16" fill="url(#gSky)"/><circle cx="50" cy="58" r="10" fill="none" stroke="#9fc4ff" stroke-width=".8" opacity=".8"/><circle cx="50" cy="58" r="2.8" fill="#f6f8ff"/><ellipse cx="50" cy="30" rx="15" ry="4.6" fill="none" stroke="#1f3f9e" stroke-width="2.6"/></svg>`;

const CONCEPTS = [
  ["R1", "Halo disc", "The record (A2) with a halo floating over it, in a deep blue sky above a cloud bank and a ray of light.", r1, r1],
  ["R2", "Winged sound", "Three bars of a waveform with wings of feather lines and a small halo — sound as an angel. The wings read as a spectrum.", r2, r2],
  ["R3", "Halo", "Only the glowing ring over clouds. The quietest, most minimal mark; one shape to remember.", r3, r3],
  ["R4", "Feather", "A single feather whose barbs are a waveform; the shaft is the playhead.", r4, r4],
  ["R5", "Angel cover", "A pale cover under a halo, fine wings behind it — the player's cover, given wings.", r5, r5],
  ["R6", "Halo disc · light", "R1 for light backgrounds and print: a blue record, a blue halo, no sky.", r6, r6],
];

document.getElementById("grid").innerHTML = CONCEPTS.map(
  ([k, name, text, big, small]) => `
  <div class="card">
    <div class="stage">${big()}</div>
    <div class="sizes">${big().replace("<svg ", '<svg width="64" height="64" ')}${small().replace("<svg ", '<svg width="32" height="32" ')}${small().replace("<svg ", '<svg width="16" height="16" ')}<span class="lbl">dark</span></div>
    <div class="sizes light">${big().replace("<svg ", '<svg width="64" height="64" ')}${small().replace("<svg ", '<svg width="32" height="32" ')}${small().replace("<svg ", '<svg width="16" height="16" ')}<span class="lbl">light</span></div>
    <div class="meta"><b>${name}<span>${k}</span></b><p>${text}</p><div class="word">${small()}sc player</div></div>
  </div>`,
).join("");
document.fonts.ready.then(() => (window.__ready = true));
