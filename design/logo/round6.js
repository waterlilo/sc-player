// Round 6: S1 (the crescent as the loudest of the sound waves) turned to point up, in graphite.
const TILE = "M50 2 C 86 2, 98 14, 98 50 C 98 86, 86 98, 50 98 C 14 98, 2 86, 2 50 C 2 14, 14 2, 50 2 Z";
const P = { top: "#050506", bottom: "#1d1d23", far: "#2b2b32", rim: "#d9d9df" };
const defs = `<defs><clipPath id="cl"><path d="${TILE}"/></clipPath><linearGradient id="gN" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.top}"/><stop offset="1" stop-color="${P.bottom}"/></linearGradient></defs>`;
const night = () => `<path d="${TILE}" fill="url(#gN)"/><path d="${TILE}" fill="none" stroke="#fff" stroke-opacity=".06"/>`;
const stars = (pts) => pts.map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`).join("");
const glow = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#mGlow)"/>`;
function bank(puffs, lx, ly, rimW = 1.5) {
  const lit = puffs.map(([x, y, r]) => {
    const d = Math.hypot(lx - x, ly - y) || 1;
    return `<circle cx="${(x + ((lx - x) / d) * rimW).toFixed(2)}" cy="${(y + ((ly - y) / d) * rimW).toFixed(2)}" r="${r}" fill="${P.rim}"/>`;
  });
  return `<g clip-path="url(#cl)">${lit.join("")}${puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${P.far}"/>`).join("")}</g>`;
}
const lowBank = (lx, ly, y = 0) => bank([[0, 86 + y, 13], [18, 81 + y, 11], [36, 85 + y, 11], [54, 80 + y, 12], [72, 85 + y, 11], [90, 81 + y, 12], [50, 102 + y, 26]], lx, ly);

/**
 * The sound crescent: waves spread from a point (cx, cy) toward `dir` degrees (-90 = up); the last and biggest wave is
 * the moon, a crescent. `waves` are [radius, width, opacity]; `moon` is the crescent's radius; `span` its half-angle.
 */
function soundMoon({ cx, cy, dir = -90, waves, moon = 24, span = 1.2, dot = false }) {
  const rot = dir;
  const arc = ([r, w, o]) =>
    `<path d="M ${cx + r * Math.cos(-1.05)} ${cy + r * Math.sin(-1.05)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(1.05)} ${cy + r * Math.sin(1.05)}" fill="none" stroke="url(#mFace)" stroke-width="${w}" stroke-linecap="round" opacity="${o}"/>`;
  const a = span, inner = moon * 0.8;
  const crescent = `<path d="M ${cx + moon * Math.cos(-a)} ${cy + moon * Math.sin(-a)} A ${moon} ${moon} 0 0 1 ${cx + moon * Math.cos(a)} ${cy + moon * Math.sin(a)} A ${inner} ${inner} 0 0 0 ${cx + moon * Math.cos(-a)} ${cy + moon * Math.sin(-a)} Z" fill="url(#mFace)"/>`;
  return `<g transform="rotate(${rot} ${cx} ${cy})">${waves.map(arc).join("")}${crescent}${dot ? `<circle cx="${cx}" cy="${cy}" r="2.6" fill="url(#mFace)"/>` : ""}</g>`;
}

// U1 — straight up: the waves rise from just above the clouds, the moon is the top one
const u1 = () => `<svg viewBox="0 0 100 100">${defs}${night()}${stars([[20, 24, 1, 0.8], [80, 22, 0.7, 0.6], [84, 50, 0.5, 0.4]])}${glow(50, 44, 26)}
  ${soundMoon({ cx: 50, cy: 66, waves: [[9, 3.4, 0.55], [16.5, 3.8, 0.8]] })}${lowBank(50, 40, 2)}</svg>`;
// U2 — up, leaning a little: more movement, like a moon rising at an angle
const u2 = () => `<svg viewBox="0 0 100 100">${defs}${night()}${stars([[22, 22, 1, 0.8], [80, 26, 0.6, 0.5]])}${glow(54, 42, 26)}
  ${soundMoon({ cx: 47, cy: 66, dir: -72, waves: [[9, 3.4, 0.55], [16.5, 3.8, 0.8]] })}${lowBank(54, 40, 2)}</svg>`;
// U3 — up, with the source: a small point the sound comes from, the waves widening to the moon
const u3 = () => `<svg viewBox="0 0 100 100">${defs}${night()}${stars([[20, 22, 1, 0.8], [82, 20, 0.7, 0.6]])}${glow(50, 44, 26)}
  ${soundMoon({ cx: 50, cy: 68, waves: [[8, 3, 0.45], [14, 3.4, 0.65], [20, 3.6, 0.85]], moon: 28, dot: true })}${lowBank(50, 40, 6)}</svg>`;
// U4 — out of the clouds: the source is hidden in the clouds; the waves and the moon rise from them
const u4 = () => `<svg viewBox="0 0 100 100">${defs}${night()}${stars([[18, 22, 1, 0.8], [82, 18, 0.7, 0.6], [28, 44, 0.5, 0.4]])}${glow(50, 48, 30)}
  ${soundMoon({ cx: 50, cy: 80, waves: [[12, 3.6, 0.5], [21, 4, 0.75]], moon: 32, span: 1.15 })}${lowBank(50, 46, 0)}</svg>`;
// U5 — bold: two waves only, thicker — for 16 px in the tray
const u5 = () => `<svg viewBox="0 0 100 100">${defs}${night()}${stars([[22, 24, 1.2, 0.85]])}${glow(50, 44, 26)}
  ${soundMoon({ cx: 50, cy: 66, waves: [[12, 5.4, 0.7]], moon: 25, span: 1.15 })}${lowBank(50, 40, 2)}</svg>`;
// U6 — no clouds: just the rising sound-moon on the graphite night, the most minimal
const u6 = () => `<svg viewBox="0 0 100 100">${defs}${night()}${stars([[22, 26, 1, 0.8], [78, 24, 0.7, 0.6], [80, 74, 0.6, 0.4], [24, 72, 0.5, 0.35]])}${glow(50, 50, 26)}
  ${soundMoon({ cx: 50, cy: 70, waves: [[9, 3.4, 0.55], [16.5, 3.8, 0.8]] })}</svg>`;

const CONCEPTS = [
  ["U1", "Rising", "S1 turned up: the waves rise from just above the clouds, the moon is the top one.", u1, u1],
  ["U2", "Rising · leaning", "The same, leaning a little — more movement, like a moon rising at an angle.", u2, u2],
  ["U3", "Rising · source", "A small point the sound comes from, three waves widening to a bigger moon.", u3, u3],
  ["U4", "Out of the clouds", "The source is hidden in the clouds; the waves and the moon rise out of them.", u4, u4],
  ["U5", "Rising · bold", "One thick wave under the moon — the version that holds at 16 px in the tray.", u5, u5],
  ["U6", "Rising · clear sky", "No clouds: just the sound-moon on the graphite night. The most minimal.", u6, u6],
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
