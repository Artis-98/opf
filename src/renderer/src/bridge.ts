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
    isDemo: true,
  };
}

export const opf: OpfApi = window.opf ?? browserDemo();
