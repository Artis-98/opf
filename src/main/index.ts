import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FarmService } from "../core/farm";
import { demoFarm } from "../core/demo";
import type { SimScenario } from "../core/simulator";
import type { DriverFactory } from "../core/driver";
import type { Result, SliceRequest } from "../preload/api";
import { makeDriverFactory } from "./drivers";
import { slicePlate } from "./slicer";
import { startHost, type Host } from "./host";
import { changesSinceLastRun, checkForUpdate, isCheckout, restartThroughLauncher, type Change, type UpdateState } from "./updater";
import icon from "../../resources/icon.png?asset";

let win: BrowserWindow | null = null;
let farm: FarmService;
let host: Host;
let demoScenarios: Record<string, SimScenario> = {};

// Simulated printers from "Try the demo farm" start mid-print, the way the demo shows them.
const factory: DriverFactory = makeDriverFactory(() => farm?.settings.simSpeed ?? 1, () => demoScenarios);

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (e: unknown): Result<never> => ({ ok: false, error: (e as Error)?.message ?? String(e) });

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    title: "OPF",
    icon,
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

// One OPF at a time: a second start (say, the desktop icon while OPF is open) brings the open window forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

/** Updates for a copy running from its git folder (started by OPF.bat). Installed copies skip this. */
function watchForUpdates() {
  const root = app.getAppPath();
  let state: UpdateState | null = null;
  let whatsNew: Change[] = [];
  const enabled = !app.isPackaged && isCheckout(root);
  ipcMain.handle("opf:updateState", () => state);
  ipcMain.handle("opf:whatsNew", () => {
    const w = whatsNew;
    whatsNew = [];
    return w;
  });
  ipcMain.handle("opf:restart", () => {
    if (!enabled) return;
    restartThroughLauncher(root);
    app.quit();
  });
  if (!enabled) return;
  changesSinceLastRun(root, join(app.getPath("userData"), "version.json")).then((c) => (whatsNew = c), () => {});
  const check = () =>
    checkForUpdate(root).then(
      (s) => {
        state = s;
        if (s) win?.webContents.send("opf:updateReady", s);
      },
      () => { /* offline: try again later */ },
    );
  setTimeout(check, 15_000);
  setInterval(check, 3 * 60_000);
}

app.whenReady().then(() => {
  watchForUpdates();
  host = startHost({ dataDir: app.getPath("userData"), factory, uiRoot: join(__dirname, "../renderer") });
  farm = host.farm;
  farm.subscribe((s) => win?.webContents.send("opf:update", s));

  ipcMain.handle("opf:snapshot", () => farm.snapshot());
  ipcMain.handle("opf:act", (_e, name: string, args: unknown[]) => host.runAction(name, args));

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
        host.slicer(),
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

  app.on("before-quit", () => host.shutdown());

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
