import { contextBridge, ipcRenderer } from "electron";
import type { OpfApi } from "./api";
import type { Snapshot } from "../core/types";

const api: OpfApi = {
  snapshot: () => ipcRenderer.invoke("opf:snapshot"),
  act: (name, ...args) => ipcRenderer.invoke("opf:act", name, args),
  onUpdate: (cb) => {
    const h = (_e: unknown, s: Snapshot) => cb(s);
    ipcRenderer.on("opf:update", h);
    return () => ipcRenderer.removeListener("opf:update", h);
  },
  openModels: () => ipcRenderer.invoke("opf:openModels"),
  pickProfile: () => ipcRenderer.invoke("opf:pickProfile"),
  slice: (req) => ipcRenderer.invoke("opf:slice", req),
  loadDemo: () => ipcRenderer.invoke("opf:loadDemo"),
  isDemo: false,
};

contextBridge.exposeInMainWorld("opf", api);
