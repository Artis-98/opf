import { contextBridge, ipcRenderer } from "electron";
import type { OpfApi, UpdateInfo } from "./api";
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
  updateState: () => ipcRenderer.invoke("opf:updateState"),
  onUpdateReady: (cb) => {
    const h = (_e: unknown, u: UpdateInfo) => cb(u);
    ipcRenderer.on("opf:updateReady", h);
    return () => ipcRenderer.removeListener("opf:updateReady", h);
  },
  whatsNew: () => ipcRenderer.invoke("opf:whatsNew"),
  restart: () => ipcRenderer.invoke("opf:restart"),
  openFull: () => ipcRenderer.invoke("opf:openFull"),
  isDemo: false,
};

contextBridge.exposeInMainWorld("opf", api);
