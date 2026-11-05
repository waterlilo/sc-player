import { cpus, totalmem } from "node:os";
import { app, screen } from "electron";
import type { Look } from "@shared/ipc";

/**
 * What a report needs to explain "the app loads my CPU": the computer (processor, memory, graphics card and whether
 * Chromium draws with it), how the app looks (a liquid or video background costs the most without a graphics card),
 * and the app's own CPU and memory over the last ten minutes, sampled every 30 s. Nothing personal.
 */

const EVERY = 30_000;
const KEEP = 20;

interface Sample {
  at: number;
  /** % of one core, by process type ("gpu", "renderer", "main"…) */
  cpu: Record<string, number>;
  /** MB, by process type */
  mb: Record<string, number>;
  playing: boolean;
  window: string;
}

const samples: Sample[] = [];
/** CPU seconds per process when last sampled */
let last = new Map<number, number>();
let lastAt = 0;

function sample(state: () => { playing: boolean; window: string }) {
  const now = Date.now();
  const seen = new Map<number, number>();
  const cpu: Record<string, number> = {};
  const mb: Record<string, number> = {};
  for (const p of app.getAppMetrics()) {
    const type =
      p.type === "Browser" ? "main" : p.type === "Tab" ? "page" : p.type === "Utility" ? (p.serviceName?.replace(/^.*\./, "").replace(/Service$/, "").toLowerCase() ?? "utility") : p.type.toLowerCase();
    const used = p.cpu.cumulativeCPUUsage;
    if (used !== undefined) {
      seen.set(p.pid, used);
      const before = last.get(p.pid);
      if (before !== undefined && lastAt) cpu[type] = (cpu[type] ?? 0) + ((used - before) / ((now - lastAt) / 1000)) * 100;
    }
    // the process's own memory (as Task Manager's "Memory" column), not the pages it shares with the others
    mb[type] = (mb[type] ?? 0) + (p.memory.privateBytes ?? p.memory.workingSetSize) / 1024;
  }
  // the first round only sets the starting point
  if (lastAt) {
    samples.push({ at: now, cpu, mb, ...state() });
    if (samples.length > KEEP) samples.shift();
  }
  last = seen;
  lastAt = now;
}

/** Starts sampling: `state` tells whether music plays and how the window is (shown, minimized, in the tray). */
export function watchLoad(state: () => { playing: boolean; window: string }) {
  sample(state);
  setInterval(() => sample(state), EVERY).unref();
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const parts = (r: Record<string, number>, unit: string) =>
  Object.entries(r)
    .filter(([, v]) => v >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${Math.round(v)}${unit}`)
    .join(", ");

/** The graphics card and how Chromium uses it (asked once a report: "complete" takes a moment). */
async function graphics(): Promise<string[]> {
  type Device = { vendorId?: number; deviceId?: number; active?: boolean; driverVersion?: string; deviceString?: string; driverVendor?: string };
  type Info = { gpuDevice?: Device[]; auxAttributes?: { glRenderer?: string } };
  const info = (await Promise.race([app.getGPUInfo("complete"), new Promise((r) => setTimeout(() => r(null), 4000))]).catch(() => null)) as Info | null;
  const hex = (n?: number) => (n === undefined ? "?" : n.toString(16).padStart(4, "0"));
  const devices = (info?.gpuDevice ?? []).map(
    (d) => `${d.deviceString || `${hex(d.vendorId)}:${hex(d.deviceId)}`}${d.driverVersion ? ` (driver ${d.driverVersion})` : ""}${d.active ? " — used" : ""}`,
  );
  const status = app.getGPUFeatureStatus() as unknown as Record<string, string>;
  const keys = ["gpu_compositing", "webgl", "video_decode", "rasterization"];
  return [
    `graphics: ${devices.join("; ") || "unknown"}`,
    `drawn by: ${info?.auxAttributes?.glRenderer || "unknown"}`,
    `graphics features: ${keys.map((k) => `${k} ${status[k] ?? "?"}`).join(", ")}`,
  ];
}

/** The report's part about the computer, the look and the load. */
export async function loadReport(look: Look, memorySaver: boolean): Promise<string[]> {
  const cores = cpus();
  const displays = screen.getAllDisplays().map((d) => `${d.size.width}×${d.size.height} at ${Math.round(d.scaleFactor * 100)}%${d.displayFrequency ? `, ${Math.round(d.displayFrequency)} Hz` : ""}`);
  const lines = [
    `processor: ${cores[0]?.model.trim() ?? "unknown"} × ${cores.length} threads; memory ${Math.round(totalmem() / 2 ** 30)} GB`,
    ...(await graphics()),
    `screens: ${displays.join("; ")}`,
    `memory saver: ${memorySaver ? "on (no graphics card)" : "off"}; look: ${look.design}, background ${look.bg}${look.bg === "file" ? ` (${look.bgFileType || "?"})` : ""}, lite effects ${look.lite ? "on" : "off"}, blur ${look.bgBlur}/${look.panelBlur}`,
    "",
    `--- load, the last ${Math.round((KEEP * EVERY) / 60_000)} minutes, UTC (CPU: % of one thread, ${cores.length} threads = 100% of the processor) ---`,
  ];
  if (!samples.length) lines.push("(not measured yet: the app started less than a minute ago)");
  for (const s of samples) {
    const time = new Date(s.at).toISOString().slice(11, 19);
    lines.push(`${time} CPU ${Math.round(sum(s.cpu))}% (${parts(s.cpu, "%") || "idle"}); memory ${Math.round(sum(s.mb))} MB (${parts(s.mb, "")}); ${s.playing ? "playing" : "not playing"}; window ${s.window}`);
  }
  return lines;
}
