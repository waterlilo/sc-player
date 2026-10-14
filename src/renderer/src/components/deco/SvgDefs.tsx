/** Shared SVG filters referenced from CSS (from the portfolio, unchanged): crude outlines, stippled moon, RGB split, JPEG-ish blocks, stipple glow. Defined once; nothing animates them. */
export default function SvgDefs() {
  const rough = (id: string, seed: number, scale: number, freq = 0.04) => (
    <filter id={id} x="-6%" y="-6%" width="112%" height="112%" key={id}>
      <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={2} seed={seed} result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale={scale} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
  // the moon (Now Playing, night): wobbly edge, posterized speckle and soft, blotchy dirty patches
  const moon = (id: string, seed: number) => (
    <filter id={id} key={id} x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves={2} seed={seed} result="warp" />
      <feDisplacementMap in="SourceGraphic" in2="warp" scale={7} xChannelSelector="R" yChannelSelector="G" result="shape" />
      {/* blotches: low-frequency noise → soft patches, olive and violet, low opacity, kept inside the shape */}
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={3} seed={57} result="blot" />
      <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.6 0 0 0 -1.35" result="blotA" />
      <feFlood floodColor="#5c5a12" floodOpacity="0.55" result="olive" />
      <feComposite in="olive" in2="blotA" operator="in" result="oliveBlot" />
      <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 2.4 0 0 -1.45" result="blotB" />
      <feFlood floodColor="#3a2a6e" floodOpacity="0.4" result="violet" />
      <feComposite in="violet" in2="blotB" operator="in" result="violetBlot" />
      <feMerge result="blots">
        <feMergeNode in="oliveBlot" />
        <feMergeNode in="violetBlot" />
      </feMerge>
      <feComposite in="blots" in2="shape" operator="in" result="blotsIn" />
      {/* posterized violet speckle, as on the site */}
      <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves={1} seed={seed + 40} result="grain" />
      <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="ga" />
      <feComponentTransfer in="ga" result="dots">
        <feFuncA type="discrete" tableValues="0 0 0 0 0 1 1 1" />
      </feComponentTransfer>
      <feFlood style={{ floodColor: "var(--sky)" }} result="speckColor" />
      <feComposite in="speckColor" in2="dots" operator="in" result="speck" />
      <feComposite in="speck" in2="shape" operator="in" result="speckIn" />
      <feMerge>
        <feMergeNode in="shape" />
        <feMergeNode in="blotsIn" />
        <feMergeNode in="speckIn" />
      </feMerge>
    </filter>
  );
  const split = (id: string, dx: number) => (
    <filter id={id} key={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
      <feOffset in="r" dx={dx} result="ro" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
      <feOffset in="b" dx={-dx} dy={dx > 0 ? 1 : -1} result="bo" />
      <feBlend in="ro" in2="g" mode="screen" result="rg" />
      <feBlend in="rg" in2="bo" mode="screen" />
    </filter>
  );
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        {rough("rough-1", 2, 6)}
        {rough("rough-2", 7, 6.5)}
        {rough("rough-3", 13, 5.5)}
        {rough("rough-text", 5, 2.4, 0.06)}
        {moon("moon-1", 4)}
        {moon("moon-2", 10)}
        {moon("moon-3", 22)}
        {split("rgb-split", 3)}
        {split("rgb-split-2", -3)}
        {/* the extra moon glow at the peak of its pulse, glow only (no moon): on top of the moon's own drop-shadows
            (7px .32 + 22px .22) it adds up to the old peak (11px .46 + 30px .3); stdDeviation = blur radius / 2 */}
        <filter id="moon-pulse" x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="15" result="wide" />
          <feFlood floodColor="rgb(150, 140, 20)" floodOpacity="0.103" />
          <feComposite in2="wide" operator="in" result="g2" />
          <feGaussianBlur in="SourceAlpha" stdDeviation="5.5" result="near" />
          <feFlood floodColor="rgb(242, 220, 26)" floodOpacity="0.206" />
          <feComposite in2="near" operator="in" result="g1" />
          <feMerge>
            <feMergeNode in="g2" />
            <feMergeNode in="g1" />
          </feMerge>
        </filter>
        {/* JPEG-like 8px blocks */}
        <filter id="blocky" x="0" y="0" width="100%" height="100%">
          <feFlood x="4" y="4" width="1" height="1" />
          <feComposite width="8" height="8" />
          <feTile result="grid" />
          <feComposite in="SourceGraphic" in2="grid" operator="in" />
          <feMorphology operator="dilate" radius="4" />
        </filter>
        {/*
          Stipple: turns a soft glow into a crushed spray-can speckle — alpha + noise, then a hard threshold.
          Keeps the source colour, so a yellow radial gradient becomes yellow dots, dense in the middle.
        */}
        <filter id="stipple" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={1} seed={17} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="na" />
          <feComposite in="SourceAlpha" in2="na" operator="arithmetic" k2="1" k3="0.6" k4="-0.48" result="mix" />
          <feComponentTransfer in="mix" result="mask">
            <feFuncA type="discrete" tableValues="0 0 1 1" />
          </feComponentTransfer>
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1" result="solid" />
          <feComposite in="solid" in2="mask" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}
