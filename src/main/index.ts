import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FarmService } from "../core/farm";
import { demoFarm } from "../core/demo";
import { SimulatedPrinter, type SimScenario } from "../core/simulator";
import { schedulePrinter } from "../core/schedule";
import type { DriverFactory } from "../core/driver";
import type { Result, SliceRequest } from "../preload/api";
import { driverFactory } from "./drivers";
import { findSlicer, slicePlate } from "./slicer";
import { loadFarm, makeSaver } from "./store";
import { startApi } from "./api";
import { reportStatus, startInboxSource, stopInboxSource } from "./inbox-source";

let win: BrowserWindow | null = null;
let farm: FarmService;
let demoScenarios: Record<string, SimScenario> = {};

// Simulated printers from "Try the demo farm" start mid-print, the way the demo shows them.
const factory: DriverFactory = (cfg, emit) =>
  cfg.driver === "simulator" && demoScenarios[cfg.id] ? new SimulatedPrinter(cfg, emit, demoScenarios[cfg.id]) : driverFactory(cfg, emit);

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (e: unknown): Result<never> => ({ ok: false, error: (e as Error)?.message ?? String(e) });

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    title: "OPF",
    backgroundColor: "#15181a",
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false, contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  const file = join(app.getPath("userData"), "farm.json");
  const saver = makeSaver(file);
  let slicer = findSlicer(null);
  farm = new FarmService(loadFarm(file), factory, {
    persist: (d) => saver.save(d),
    slicer: () => slicer,
  });
  slicer = findSlicer(farm.settings.slicerPath);
  farm.start();
  farm.subscribe((s) => win?.webContents.send("opf:update", s));

  let api = startApi(farm);
  startInboxSource(farm);

  ipcMain.handle("opf:snapshot", () => farm.snapshot());

  ipcMain.handle("opf:act", async (_e, name: string, args: unknown[]) => {
    try {
      const value = await farm.act(name, args);
      if (name === "updateSettings") {
        // Settings that change what runs in the background take effect at once.
        slicer = findSlicer(farm.settings.slicerPath);
        api?.close();
        api = startApi(farm);
        startInboxSource(farm);
      }
      if (name === "enqueue") {
        const [printerId, job] = args as [string, { ref: string | null }];
        const d = farm.view();
        const { slots } = schedulePrinter(d.data.settings, d.live[printerId], d.data.current[printerId], d.data.queues[printerId] ?? []);
        const slot = slots.find((s) => s.job.id === value);
        const printer = d.data.printers.find((p) => p.id === printerId)?.name ?? printerId;
        void reportStatus(farm, { ref: job.ref, status: "queued", printer, start: slot?.start.toISOString(), end: slot?.end.toISOString() });
      }
      return ok(value);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle("opf:openModels", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Add models to the plate",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "3D models", extensions: ["stl", "3mf", "obj"] }],
    });
    if (r.canceled) return [];
    return Promise.all(r.filePaths.map(async (p) => ({ name: basename(p), path: p, data: new Uint8Array(await readFile(p)) })));
  });

  ipcMain.handle("opf:pickProfile", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Choose a profile exported from Bambu Studio or OrcaSlicer",
      properties: ["openFile"],
      filters: [{ name: "Slicer profile", extensions: ["json"] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle("opf:slice", async (_e, req: SliceRequest) => {
    try {
      const printer = farm.view().data.printers.find((p) => p.id === req.printerId);
      const result = await slicePlate(
        { name: req.name, objects: req.objects, profile: printer?.slicing ?? null },
        slicer,
        join(app.getPath("userData"), "sliced"),
      );
      return ok(result);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle("opf:loadDemo", () => {
    const d = demoFarm();
    demoScenarios = d.scenarios;
    // Keep the real API token so connected systems keep working.
    d.data.settings.api.token = farm.settings.api.token;
    farm.replaceData(d.data);
  });

  app.on("before-quit", () => {
    stopInboxSource();
    api?.close();
    farm.shutdown();
    saver.flush();
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
