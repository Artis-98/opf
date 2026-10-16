// Everything that runs OPF's farm, without a window: the farm itself, saving
// it, the local web server, fetching work from admin.iiteg. The desktop app
// (src/main/index.ts) and the headless server (src/server/index.ts) both
// start OPF through this.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";
import { FarmService } from "../core/farm";
import { schedulePrinter } from "../core/schedule";
import type { DriverFactory } from "../core/driver";
import type { SlicerInfo } from "../core/types";
import type { Result } from "../preload/api";
import { findSlicer } from "./slicer";
import { loadFarm, makeSaver } from "./store";
import { startApi, stopApi, type UpdateHooks } from "./api";
import { reportStatus, startInboxSource, stopInboxSource } from "./inbox-source";

export interface Host {
  farm: FarmService;
  /** Runs an action the way a window asks for it, with its side effects. */
  runAction(name: string, args: unknown[]): Promise<Result<unknown>>;
  slicer(): SlicerInfo;
  shutdown(): void;
}

export function startHost(opts: { dataDir: string; factory: DriverFactory; uiRoot: string | null; host?: string; updates?: UpdateHooks }): Host {
  const file = join(opts.dataDir, "farm.json");
  const saver = makeSaver(file);
  let slicer = findSlicer(null);
  const farm = new FarmService(loadFarm(file), opts.factory, { persist: (d) => saver.save(d), slicer: () => slicer });
  slicer = findSlicer(farm.settings.slicerPath);
  farm.start();

  const uiRoot = opts.uiRoot && existsSync(join(opts.uiRoot, "index.html")) ? opts.uiRoot : null;
  let api: Server | null = null;
  const serve = () => {
    stopApi(api);
    api = startApi(farm, { host: opts.host, uiRoot, uploads: join(opts.dataDir, "uploads"), act: runAction, updates: opts.updates });
  };

  async function runAction(name: string, args: unknown[]): Promise<Result<unknown>> {
    try {
      const value = await farm.act(name, args);
      if (name === "updateSettings") {
        // Settings that change what runs in the background take effect at once.
        slicer = findSlicer(farm.settings.slicerPath);
        setTimeout(serve, 100); // after this request's answer has gone out
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
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message ?? String(e) };
    }
  }

  serve();
  startInboxSource(farm);

  return {
    farm,
    runAction,
    slicer: () => slicer,
    shutdown() {
      stopInboxSource();
      stopApi(api);
      farm.shutdown();
      saver.flush();
    },
  };
}
