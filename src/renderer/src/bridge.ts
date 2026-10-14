// The window talks to OPF through `window.opf` in the desktop app. Opened in
// a plain browser there is no Electron, so the same API is provided by a farm
// of simulated printers running right here in the page.

import { demoFactory, demoFarm } from "../../core/demo";
import { FarmService } from "../../core/farm";
import type { OpfApi, Result } from "../../preload/api";

declare global {
  interface Window {
    opf?: OpfApi;
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
    isDemo: true,
  };
}

/**
 * The farm page served by OPF's own web server: in a browser, on a phone, or
 * in OrcaSlicer's Device tab. It reads and changes the real farm over HTTP.
 */
function httpBridge(): OpfApi {
  // Keeps ?token=… from the page's address, for opening the farm from another device.
  const api = (p: string) => `${location.origin}/api/v1/ui/${p}${location.search}`;
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
    updateState: async () => null,
    onUpdateReady: () => () => {},
    whatsNew: async () => [],
    restart: async () => {},
    isDemo: false,
  };
}

declare const __OPF_DEMO__: boolean;

export const opf: OpfApi = window.opf ?? (__OPF_DEMO__ ? browserDemo() : httpBridge());

/** In OrcaSlicer's Device tab for one printer (…/octo/<id>/), that printer. */
export const printerFromAddress: string | null = (() => {
  const m = /^\/octo\/([^/]+)/.exec(location.pathname);
  return m ? decodeURIComponent(m[1]) : null;
})();
