import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { EVENT_CHANNELS, INVOKE_CHANNELS, type EventMap, type SkyBridge, type ThemeState } from "@shared/ipc";

const invokable = new Set<string>(INVOKE_CHANNELS);
const events = new Set<string>(EVENT_CHANNELS);

const bridge: SkyBridge = {
  invoke(channel, ...args) {
    if (!invokable.has(channel)) return Promise.reject(new Error(`blocked channel ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (!events.has(channel)) throw new Error(`blocked channel ${channel}`);
    const wrapped = (_e: IpcRendererEvent, payload: EventMap[typeof channel]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  // answered synchronously so the first paint already has the right theme (no flash)
  boot: { theme: ipcRenderer.sendSync("boot:theme") as ThemeState },
};

contextBridge.exposeInMainWorld("sky", bridge);
