// What OPF needs from a printer, whatever brand it is.
//
// One driver per printer. A driver reports state through `emit` whenever it
// learns something, as a partial update; the farm merges it. Commands return
// promises that reject with a sentence the operator can act on.

import type { PrintOptions } from "./print-options";
import type { LiveState, PlateJob, PrinterConfig } from "./types";

export interface StartOptions {
  /** Start even though a filament is not loaded in its colour: the operator said so. */
  anyFilament?: boolean;
  /** Bed levelling, flow calibration and the rest, as chosen for this printer. Unset: OPF's defaults. */
  print?: PrintOptions;
}

export interface PrinterDriver {
  connect(): void;
  disconnect(): void;
  /** Send a sliced plate to the printer and start it. */
  start(job: PlateJob, opts?: StartOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export type Emit = (patch: Partial<LiveState>) => void;
export type DriverFactory = (cfg: PrinterConfig, emit: Emit) => PrinterDriver;

export function emptyLive(status: LiveState["status"] = "offline"): LiveState {
  return {
    status,
    jobName: null,
    progress: 0,
    remainingSec: null,
    layer: null,
    totalLayers: null,
    nozzle: { current: 0, target: 0 },
    bed: { current: 0, target: 0 },
    ams: [],
    external: null,
    activeSlot: null,
    error: null,
    updatedAt: Date.now(),
  };
}

/** For printer types OPF lists but cannot talk to yet. */
export class NotYetSupported implements PrinterDriver {
  constructor(private cfg: PrinterConfig, private emit: Emit) {}
  connect() {
    this.emit({ status: "offline", error: `${this.cfg.driver} printers are not supported yet. The queue is kept for when they are.` });
  }
  disconnect() {}
  private no() {
    return Promise.reject(new Error(`OPF cannot control ${this.cfg.driver} printers yet.`));
  }
  start() { return this.no(); }
  pause() { return this.no(); }
  resume() { return this.no(); }
  stop() { return this.no(); }
}
