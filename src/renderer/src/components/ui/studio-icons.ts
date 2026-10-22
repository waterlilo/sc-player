/**
 * The studio design's icons: thin geometric lines (1.6 on a 24 grid), round ends, a few solid shapes (play, pause,
 * the skip triangles). Same names as the marker icons of the og design, plus a few only studio screens use.
 */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;

const HEART = "M12 19.5s-7-4.3-8.6-8.8C2.3 7.4 4.5 4.6 7.5 4.6c1.9 0 3.4 1 4.5 2.6 1.1-1.6 2.6-2.6 4.5-2.6 3 0 5.2 2.8 4.1 6.1-1.6 4.5-8.6 8.8-8.6 8.8z";

export const STUDIO_ICONS: Record<string, { fill?: string; stroke?: string }> = {
  play: { fill: "M8 5.5v13l10.5-6.5z" },
  pause: { fill: `${rect(7, 5.5, 3.2, 13, 0.8)}${rect(13.8, 5.5, 3.2, 13, 0.8)}` },
  next: { stroke: "M17.5 5.5v13", fill: "M6 5.5v13l9-6.5z" },
  prev: { stroke: "M6.5 5.5v13", fill: "M18 5.5v13l-9-6.5z" },
  shuffle: { stroke: "M16 4h4v4M5 19 20 4M20 16v4h-4M15 15l5 5M5 5l4.5 4.5" },
  repeat: { stroke: "M16.5 3 20 6.5 16.5 10M4 11v-.5A4 4 0 0 1 8 6.5h12M7.5 21 4 17.5 7.5 14M20 13v.5a4 4 0 0 1-4 4H4" },
  repeatOne: { stroke: "M16.5 3 20 6.5 16.5 10M4 11v-.5A4 4 0 0 1 8 6.5h12M7.5 21 4 17.5 7.5 14M20 13v.5a4 4 0 0 1-4 4H4M11 10.5l1.2-.8v4.6" },
  volume: { stroke: "M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" },
  mute: { stroke: "M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5" },
  queue: { stroke: "M4 6.5h16M4 12h10M4 17.5h10", fill: "M17 14.5v5l4-2.5z" },
  heart: { stroke: HEART },
  plus: { stroke: "M12 5v14M5 12h14" },
  playNext: { stroke: "M4 6.5h12M4 12h8M4 17.5h8M18 13v7M14.5 16.5h7" },
  close: { stroke: "M6 6l12 12M18 6 6 18" },
  minimize: { stroke: "M5 12h14" },
  maximize: { stroke: rect(5, 5, 14, 14, 1.5) },
  restore: { stroke: `${rect(5, 8, 11, 11, 1.2)}M8 8V6.5A1.5 1.5 0 0 1 9.5 5h8A1.5 1.5 0 0 1 19 6.5v8a1.5 1.5 0 0 1-1.5 1.5H16` },
  back: { stroke: "m14.5 6-6 6 6 6" },
  forward: { stroke: "m9.5 6 6 6-6 6" },
  search: { stroke: `${circle(11, 11, 6.5)}m15.6 15.6 4.4 4.4` },
  history: { stroke: `M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3h3M12 8v4.5l3 2` },
  playlists: { stroke: `M4 6.5h11M4 12h11M4 17.5h7${circle(17.5, 17, 2.5)}M20 17V7.5l1.5.8` },
  list: { stroke: "M4 6.5h16M4 12h16M4 17.5h10" },
  user: { stroke: `${circle(12, 8.5, 3.5)}M5 19.5a7 7 0 0 1 14 0` },
  users: { stroke: `${circle(9, 8.5, 3.2)}M3 19.5a6 6 0 0 1 12 0M16 5.5a3.2 3.2 0 0 1 0 6.2M21 19.5a6 6 0 0 0-3.5-5.4` },
  external: { stroke: "M14 5h5v5M19 5l-8 8M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5" },
  settings: {
    stroke: `${circle(12, 12, 3)}M12 3v2.5M12 18.5V21M4.6 6.6l1.8 1.8M17.6 15.6l1.8 1.8M3 12h2.5M18.5 12H21M4.6 17.4l1.8-1.8M17.6 8.4l1.8-1.8`,
  },
  link: { stroke: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" },
  block: { stroke: `${circle(12, 12, 8)}M6.4 6.4l11.2 11.2` },
  moon: { stroke: "M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" },
  lyrics: { stroke: "M4 6.5h10M4 12h16M4 17.5h12" },
  feed: { stroke: "M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14", fill: circle(6, 18, 1.1) },
  home: { stroke: "M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" },
  inbox: { stroke: "M4 13.5 6.5 5h11l2.5 8.5V19H4zM4 13.5h4.5l1.5 2.5h4l1.5-2.5H20" },
  send: { stroke: "M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z" },
  brush: { stroke: "M14.5 4.5 19.5 9.5 11 18l-5-5zM6 13c-2 0-3 1.5-3 3.5S2 20 2 20s3 .5 5-1 2-3.5 2-3.5" },
  copy: { stroke: `${rect(8, 8, 11, 11, 1.5)}M5 15.5V6.5A1.5 1.5 0 0 1 6.5 5h9` },
  check: { stroke: "m5 12.5 4.5 4.5L19 7.5" },
  expand: { stroke: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" },
  collapse: { stroke: "M4 14h6v6M20 10h-6V4" },
  grip: { fill: `${circle(9, 6.5, 1.2)}${circle(15, 6.5, 1.2)}${circle(9, 12, 1.2)}${circle(15, 12, 1.2)}${circle(9, 17.5, 1.2)}${circle(15, 17.5, 1.2)}` },
  bell: { stroke: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0" },
  disc: { stroke: `${circle(12, 12, 8)}${circle(12, 12, 2.2)}` },
  radio: { stroke: `${rect(4, 9, 16, 11, 1.5)}m8 9 9-5${circle(9, 14.5, 2)}` },
  device: { stroke: `${rect(3, 5, 13, 9.5, 1.2)}M7 18.5h5M9.5 14.5v4${rect(18, 8.5, 3.2, 10.5, 0.8)}` },
  wave: { stroke: "M4 12h1.5M8 8.5v7M12 5.5v13M16 9v6M19.5 11v2" },
  image: { stroke: `${rect(3.5, 5, 17, 14, 1.5)}${circle(9, 10, 1.8)}m20.5 16-5-5-8.5 8` },
  sparkle: { stroke: "M12 4v4M12 16v4M4 12h4M16 12h4" },
  more: { fill: `${circle(5.5, 12, 1.2)}${circle(12, 12, 1.2)}${circle(18.5, 12, 1.2)}` },
};
