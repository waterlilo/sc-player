// Round 5: the crescent over clouds (round 4, M2) in graphite, tied to music. Original marks.
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
const lowBank = (lx, ly) => bank([[0, 86, 13], [18, 81, 11], [36, 85, 11], [54, 80, 12], [72, 85, 11], [90, 81, 12], [50, 102, 26]], lx, ly);
const crescentMask = (id, cx, cy, ox, oy, r) => `<mask id="${id}"><rect width="100" height="100" fill="#fff"/><circle cx="${cx + ox}" cy="${cy + oy}" r="${r}" fill="#000"/></mask>`;

// S1 — Sound crescent: the crescent drawn as sound waves — three arcs, the loudest the moon
const s1 = () => {
  const arc = (r, w, o) => `<path d="M ${50 + r * Math.cos(-1.1)} ${46 + r * Math.sin(-1.1)} A ${r} ${r} 0 0 1 ${50 + r * Math.cos(1.1)} ${46 + r * Math.sin(1.1)}" fill="none" stroke="url(#mFace)" stroke-width="${w}" stroke-linecap="round" opacity="${o}"/>`;
  return `<svg viewBox="0 0 100 100">${defs}${night()}${stars([[24, 24, 1, 0.8], [30, 58, 0.6, 0.4], [82, 20, 0.7, 0.5]])}${glow(56, 46, 26)}
  <g transform="rotate(-25 50 46) translate(-6 0)">${arc(8, 3.4, 0.55)}${arc(15, 3.8, 0.8)}<path d="M ${50 + 24 * Math.cos(-1.2)} ${46 + 24 * Math.sin(-1.2)} A 24 24 0 0 1 ${50 + 24 * Math.cos(1.2)} ${46 + 24 * Math.sin(1.2)} A 19 19 0 0 0 ${50 + 24 * Math.cos(-1.2)} ${46 + 24 * Math.sin(-1.2)} Z" fill="url(#mFace)"/></g>${lowBank(56, 40)}</svg>`;
};
// S2 — Grooved crescent: the moon is a record seen as a crescent; its grooves follow the disc
const s2 = () => `<svg viewBox="0 0 100 100">${defs}<defs>${crescentMask("cm2", 52, 44, 11, -8, 19)}</defs>${night()}${stars([[22, 24, 1, 0.8], [80, 66, 0.6, 0.4], [76, 18, 0.7, 0.5]])}${glow(52, 44, 26)}
  <g mask="url(#cm2)"><circle cx="52" cy="44" r="21" fill="url(#mFace)"/>${[18, 15, 12, 9].map((r) => `<circle cx="52" cy="44" r="${r}" fill="none" stroke="#8a8a93" stroke-opacity=".45" stroke-width=".7"/>`).join("")}</g>${lowBank(52, 44)}</svg>`;
// S3 — Spectrum moon: short lines of light standing out of the crescent's outer edge — moonlight as a spectrum
const s3 = () => {
  let g = "";
  for (let i = 0; i < 26; i++) {
    const a = Math.PI * (0.62 + (i / 25) * 1.12);
    const v = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.31) * Math.cos(i * 0.47));
    const r0 = 22.5, len = 2 + v * 8;
    g += `<line x1="${(50 + Math.cos(a) * r0).toFixed(2)}" y1="${(46 + Math.sin(a) * r0).toFixed(2)}" x2="${(50 + Math.cos(a) * (r0 + len)).toFixed(2)}" y2="${(46 + Math.sin(a) * (r0 + len)).toFixed(2)}" stroke="#ececef" stroke-width="1.5" stroke-linecap="round" opacity="${(0.3 + v * 0.6).toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 100 100">${defs}<defs>${crescentMask("cm3", 50, 46, 10, -7, 18)}</defs>${night()}${glow(50, 46, 24)}${g}<circle cx="50" cy="46" r="20" fill="url(#mFace)" mask="url(#cm3)"/>${stars([[78, 22, 0.8, 0.7]])}${lowBank(50, 46)}</svg>`;
};
// S4 — Moon note: the full moon is the head of a note, its stem rising into the night, a wisp of cloud for the flag
const s4 = () => `<svg viewBox="0 0 100 100">${defs}${night()}${stars([[22, 22, 1, 0.8], [30, 46, 0.6, 0.4], [82, 60, 0.6, 0.4]])}${glow(44, 62, 22)}
  <rect x="52.5" y="20" width="3.4" height="43" rx="1.7" fill="url(#mFace)"/><path d="M55.5 21 C 64 24, 70 29, 68 39 C 66 33, 61 31, 55.5 31 Z" fill="url(#mFace)" opacity=".92"/>
  <ellipse cx="45" cy="63" rx="11" ry="8.5" transform="rotate(-22 45 63)" fill="url(#mFace)"/>${bank([[0, 90, 12], [20, 86, 11], [40, 92, 11], [62, 87, 12], [82, 91, 11], [100, 87, 11]], 45, 60)}</svg>`;
// S5 — Waveform clouds: the crescent over a cloud bank whose tops are the bars of a waveform
const s5 = () => {
  const H = [10, 18, 13, 24, 16, 30, 20, 14, 22, 12, 8];
  const bars = H.map((h, i) => `<rect x="${(9 + i * 7.6).toFixed(1)}" y="${84 - h}" width="5" height="${h + 20}" rx="2.5" fill="${P.far}"/><rect x="${(9 + i * 7.6).toFixed(1)}" y="${84 - h}" width="5" height="1.6" rx=".8" fill="${P.rim}" opacity=".9"/>`).join("");
  return `<svg viewBox="0 0 100 100">${defs}<defs>${crescentMask("cm5", 54, 34, 8, -6, 13)}</defs>${night()}${stars([[24, 24, 0.9, 0.8], [80, 18, 0.6, 0.5]])}${glow(54, 34, 18)}<circle cx="54" cy="34" r="14" fill="url(#mFace)" mask="url(#cm5)"/><g clip-path="url(#cl)">${bars}</g></svg>`;
};
// S6 — Moon phase: the crescent is the played part of a track — a progress ring, its knob a star
const s6 = () => {
  const r = 20, a0 = -Math.PI / 2, a1 = a0 + Math.PI * 1.25;
  const p = (a) => `${(50 + Math.cos(a) * r).toFixed(2)} ${(46 + Math.sin(a) * r).toFixed(2)}`;
  return `<svg viewBox="0 0 100 100">${defs}${night()}${glow(50, 46, 24)}<circle cx="50" cy="46" r="${r}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="5"/>
  <path d="M ${p(a0)} A ${r} ${r} 0 1 1 ${p(a1)}" fill="none" stroke="url(#mFace)" stroke-width="5" stroke-linecap="round"/><circle cx="${(50 + Math.cos(a1) * r).toFixed(2)}" cy="${(46 + Math.sin(a1) * r).toFixed(2)}" r="4.2" fill="#fff"/>${stars([[24, 22, 0.9, 0.8], [80, 20, 0.6, 0.5]])}${lowBank(50, 40)}</svg>`;
};

const CONCEPTS = [
  ["S1", "Sound crescent", "The crescent is the loudest of three sound waves — the moon sounds.", s1, s1],
  ["S2", "Grooved crescent", "The moon is a record seen as a crescent: its grooves follow the disc. The music is in the texture.", s2, s2],
  ["S3", "Spectrum moon", "Short lines of light stand out of the crescent's edge — moonlight as a spectrum, like the ring around the cover in the player.", s3, s3],
  ["S4", "Moon note", "The full moon is the head of a note, its stem rising into the night, a wisp of cloud for the flag.", s4, s4],
  ["S5", "Waveform clouds", "The crescent over a cloud bank whose tops are the bars of a waveform.", s5, s5],
  ["S6", "Moon phase", "The crescent is the played part of a track: a progress ring with its knob. Phases of the moon, phases of a song.", s6, s6],
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
