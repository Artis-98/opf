import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { FarmService } from "../core/farm";
import { demoFarm } from "../core/demo";
import type { SimScenario } from "../core/simulator";
import type { DriverFactory } from "../core/driver";
import type { Result, SliceRequest } from "../preload/api";
import { makeDriverFactory } from "./drivers";
import { slicePlate } from "./slicer";
import { startHost, type Host } from "./host";
import type { UpdateHooks } from "./api";
import { changesSinceLastRun, checkForUpdate, isCheckout, restartThroughLauncher, type Change, type UpdateState } from "./updater";
import { slicerExe, startMini, type Mini } from "./mini";
import icon from "../../resources/icon.png?asset";

let win: BrowserWindow | null = null;
let mini: Mini | null = null;
let farm: FarmService;
// Started without a window (launch.cjs --background, by OPF Slicer, the desktop icon or Windows
// starting): the farm, its web page, and the small OPF by the clock. Closing OPF's window, or OPF
// Slicer, leaves the farm running there; its menu quits OPF.
const background = process.argv.includes("--background");
let host: Host;
let demoScenarios: Record<string, SimScenario> = {};

// Simulated printers from "Try the demo farm" start mid-print, the way the demo shows them.
const factory: DriverFactory = makeDriverFactory(() => farm?.settings.simSpeed ?? 1, () => demoScenarios);

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (e: unknown): Result<never> => ({ ok: false, error: (e as Error)?.message ?? String(e) });

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

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
  win.on("closed", () => (win = null));
}

/** The full OPF: OPF Slicer once it is known, otherwise OPF's own farm window. */
function openFull() {
  const slicer = slicerExe();
  if (slicer) spawn(slicer, [], { cwd: dirname(slicer), detached: true, stdio: "ignore" }).unref();
  else showWindow();
}

/** To every OPF window: the farm window and the small one by the clock. */
function broadcast(channel: string, value: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, value);
}

// One OPF at a time. A second start (say, the desktop icon while OPF is open) brings the window
// forward; OPF Slicer starting it again (--background) changes nothing.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_e, argv) => {
  if (app.isReady() && !argv.includes("--background")) showWindow();
});

/**
 * Updates for a copy running from its git folder (started by OPF.bat). Installed copies skip this.
 * The window asks over IPC; the web page (in OPF Slicer, or a browser) over the local web server.
 */
function watchForUpdates(): UpdateHooks {
  const root = app.getAppPath();
  let state: UpdateState | null = null;
  let whatsNew: Change[] = [];
  const enabled = !app.isPackaged && isCheckout(root);
  const hooks: UpdateHooks = {
    state: () => state,
    whatsNew: () => {
      const w = whatsNew;
      whatsNew = [];
      return w;
    },
    restart: () => {
      if (!enabled) return;
      // Without its window when none is open: the small OPF by the clock comes back by itself.
      restartThroughLauncher(root, !win);
      app.quit();
    },
  };
  ipcMain.handle("opf:updateState", hooks.state);
  ipcMain.handle("opf:whatsNew", hooks.whatsNew);
  ipcMain.handle("opf:restart", hooks.restart);
  if (!enabled) return hooks;
  changesSinceLastRun(root, join(app.getPath("userData"), "version.json")).then((c) => (whatsNew = c), () => {});
  const check = () =>
    checkForUpdate(root).then(
      (s) => {
        state = s;
        if (s) broadcast("opf:updateReady", s);
      },
      () => { /* offline: try again later */ },
    );
  setTimeout(check, 15_000);
  setInterval(check, 3 * 60_000);
  return hooks;
}

/**
 * Where OPF's launcher is, for OPF Slicer to start OPF. The launcher writes this each time it runs;
 * this covers a copy updated by an older launcher, which did not.
 */
function recordLauncher() {
  const root = app.getAppPath();
  const file = join(app.getPath("userData"), "launcher.json");
  if (app.isPackaged || !isCheckout(root) || existsSync(file)) return;
  execFile(process.platform === "win32" ? "where" : "which", ["node"], { windowsHide: true }, (err, out) => {
    const node = out?.split(/\r?\n/)[0]?.trim();
    if (err || !node) return;
    try {
      writeFileSync(file, JSON.stringify({ node, script: join(root, "scripts", "launch.cjs"), root }, null, 2));
    } catch { /* the Farm tab then asks to start OPF from its icon */ }
  });
}

app.whenReady().then(() => {
  recordLauncher();
  const updates = watchForUpdates();
  host = startHost({ dataDir: app.getPath("userData"), factory, uiRoot: join(__dirname, "../renderer"), updates });
  farm = host.farm;
  farm.subscribe((s) => broadcast("opf:update", s));

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

  mini = startMini(farm, {
    icon,
    preload: join(__dirname, "../preload/index.js"),
    page: { url: process.env.ELECTRON_RENDERER_URL, file: join(__dirname, "../renderer/index.html") },
    openFull,
    openWindow: showWindow,
    hasSlicer: () => slicerExe() !== null,
  });
  ipcMain.handle("opf:openFull", () => {
    mini?.hidePopup();
    openFull();
  });

  if (!background) createWindow();
  app.on("activate", showWindow);
});

app.on("window-all-closed", () => {
  // The farm keeps running in the small OPF by the clock; its menu quits OPF. Linux desktops do not
  // all show tray icons, so there closing the window quits, unless OPF started without one.
  if (process.platform === "linux" && !background) app.quit();
});
