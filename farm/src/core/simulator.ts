// A printer that only exists in software: for the demo, for screenshots, and
// for trying OPF before pointing it at real machines. It behaves like a Bambu
// printer would: heats, prints, finishes and then waits with parts on the bed.

import type { Emit, PrinterDriver } from "./driver";
import type { AmsUnit, LiveState, PlateJob, PrinterConfig } from "./types";

export interface SimScenario {
  status?: LiveState["status"];
  jobName?: string;
  totalSec?: number;
  remainingSec?: number;
  error?: string | null;
  ams?: AmsUnit[];
  nozzleTarget?: number;
  bedTarget?: number;
}

export function amsOf(...slots: [color: string, material: string, remain?: number][]): AmsUnit[] {
  return [{
    id: 0,
    humidity: 22,
    tempC: 26,
    slots: slots.map(([color, material, remain], i) => ({ unit: 0, slot: i, color, material, remainPct: remain ?? null })),
  }];
}

export class SimulatedPrinter implements PrinterDriver {
  private timer: ReturnType<typeof setInterval> | null = null;
  private s: LiveState;
  private total = 0;

  private speedOf: () => number;

  constructor(_cfg: PrinterConfig, private emit: Emit, scenario: SimScenario = {}, speed: number | (() => number) = 1) {
    this.speedOf = typeof speed === "number" ? () => speed : speed;
    const printing = scenario.status === "printing" || scenario.status === "paused" || scenario.status === "error";
    this.total = scenario.totalSec ?? 0;
    const remaining = scenario.remainingSec ?? null;
    this.s = {
      status: scenario.status ?? "idle",
      jobName: scenario.jobName ?? null,
      progress: printing && this.total ? 1 - (remaining ?? 0) / this.total : scenario.status === "finished" ? 1 : 0,
      remainingSec: printing ? remaining : scenario.status === "finished" ? 0 : null,
      layer: null,
      totalLayers: null,
      nozzle: { current: printing ? scenario.nozzleTarget ?? 220 : 28, target: printing ? scenario.nozzleTarget ?? 220 : 0 },
      bed: { current: printing ? scenario.bedTarget ?? 60 : 25, target: printing ? scenario.bedTarget ?? 60 : 0 },
      ams: scenario.ams ?? amsOf(["#202224", "PLA"], ["#F1F1EE", "PLA"], ["#00AE42", "PLA"], ["#F47B20", "PLA"]),
      external: null,
      activeSlot: printing ? "0:0" : null,
      error: scenario.error ?? null,
      updatedAt: Date.now(),
    };
    this.setLayers();
    if (scenario.status === "paused") this.s.nozzle.current = 160;
  }

  private setLayers() {
    if (this.total) {
      this.s.totalLayers = Math.max(20, Math.round(this.total / 75));
      this.s.layer = Math.round(this.s.progress * this.s.totalLayers);
    }
  }

  connect() {
    this.emit({ ...this.s });
    this.timer = setInterval(() => this.tick(), 1000);
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private get speed() {
    return Math.max(1, this.speedOf() || 1);
  }

  private tick() {
    if (this.s.status === "preparing") {
      this.s.nozzle.current = Math.min(this.s.nozzle.target, this.s.nozzle.current + 25 * this.speed);
      this.s.bed.current = Math.min(this.s.bed.target, this.s.bed.current + 6 * this.speed);
      if (this.s.nozzle.current >= this.s.nozzle.target && this.s.bed.current >= this.s.bed.target) this.s.status = "printing";
    } else if (this.s.status === "printing" && this.s.remainingSec !== null) {
      this.s.remainingSec = Math.max(0, this.s.remainingSec - this.speed);
      this.s.progress = this.total ? 1 - this.s.remainingSec / this.total : 1;
      this.setLayers();
      if (this.s.remainingSec === 0) {
        this.s.status = "finished";
        this.s.nozzle = { current: 60, target: 0 };
        this.s.bed = { current: 45, target: 0 };
        this.s.activeSlot = null;
      }
    } else if (this.s.status === "finished" || this.s.status === "idle") {
      this.s.nozzle.current = Math.max(26, this.s.nozzle.current - 2);
      this.s.bed.current = Math.max(25, this.s.bed.current - 0.5);
    } else {
      return;
    }
    this.s.updatedAt = Date.now();
    this.emit({ ...this.s, nozzle: { ...this.s.nozzle }, bed: { ...this.s.bed } });
  }

  async start(job: PlateJob) {
    if (this.s.status === "printing" || this.s.status === "preparing" || this.s.status === "paused") throw new Error("The printer is busy.");
    this.total = Math.max(60, Math.round(job.minutes * 60));
    Object.assign(this.s, {
      status: "preparing", jobName: job.name, progress: 0, remainingSec: this.total, error: null,
      nozzle: { current: this.s.nozzle.current, target: 220 }, bed: { current: this.s.bed.current, target: 60 }, activeSlot: "0:0",
    });
    this.setLayers();
    this.emit({ ...this.s });
  }

  async pause() {
    if (this.s.status !== "printing") throw new Error("Nothing is printing.");
    this.s.status = "paused";
    this.emit({ status: "paused" });
  }

  async resume() {
    if (this.s.status !== "paused" && this.s.status !== "error") throw new Error("The printer is not paused.");
    this.s.status = "printing";
    this.s.error = null;
    this.emit({ status: "printing", error: null });
  }

  async stop() {
    Object.assign(this.s, { status: "idle", jobName: null, progress: 0, remainingSec: null, error: null, activeSlot: null, layer: null, totalLayers: null });
    this.s.nozzle.target = 0;
    this.s.bed.target = 0;
    this.emit({ ...this.s });
  }
}

/** The simulator for a printer added in OPF, with the AMS colours saved in its settings. */
export function simulatorFor(cfg: PrinterConfig, emit: Emit, speed: number | (() => number), scenario?: SimScenario): SimulatedPrinter {
  const ams = cfg.sim?.ams?.length ? amsOf(...cfg.sim.ams.map((a) => [a.color, a.material] as [string, string])) : undefined;
  return new SimulatedPrinter(cfg, emit, scenario ?? { status: "idle", ams }, speed);
}
