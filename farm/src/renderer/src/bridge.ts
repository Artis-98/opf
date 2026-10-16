// The window talks to OPF through `window.opf` in the desktop app. Opened in
// a plain browser there is no Electron, so the same API is provided by a farm
// of simulated printers running right here in the page.

import { demoFactory, demoFarm } from "../../core/demo";
import { FarmService } from "../../core/farm";
import type { Change, OpfApi, Result, UpdateInfo } from "../../preload/api";
import type { FoundPrinter } from "../../core/types";

declare global {
  interface Window {
    opf?: OpfApi;
    /** OPF Slicer's browser: messages to the slicer. */
    wx?: { postMessage(message: string): void };
    /** OPF Slicer calls this after sending a plate, to show it in its printer's queue. */
    opfShowJob?: (jobId: string) => void;
    /** OPF Slicer calls this to say something in the farm page, such as how many plates went where. */
    opfToast?: (text: string, error?: boolean) => void;
  }
}

function browserDemo(): OpfApi {
  let { data, scenarios } = demoFarm();
  const farm = new FarmService(data, demoFactory(scenarios), {
    persist: () => {},
    slicer: () => ({ found: false, name: null, path: null }),
    demo: true,
  });
  farm.start();
  return {
    snapshot: async () => farm.snapshot(),
    act: async (name, ...args): Promise<Result<unknown>> => {
      try {
        return { ok: true, value: await farm.act(name, args) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    onUpdate: (cb) => farm.subscribe(cb),
    openModels: null,
    pickProfile: null,
    slice: async () => ({ ok: false, error: "Slicing runs in the desktop app, with Bambu Studio or OrcaSlicer installed. The demo shows an estimate." }),
    loadDemo: async () => {
      ({ data, scenarios } = demoFarm());
      farm.replaceData(data);
    },
    updateState: async () => null,
    onUpdateReady: () => () => {},
    whatsNew: async () => [],
    restart: async () => {},
    // The demo finds two made-up printers, after a moment, the way a real search would.
    discover: () => new Promise((resolve) => setTimeout(() => resolve([
      { driver: "bambu", host: "192.168.1.61", name: "Bench A1", model: "Bambu Lab A1", serial: "03919D000000001" },
      { driver: "anycubic", host: "192.168.1.70", name: null, model: "Anycubic Kobra 3 Max", serial: "DEMO-0000-0000-0001" },
    ]), 1500)),
    isDemo: true,
  };
}

/**
 * The farm page served by OPF's own web server: in OPF Slicer's Farm and Timeline
 * tabs, in a browser, on a phone, or in OrcaSlicer's Device tab. It reads and
 * changes the real farm over HTTP.
 */
function httpBridge(): OpfApi {
  // Keeps ?token=… from the page's address, for opening the farm from another device.
  const api = (p: string) => `${location.origin}/api/v1/ui/${p}${location.search}`;
  const get = async <T,>(p: string, fallback: T): Promise<T> => {
    try {
      const r = await fetch(api(p));
      return r.ok ? ((await r.json()) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const nope = async () => ({ ok: false as const, error: "Slice in OrcaSlicer and send the plate to OPF from there." });
  return {
    snapshot: async () => (await fetch(api("snapshot"))).json(),
    act: async (name, ...args) => {
      try {
        const r = await fetch(api("act"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, args }) });
        return await r.json();
      } catch (e) {
        return { ok: false, error: `OPF is not answering: ${(e as Error).message}` };
      }
    },
    onUpdate: (cb) => {
      const es = new EventSource(api("events"));
      es.onmessage = (m) => cb(JSON.parse(m.data));
      return () => es.close();
    },
    openModels: null,
    pickProfile: null,
    slice: nope,
    loadDemo: async () => {
      await fetch(api("act"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "replaceData", args: [demoFarm().data] }) });
    },
    updateState: () => get<UpdateInfo | null>("update", null),
    discover: () => get<FoundPrinter[]>("discover", []),
    onUpdateReady: (cb) => {
      const t = setInterval(async () => {
        const u = await get<UpdateInfo | null>("update", null);
        if (u) cb(u);
      }, 60_000);
      return () => clearInterval(t);
    },
    whatsNew: () => get<Change[]>("whats-new", []),
    restart: async () => {
      try {
        await fetch(api("restart"), { method: "POST" });
      } catch { /* already going */ }
      // OPF closes, updates and starts again. Load the new page once it answers.
      let down = false, tries = 0;
      const t = setInterval(async () => {
        const up = await fetch(api("snapshot")).then((r) => r.ok, () => false);
        if (!up) down = true;
        if ((up && down) || ++tries > 150) {
          clearInterval(t);
          if (up && down) location.reload();
        }
      }, 2000);
    },
    isDemo: false,
  };
}

declare const __OPF_DEMO__: boolean;

export const opf: OpfApi = window.opf ?? (__OPF_DEMO__ ? browserDemo() : httpBridge());

const params = new URLSearchParams(location.search);

/** In OPF Slicer's Farm or Timeline tab (…/?embed=farm): the page shows only that view. */
export const embedded: "farm" | "timeline" | null = ((v) => (v === "farm" || v === "timeline" ? v : null))(params.get("embed"));

/** The small OPF that opens from its icon by the clock (…/index.html?mini=1). */
export const mini = params.get("mini") === "1";

/** The slicer's light or dark look, when the page is in it. */
export const slicerTheme: string | null = embedded ? params.get("theme") : null;

/** Tells OPF Slicer something: edit a plate, which printer Send to farm is for. False outside it. */
export function toSlicer(message: Record<string, unknown>): boolean {
  if (!embedded || !window.wx) return false;
  window.wx.postMessage(JSON.stringify(message));
  return true;
}

/** In OrcaSlicer's Device tab for one printer (…/octo/<id>/), that printer. */
export const printerFromAddress: string | null = (() => {
  const m = /^\/octo\/([^/]+)/.exec(location.pathname);
  return m ? decodeURIComponent(m[1]) : null;
})();
