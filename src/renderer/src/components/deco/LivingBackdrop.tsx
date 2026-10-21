import { useEffect, useRef } from "react";
import { artwork } from "@shared/types";
import { getActivity, subscribeActivity } from "@/lib/activity";
import { bgUrl, onPalette, palette, type RGB } from "@/lib/look";
import { listen, onLevels, type Levels } from "@/lib/reactive";
import { usePlayer, useCurrentTrack } from "@/state/player";
import { useSettings } from "@/state/settings";

/**
 * The studio design's background, under everything: a dim field in the colours of the cover that drifts with the
 * music (or the cover itself, or your own picture / GIF / video, or nothing), then a veil that keeps it quiet under
 * the interface (Settings → Appearance: blur, dim, how much it reacts).
 */
export default function LivingBackdrop() {
  const look = useSettings((s) => s.prefs.look);
  const track = useCurrentTrack();
  const cover = track?.artworkUrl ? artwork(track.artworkUrl, "t500x500") : null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#050506]">
      {look.bg === "liquid" && <LiquidField react={look.bgReact} />}
      {look.bg === "cover" && cover && <Media kind="image" src={cover} react={look.bgReact} />}
      {look.bg === "file" && look.bgFile && <Media kind={look.bgFileType === "video" ? "video" : "image"} src={bgUrl(look.bgFile)} react={look.bgReact} />}
      <div className="studio-veil" />
    </div>
  );
}

/** a picture or a video, blurred by the knob, breathing a little with the bass */
function Media({ kind, src, react }: { kind: "image" | "video"; src: string; react: number }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => listen(box.current), []);
  // a video only runs while someone looks at the window
  useEffect(() => {
    if (kind !== "video") return;
    const sync = () => {
      const v = video.current;
      if (!v) return;
      if (getActivity() === "hidden") v.pause();
      else void v.play().catch(() => undefined);
    };
    sync();
    const off = subscribeActivity(sync);
    return () => {
      off();
    };
  }, [kind, src]);
  return (
    <div ref={box} className="studio-media" style={{ ["--react-k" as string]: String(react / 40) }}>
      {kind === "video" ? <video ref={video} src={src} autoPlay loop muted playsInline /> : <img src={src} alt="" draggable={false} crossOrigin="anonymous" />}
    </div>
  );
}

const FRAG = `precision highp float;
uniform vec2 res; uniform float t; uniform vec4 band; uniform float high;
uniform vec3 c0, c1, c2, c3, c4;
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p){ float a = .5, s = 0.; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++){ s += a * noise(p); p = m * p; a *= .5; } return s; }
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * res) / res.y;
  float slow = t * .05;
  vec2 q = vec2(fbm(uv * 1.3 + vec2(0., slow)), fbm(uv * 1.3 + vec2(3.1, -slow * 1.3) + band.x * .2));
  float k = 2.3 + band.y * .7;
  vec2 r = vec2(fbm(uv * 1.1 + k * q + vec2(1.7, 9.2) + slow * .7 + band.z * .15),
                fbm(uv * 1.1 + k * q + vec2(8.3, 2.8) - slow * .5 + band.w * .18));
  float f = fbm(uv * 1.2 + (2.1 + band.y * .4) * r);
  vec3 col = mix(c0, c1, smoothstep(.3, .68, f));
  col = mix(col, c2, smoothstep(.48, .88, r.x));
  col = mix(col, c3, smoothstep(.55, .92, q.y) * .8);
  col = mix(col, c4, smoothstep(.62, .95, f * r.y * 1.7) * .6);
  float lum = dot(col, vec3(.3, .59, .11));
  col = mix(vec3(lum), col, .58);
  col *= .5 + .12 * band.y + .04 * high;
  float v = smoothstep(1.3, .2, length(uv * vec2(.82, 1.)));
  col = mix(vec3(.02, .02, .024), col, .2 + .5 * v);
  gl_FragColor = vec4(col, 1.);
}`;

/**
 * The cover's palette poured into a slowly warping noise field (domain-warped fbm, a public technique), drawn at
 * 264×172 and stretched blurred over the window: a few hundred thousand pixel runs per frame, 30 frames a second, and
 * only while music plays and the window is in front. Paused, it holds still; a new palette fades in over ~1.2 s.
 */
function LiquidField({ react }: { react: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const k = useRef(react / 40);
  useEffect(() => {
    k.current = react / 40;
  }, [react]);

  useEffect(() => {
    const cv = canvas.current!;
    const gl = cv.getContext("webgl", { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) return;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, "attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }"));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("res"), uT = u("t"), uBand = u("band"), uHigh = u("high");
    const uC = [0, 1, 2, 3, 4].map((i) => u("c" + i));

    let levels: Levels = { bass: 0, treble: 0, beat: 0, energy: 0 };
    let from: RGB[] = palette().field;
    let to: RGB[] = from;
    let fade = 1;
    let time = 37;
    let last = performance.now();

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (usePlayer.getState().status === "playing") time += dt;
      fade = Math.min(1, fade + dt / 1.2);
      const m = fade * fade * (3 - 2 * fade);
      const kk = k.current;
      const b = Math.min(1.5, levels.bass * kk), e = Math.min(1.5, levels.energy * kk), h = Math.min(1.5, levels.treble * kk);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uRes, cv.width, cv.height);
      gl.uniform1f(uT, time);
      gl.uniform4f(uBand, b, b, e, e);
      gl.uniform1f(uHigh, h);
      uC.forEach((loc, i) => {
        const a = from[i] ?? from[0]!, c = to[i] ?? to[0]!;
        gl.uniform3f(loc, a[0] + (c[0] - a[0]) * m, a[1] + (c[1] - a[1]) * m, a[2] + (c[2] - a[2]) * m);
      });
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    // run at 30 fps while it moves (music playing, window in front) or while a new palette fades in
    let timer = 0;
    const tick = () => {
      draw();
      const moving = usePlayer.getState().status === "playing" && getActivity() === "active";
      if (!moving && fade >= 1) stop();
    };
    const start = () => {
      if (timer) return;
      last = performance.now();
      timer = window.setInterval(tick, 33);
    };
    const stop = () => {
      window.clearInterval(timer);
      timer = 0;
    };
    const sync = () => (usePlayer.getState().status === "playing" && getActivity() === "active" ? start() : draw());
    draw();
    sync();
    const offLevels = onLevels((l) => (levels = l));
    const offPalette = onPalette((p) => {
      const m = fade * fade * (3 - 2 * fade);
      from = from.map((a, i) => {
        const c = to[i] ?? a;
        return [a[0] + (c[0] - a[0]) * m, a[1] + (c[1] - a[1]) * m, a[2] + (c[2] - a[2]) * m];
      });
      to = p.field;
      fade = 0;
      start();
    });
    const offActivity = subscribeActivity(sync);
    const offPlayer = usePlayer.subscribe((s, prev) => s.status !== prev.status && sync());
    return () => {
      stop();
      offLevels();
      offPalette();
      offActivity();
      offPlayer();
    };
  }, []);

  return <canvas ref={canvas} width={264} height={172} className="studio-field" />;
}
