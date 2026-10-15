import { join } from "node:path";
import { app } from "electron";
import { RENDERER_DEFAULTS, withPrefDefaults, type Prefs, type RendererState } from "@shared/ipc";
import { JsonFile } from "./json-file";

export interface MainState {
  /** api-v2 client_id scraped from soundcloud.com, with the time it was found */
  clientId: { value: string; at: number } | null;
  renderer: RendererState;
}

let file: JsonFile<MainState> | null = null;

/** settings.json in userData. Created lazily: the path is only known once the app is ready. */
export function store() {
  file ??= new JsonFile<MainState>(join(app.getPath("userData"), "settings.json"), { clientId: null, renderer: RENDERER_DEFAULTS });
  return file;
}

export function patchRenderer(patch: Partial<RendererState>) {
  const s = store();
  s.patch({ renderer: { ...RENDERER_DEFAULTS, ...s.get().renderer, ...patch } });
}

/** The Settings screen's values, with defaults for anything a newer version added. */
export function prefs(): Prefs {
  return withPrefDefaults(store().get().renderer?.prefs);
}
