// The small OPF by the clock. While OPF runs, its icon sits in the tray: clicking it opens a popup
// with every printer and the buttons needed at the printer, and a way into the full OPF. When a
// print finishes or a printer needs someone, it says so with a notification. It starts with Windows,
// so the farm is always watched.

import { app, BrowserWindow, Menu, nativeImage, Notification, screen, Tray } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FarmService } from "../core/farm";
import { farmNews, farmSummary, statuses, type FarmNews } from "../core/status";
import type { PrinterStatus, Snapshot } from "../core/types";

export interface MiniOptions {
  icon: string;
  preload: string;
  /** The window's page: the dev server's address, or the built index.html. */
  page: { url?: string; file: string };
  /** The full OPF: OPF Slicer when it is known, otherwise OPF's farm window. */
  openFull(): void;
  /** OPF's own farm window. */
  openWindow(): void;
  /** Whether OPF Slicer is known, to say "Open OPF Slicer" in the menu. */
  hasSlicer(): boolean;
}

export interface Mini {
  hidePopup(): void;
}

const WIDTH = 380, HEIGHT = 540;

export function startMini(farm: FarmService, opts: MiniOptions): Mini {
  const tray = new Tray(opts.icon);
  let popup: BrowserWindow | null = null;
  let hiddenAt = 0;

  function createPopup() {
    popup = new BrowserWindow({
      width: WIDTH, height: HEIGHT, show: false, frame: false, resizable: false, movable: false,
      skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, minimizable: false, maximizable: false,
      title: "OPF", icon: opts.icon, backgroundColor: "#15181a",
      webPreferences: { preload: opts.preload, sandbox: false, contextIsolation: true },
    });
    // Like the clock's own popups: it goes away when you click elsewhere.
    popup.on("blur", () => {
      popup?.hide();
      hiddenAt = Date.now();
    });
    popup.on("closed", () => (popup = null));
    if (opts.page.url) void popup.loadURL(`${opts.page.url}?mini=1`);
    else void popup.loadFile(opts.page.file, { query: { mini: "1" } });
  }

  /** Just above the tray icon (or below it, with the taskbar at the top). */
  function place() {
    if (!popup) return;
    const b = tray.getBounds();
    const known = b.width > 0 && b.height > 0;
    const area = (known ? screen.getDisplayMatching(b) : screen.getPrimaryDisplay()).workArea;
    let x = area.x + area.width - WIDTH - 12;
    let y = area.y + area.height - HEIGHT - 12;
    if (known) {
      x = Math.min(Math.max(b.x + b.width / 2 - WIDTH / 2, area.x + 8), area.x + area.width - WIDTH - 8);
      y = b.y > area.y + area.height / 2 ? area.y + area.height - HEIGHT - 8 : area.y + 8;
    }
    popup.setPosition(Math.round(x), Math.round(y));
  }

  function showPopup() {
    if (!popup) createPopup();
    place();
    popup!.show();
    popup!.focus();
  }

  function togglePopup() {
    if (popup?.isVisible()) return popup.hide();
    // This click already closed it, by taking the focus away.
    if (Date.now() - hiddenAt < 300) return;
    showPopup();
  }

  // Starting with Windows (and macOS): the farm is watched from the moment the PC is on.
  const loginItem = app.isPackaged
    ? { path: process.execPath, args: ["--background"] }
    : { path: process.execPath, args: [app.getAppPath(), "--background"] };
  const canStartWithSystem = process.platform === "win32" || process.platform === "darwin";
  const startsWithSystem = () => canStartWithSystem && app.getLoginItemSettings(loginItem).openAtLogin;
  const setStartsWithSystem = (on: boolean) => {
    app.setLoginItemSettings({ openAtLogin: on, ...loginItem });
    menu();
  };
  // On by default, once: after that it is whatever was chosen in the menu.
  const asked = join(app.getPath("userData"), "start-with-windows.json");
  if (canStartWithSystem && !existsSync(asked)) {
    try {
      setStartsWithSystem(true);
      writeFileSync(asked, JSON.stringify({ chosen: true }));
    } catch { /* the menu still offers it */ }
  }

  function menu() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: opts.hasSlicer() ? "Open OPF Slicer" : "Open OPF", click: opts.openFull },
      ...(opts.hasSlicer() ? [{ label: "Open the farm window", click: opts.openWindow }] : []),
      { label: "Show the farm", click: showPopup },
      { type: "separator" },
      ...(canStartWithSystem
        ? [{ label: process.platform === "darwin" ? "Start OPF when the Mac starts" : "Start OPF with Windows", type: "checkbox" as const, checked: startsWithSystem(), click: (i: Electron.MenuItem) => setStartsWithSystem(i.checked) }]
        : []),
      { label: "Quit OPF", click: () => app.quit() },
    ]));
  }
  menu();
  tray.on("click", togglePopup);
  tray.on("balloon-click", showPopup);

  function notify(news: FarmNews) {
    // Windows shows the tray icon's own notifications without OPF being installed.
    if (process.platform === "win32") {
      tray.displayBalloon({ title: news.title, content: news.body, iconType: "custom", icon: nativeImage.createFromPath(opts.icon), respectQuietTime: true });
    } else if (Notification.isSupported()) {
      const n = new Notification({ title: news.title, body: news.body, icon: opts.icon });
      n.on("click", showPopup);
      n.show();
    }
  }

  let before: Record<string, PrinterStatus> | null = null;
  const update = (snap: Snapshot) => {
    tray.setToolTip(`OPF · ${farmSummary(snap)}`);
    for (const news of farmNews(before, snap)) notify(news);
    before = statuses(snap);
  };
  update(farm.snapshot());
  farm.subscribe(update);

  return { hidePopup: () => popup?.hide() };
}

/** OPF Slicer, once it has said where it is (it writes slicer.json in OPF's settings folder). */
export function slicerExe(): string | null {
  try {
    const { exe } = JSON.parse(readFileSync(join(app.getPath("userData"), "slicer.json"), "utf8")) as { exe?: unknown };
    return typeof exe === "string" && existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}
