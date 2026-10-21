// Round 4: a night sky with clouds, lit by the moon, kept minimal — in cold moonlight blue (?p=blue) or graphite (?p=mono), not the og violet and yellow. Clouds are always a bank or layers,
// never a single cloud on its own (too close to SoundCloud's mark). Original marks.
const PALETTES = {
  blue: { top: "#050913", bottom: "#142a55", top2: "#060b18", bottom2: "#11234a", far: "#1d3260", near: "#0f1c3a", rimFar: "#b8cdf5", rimNear: "#5f7cb8", rimBright: "#e3ecff", groove: "#7f93c4", hole: "#0f1c3a", win: "#0b1630", winLow: "#16284f" },
  mono: { top: "#050506", bottom: "#1d1d23", top2: "#060607", bottom2: "#18181d", far: "#2b2b32", near: "#151519", rimFar: "#d9d9df", rimNear: "#77777f", rimBright: "#f2f2f5", groove: "#8a8a93", hole: "#1d1d23", win: "#0f0f12", winLow: "#1f1f25" },
};
const P = PALETTES[new URLSearchParams(location.search).get("p")] || PALETTES.blue;
const TILE = "M50 2 C 86 2, 98 14, 98 50 C 98 86, 86 98, 50 98 C 14 98, 2 86, 2 50 C 2 14, 14 2, 50 2 Z";
const defs = `<defs><clipPath id="cl"><path d="${TILE}"/></clipPath></defs>`;
const night = (top = P.top, bottom = P.bottom) =>
  `<defs><linearGradient id="n${top.slice(1)}${bottom.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><path d="${TILE}" fill="url(#n${top.slice(1)}${bottom.slice(1)})"/>`;
const stars = (pts) => pts.map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`).join("");
const moonGlow = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r * 2.6}" fill="url(#mGlow)"/>`;
const fullMoon = (cx, cy, r) => `${moonGlow(cx, cy, r)}<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#mFace)"/>`;
// a cloud bank: puffs in the cloud colour, each with a moonlit rim on the side facing the light (lx, ly)
function bank(puffs, color, rim, lx, ly, rimW = 1.6) {
  const lit = puffs.map(([x, y, r]) => {
    const d = Math.hypot(lx - x, ly - y) || 1;
    return `<circle cx="${(x + ((lx - x) / d) * rimW).toFixed(2)}" cy="${(y + ((ly - y) / d) * rimW).toFixed(2)}" r="${r}" fill="${rim}"/>`;
  });
  const body = puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`);
  return `<g clip-path="url(#cl)">${lit.join("")}${body.join("")}</g>`;
}

// M1 — Moonrise: a full moon behind two layers of clouds, their tops lit
const m1 = () =>
  `<svg viewBox="0 0 100 100">${defs}${night()}${stars([[22, 22, 0.9, 0.8], [76, 18, 0.7, 0.6], [84, 34, 0.6, 0.5], [30, 38, 0.5, 0.4]])}${fullMoon(56, 46, 15)}
  ${bank([[4, 72, 14], [20, 66, 12], [36, 70, 13], [52, 64, 12], [68, 69, 13], [86, 66, 14], [100, 72, 12], [50, 90, 30]], P.far, P.rimFar, 56, 46)}
  ${bank([[-2, 86, 14], [16, 82, 12], [34, 86, 13], [54, 82, 14], [74, 86, 12], [94, 82, 14], [50, 104, 30]], P.near, P.rimNear, 56, 46, 1.2)}</svg>`;
// M2 — Crescent: a thin crescent with its glow, a low bank of clouds, a few stars — the og night in one mark
const m2 = () =>
  `<svg viewBox="0 0 100 100">${defs}${night(P.top2, P.bottom2)}${stars([[24, 24, 1, 0.9], [70, 70, 0.6, 0.4], [80, 26, 0.7, 0.6], [34, 46, 0.5, 0.5]])}
  <defs><mask id="crm"><rect width="100" height="100" fill="#fff"/><circle cx="64" cy="35" r="17" fill="#000"/></mask></defs>${moonGlow(56, 42, 14)}<circle cx="56" cy="42" r="19" fill="url(#mFace)" mask="url(#crm)"/>
  ${bank([[0, 84, 14], [18, 79, 12], [36, 83, 12], [54, 78, 13], [72, 83, 12], [90, 79, 13], [50, 100, 26]], P.far, P.rimFar, 56, 42)}</svg>`;
// M3 — Cloud crossing: one line of cloud passing over a big full moon; the most graphic
const m3 = () =>
  `<svg viewBox="0 0 100 100">${defs}${night(P.top2, P.bottom2)}${fullMoon(50, 46, 26)}${stars([[16, 18, 0.8, 0.7], [84, 20, 0.7, 0.6], [86, 80, 0.6, 0.4]])}
  ${bank([[18, 58, 9], [30, 53, 11], [44, 56, 10], [58, 51, 12], [72, 56, 10], [84, 59, 8], [50, 64, 8], [30, 62, 8], [70, 63, 8]], P.far, P.rimBright, 50, 30, 1.4)}</svg>`;
// M4 — Moon record: the full moon is a record (fine grooves), rising over the cloud bank
const m4 = () =>
  `<svg viewBox="0 0 100 100">${defs}${night()}${moonGlow(50, 46, 18)}<circle cx="50" cy="46" r="20" fill="url(#mFace)"/>${[16, 12.5, 9].map((r) => `<circle cx="50" cy="46" r="${r}" fill="none" stroke="${P.groove}" stroke-opacity=".35" stroke-width=".6"/>`).join("")}<circle cx="50" cy="46" r="3" fill="${P.hole}"/>
  ${stars([[18, 20, 0.8, 0.7], [82, 16, 0.6, 0.5]])}${bank([[0, 78, 13], [16, 72, 12], [32, 77, 12], [50, 71, 13], [68, 76, 12], [86, 72, 13], [100, 78, 12], [50, 96, 28]], P.far, P.rimFar, 50, 46)}</svg>`;
// M5 — Moonlit horizon: the cloud tops make a waveform, the moon above is the playhead's dot
function m5() {
  const tops = [10, 16, 12, 22, 14, 26, 18, 12, 20, 14, 10];
  const puffs = tops.map((h, i) => [8 + i * 8.4, 84 - h, 6.2]).concat(tops.map((h, i) => [8 + i * 8.4, 92 - h / 2, 8]));
  return `<svg viewBox="0 0 100 100">${defs}${night(P.top2, P.bottom)}${stars([[20, 20, 0.8, 0.7], [44, 14, 0.6, 0.5], [86, 26, 0.7, 0.6]])}${fullMoon(66, 34, 9)}
  ${bank(puffs, P.far, P.rimFar, 66, 34, 1.5)}<rect x="0" y="92" width="100" height="10" fill="${P.far}" clip-path="url(#cl)"/></svg>`;
}
// M6 — Window: the cover as a window on the night (the studio player's cover-as-background idea)
const m6 = () =>
  `<svg viewBox="0 0 100 100">${defs}<path d="${TILE}" fill="#0e0e11"/><path d="${TILE}" fill="none" stroke="#fff" stroke-opacity=".07"/>
  <clipPath id="win"><rect x="24" y="24" width="52" height="52" rx="8"/></clipPath><g clip-path="url(#win)"><rect x="24" y="24" width="52" height="52" fill="${P.win}"/><rect x="24" y="50" width="52" height="26" fill="${P.winLow}"/>${fullMoon(56, 42, 8)}${[[22, 66, 8], [34, 62, 8], [46, 66, 8], [58, 61, 9], [70, 65, 8], [82, 62, 8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y - 0.9}" r="${r}" fill="${P.rimFar}"/><circle cx="${x}" cy="${y}" r="${r}" fill="${P.far}"/>`).join("")}<rect x="24" y="70" width="52" height="8" fill="${P.far}"/><circle cx="34" cy="34" r=".7" fill="#fff"/><circle cx="68" cy="30" r=".6" fill="#fff" opacity=".7"/></g>
  <rect x="24" y="24" width="52" height="52" rx="8" fill="none" stroke="#fff" stroke-opacity=".14"/></svg>`;

const CONCEPTS = [
  ["M1", "Moonrise", "A full moon behind two layers of clouds whose tops it lights — a calm night as an icon.", m1, m1],
  ["M2", "Crescent", "A thin crescent with its glow over a low bank of clouds and a few stars. The simplest night; reads at 16 px.", m2, m2],
  ["M3", "Cloud crossing", "One line of cloud passing over a big full moon. The most graphic: two shapes, strong at any size.", m3, m3],
  ["M4", "Moon record", "The moon is a record — fine grooves, a centre — rising over the clouds. Music without saying so.", m4, m4],
  ["M5", "Moonlit horizon", "The cloud tops make a waveform; the moon above it is the playhead's dot.", m5, m5],
  ["M6", "Night window", "The cover as a window onto the night: the studio player's cover-as-background, in one square.", m6, m6],
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
