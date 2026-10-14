import { join } from "node:path";
import { app } from "electron";
import { RENDERER_DEFAULTS, type RendererState, type ThemePref } from "@shared/ipc";
import { JsonFile } from "./json-file";

export interface MainState {
  theme: ThemePref;
  /** api-v2 client_id scraped from soundcloud.com, with the time it was found */
  clientId: { value: string; at: number } | null;
  renderer: RendererState;
}

let file: JsonFile<MainState> | null = null;

/** settings.json in userData. Created lazily: the path is only known once the app is ready. */
export function store() {
  file ??= new JsonFile<MainState>(join(app.getPath("userData"), "settings.json"), { theme: "system", clientId: null, renderer: RENDERER_DEFAULTS });
  return file;
}

export function patchRenderer(patch: Partial<RendererState>) {
  const s = store();
  s.patch({ renderer: { ...RENDERER_DEFAULTS, ...s.get().renderer, ...patch } });
}
