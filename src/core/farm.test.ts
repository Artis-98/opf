import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyFarm, FarmService } from "./farm";
import { SimulatedPrinter, simulatorFor } from "./simulator";
import type { DriverFactory, PrinterDriver } from "./driver";
import { displayStatus } from "./status";
import type { FarmData, PlateJob, PrinterConfig } from "./types";

const plate = (name: string, minutes = 1): Omit<PlateJob, "id" | "createdAt"> => ({
  name, ref: null, minutes, grams: 5, filaments: [], file: null, thumbnail: null, source: "estimate",
});
const plateJob = (name: string): PlateJob => ({ ...plate(name), id: `j-${name}`, createdAt: 0 } as PlateJob);

function setup(data: FarmData = emptyFarm()) {
  const saved: FarmData[] = [];
  const factory: DriverFactory = (cfg, emit) => simulatorFor(cfg, emit, 60);
  const farm = new FarmService(data, factory, { persist: (d) => saved.push(structuredClone(d)), slicer: () => ({ found: false, name: null, path: null }) });
  farm.start();
  return { farm, saved };
}

afterEach(() => vi.useRealTimers());

describe("FarmService", () => {
  it("puts a new printer in the first free slot and saves", () => {
    const { farm, saved } = setup();
    const id = farm.addPrinter({ name: "P1S-01", model: "Bambu Lab P1S", driver: "simulator" });
    const snap = farm.snapshot();
    expect(snap.data.shelves[0].slots[0]).toBe(id);
    expect(snap.data.queues[id]).toEqual([]);
    expect(saved.length).toBeGreaterThan(0);
    farm.shutdown();
  });

  it("starts each plate with the printer's own choice of bed levelling and calibrations", async () => {
    const started: unknown[] = [];
    const data = emptyFarm();
    const farm = new FarmService(data, (cfg, emit): PrinterDriver => {
      const d = simulatorFor(cfg, emit, 60);
      return {
        connect: () => d.connect(), disconnect: () => d.disconnect(), pause: () => d.pause(), resume: () => d.resume(), stop: () => d.stop(),
        start: (job, opts) => { started.push(opts?.print); return d.start(job); },
      };
    }, { persist: () => {}, slicer: () => ({ found: false, name: null, path: null }) });
    farm.start();
    const a = farm.addPrinter({ name: "A", model: "m", driver: "simulator" });
    const b = farm.addPrinter({ name: "B", model: "m", driver: "simulator" });
    farm.updatePrinter(b, { printOptions: { bedLevelling: false, flowCalibration: true } });
    farm.enqueue(a, plate("first", 1));
    farm.enqueue(b, plate("second", 1));
    await farm.startNext(a);
    await farm.startNext(b);
    expect(started).toEqual([
      { bedLevelling: true, flowCalibration: false, vibrationCompensation: false, timelapse: false },
      { bedLevelling: false, flowCalibration: true, vibrationCompensation: false, timelapse: false },
    ]);
    farm.shutdown();
  });

  it("shows a plate as sending while it goes to the printer, then as started", async () => {
    let arrived!: () => void;
    let report!: (fraction: number) => void;
    const farm = new FarmService(emptyFarm(), (cfg, emit): PrinterDriver => {
      const d = simulatorFor(cfg, emit, 60);
      return {
        connect: () => d.connect(), disconnect: () => d.disconnect(), pause: () => d.pause(), resume: () => d.resume(), stop: () => d.stop(),
        start: (job, opts) => { report = opts!.onProgress!; return new Promise<void>((r) => { arrived = r; }).then(() => d.start(job)); },
      };
    }, { persist: () => {}, slicer: () => ({ found: false, name: null, path: null }) });
    farm.start();
    const a = farm.addPrinter({ name: "A", model: "m", driver: "simulator" });
    farm.enqueue(a, plate("big", 1));
    farm.enqueue(a, plate("after", 1));
    const started = farm.startNext(a);
    expect(farm.snapshot().live[a].sending).toEqual({ job: "big", progress: null });
    expect(displayStatus(farm.snapshot().live[a], null)).toBe("sending");
    report(0.4);
    expect(farm.snapshot().live[a].sending).toEqual({ job: "big", progress: 0.4 });
    await expect(farm.startNext(a)).rejects.toThrow(/still receiving big/);
    arrived();
    await started;
    expect(farm.snapshot().live[a].sending).toBeNull();
    expect(farm.snapshot().data.current[a]?.name).toBe("big");
    expect(farm.snapshot().data.queues[a].map((j) => j.name)).toEqual(["after"]);
    farm.shutdown();
  });

  it("keeps the plate queued and stops showing it as sending when the upload fails", async () => {
    const farm = new FarmService(emptyFarm(), (cfg, emit): PrinterDriver => {
      const d = simulatorFor(cfg, emit, 60);
      return {
        connect: () => d.connect(), disconnect: () => d.disconnect(), pause: () => d.pause(), resume: () => d.resume(), stop: () => d.stop(),
        start: () => Promise.reject(new Error("Could not upload big to A: connection refused")),
      };
    }, { persist: () => {}, slicer: () => ({ found: false, name: null, path: null }) });
    farm.start();
    const a = farm.addPrinter({ name: "A", model: "m", driver: "simulator" });
    farm.enqueue(a, plate("big", 1));
    await expect(farm.startNext(a)).rejects.toThrow(/Could not upload/);
    expect(farm.snapshot().live[a].sending).toBeNull();
    expect(displayStatus(farm.snapshot().live[a], null)).toBe("idle");
    expect(farm.snapshot().data.queues[a].map((j) => j.name)).toEqual(["big"]);
    farm.shutdown();
  });

  it("takes a moment to send a plate to a simulated printer, reporting how much has gone", async () => {
    vi.useFakeTimers();
    const sim = new SimulatedPrinter({ id: "s", name: "S", model: "m", driver: "simulator" } as PrinterConfig, () => {}, { status: "idle" }, 1, 1);
    const seen: number[] = [];
    const started = sim.start(plateJob("big"), { onProgress: (f) => seen.push(f) });
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    expect(seen).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  it("swaps two printers when one is dropped on the other's slot", () => {
    const { farm } = setup();
    const a = farm.addPrinter({ name: "A", model: "m", driver: "simulator" });
    const b = farm.addPrinter({ name: "B", model: "m", driver: "simulator" });
    farm.placePrinter(b, "shelf-a", 0);
    expect(farm.snapshot().data.shelves[0].slots.slice(0, 2)).toEqual([b, a]);
    farm.shutdown();
  });

  it("queues at the end or next, reorders and moves plates between printers", () => {
    const { farm } = setup();
    const a = farm.addPrinter({ name: "A", model: "m", driver: "simulator" });
    const b = farm.addPrinter({ name: "B", model: "m", driver: "simulator" });
    farm.enqueue(a, plate("one"));
    farm.enqueue(a, plate("two"));
    farm.enqueue(a, plate("zero"), "next");
    expect(farm.snapshot().data.queues[a].map((j) => j.name)).toEqual(["zero", "one", "two"]);
    farm.reorder(a, 0, 2);
    expect(farm.snapshot().data.queues[a].map((j) => j.name)).toEqual(["one", "two", "zero"]);
    farm.transfer(a, 1, b);
    expect(farm.snapshot().data.queues[a].map((j) => j.name)).toEqual(["one", "zero"]);
    expect(farm.snapshot().data.queues[b].map((j) => j.name)).toEqual(["two"]);
    farm.shutdown();
  });

  it("starts the next plate, finishes it, and waits for the bed to be cleared", async () => {
    vi.useFakeTimers();
    const { farm } = setup();
    const a = farm.addPrinter({ name: "A", model: "m", driver: "simulator" });
    farm.enqueue(a, plate("first", 1));
    farm.enqueue(a, plate("second", 1));
    await farm.startNext(a);
    let snap = farm.snapshot();
    expect(snap.data.current[a]?.name).toBe("first");
    expect(snap.data.queues[a].map((j) => j.name)).toEqual(["second"]);
    await expect(farm.startNext(a)).rejects.toThrow(/bed is clear/);

    vi.advanceTimersByTime(10_000); // simulator at 60× speed: heats, then a 1-minute plate takes 1 s
    snap = farm.snapshot();
    expect(snap.live[a].status).toBe("finished");

    await farm.clearBed(a, true);
    snap = farm.snapshot();
    expect(snap.data.current[a]?.name).toBe("second");
    expect(snap.data.history[0]).toMatchObject({ printerId: a, outcome: "done" });
    farm.shutdown();
  });

  it("refuses to send an unsliced plate to a real printer", async () => {
    const data = emptyFarm();
    const saved: FarmData[] = [];
    const factory: DriverFactory = (cfg, emit) => new SimulatedPrinter(cfg, emit, { status: "idle" });
    const farm = new FarmService(data, factory, { persist: (d) => saved.push(d), slicer: () => ({ found: false, name: null, path: null }) });
    farm.start();
    const a = farm.addPrinter({ name: "A", model: "m", driver: "bambu" });
    farm.enqueue(a, plate("rough"));
    await expect(farm.startNext(a)).rejects.toThrow(/Slice this plate/);
    farm.shutdown();
  });

  it("keeps a removed printer's plates in the inbox", () => {
    const { farm } = setup();
    const a = farm.addPrinter({ name: "A", model: "m", driver: "simulator" });
    farm.enqueue(a, plate("orphan", 42));
    farm.removePrinter(a);
    const snap = farm.snapshot();
    expect(snap.data.printers).toEqual([]);
    expect(snap.data.inbox[0].name).toBe("orphan");
    expect(snap.data.shelves[0].slots.every((s) => s === null)).toBe(true);
    farm.shutdown();
  });

  it("only runs listed actions", async () => {
    const { farm } = setup();
    await expect(farm.act("shutdown", [])).rejects.toThrow(/Unknown action/);
    await expect(farm.act("addShelf", ["Wall"])).resolves.toBeTypeOf("string");
    expect(farm.snapshot().data.shelves.map((s) => s.name)).toContain("Wall");
    farm.shutdown();
  });

  it("will not remove a shelf with printers on it", () => {
    const { farm } = setup();
    farm.addPrinter({ name: "A", model: "m", driver: "simulator" });
    expect(() => farm.removeShelf("shelf-a")).toThrow(/Move the printers/);
    farm.shutdown();
  });

  it("fills in settings missing from an older farm file", () => {
    const old = emptyFarm() as unknown as Record<string, unknown>;
    old.settings = { workStart: 7 };
    const { farm } = setup(old as unknown as FarmData);
    const s = farm.snapshot().data.settings;
    expect(s.workStart).toBe(7);
    expect(s.workEnd).toBe(20);
    expect(s.api.port).toBe(7878);
    farm.shutdown();
  });

  it("adds an A1 and an A1 mini test printer on their own shelf, ready to print", async () => {
    vi.useFakeTimers();
    const { farm } = setup();
    const real = farm.addPrinter({ name: "Real P1S", model: "Bambu Lab P1S", driver: "simulator" });
    const [a1, mini] = farm.addTestPrinters();
    const snap = farm.snapshot();
    const shelf = snap.data.shelves.find((s) => s.name.startsWith("Test shelf"))!;
    expect(shelf.slots.slice(0, 2)).toEqual([a1, mini]);
    expect(snap.data.printers.map((p) => p.id)).toContain(real);
    expect(snap.data.printers.find((p) => p.id === mini)!.model).toBe("Bambu Lab A1 mini");
    expect(snap.data.queues[a1]).toHaveLength(2);
    expect(snap.data.queues[mini]).toHaveLength(2);
    // Their AMS colours come from their settings, so queued plates find their filament.
    vi.advanceTimersByTime(1000);
    expect(farm.snapshot().live[mini].ams[0].slots[0].color).toBe("#D63A2F");
    await farm.startNext(mini);
    expect(farm.snapshot().data.current[mini]?.name).toBe("Calibration plate");
    farm.shutdown();
  });
});

describe("a printer that keeps saying finished", () => {
  // Bambu Lab printers report FINISH until the next print starts, every few seconds.
  function withFakePrinter() {
    let emit: (patch: object) => void = () => {};
    const factory: DriverFactory = (_cfg, e) => {
      emit = e;
      return { connect() {}, disconnect() {}, start: async () => {}, pause: async () => {}, resume: async () => {}, stop: async () => {} };
    };
    const saved: FarmData[] = [];
    const farm = new FarmService(emptyFarm(), factory, { persist: (d) => saved.push(structuredClone(d)), slicer: () => ({ found: false, name: null, path: null }) });
    farm.start();
    const id = farm.addPrinter({ name: "A1", model: "Bambu Lab A1", driver: "bambu" });
    const status = () => farm.snapshot().live[id].status;
    return { farm, id, saved, status, report: (status: string, jobName = "Clips") => emit({ status, jobName }) };
  }

  it("stays idle once the bed is cleared, until it starts a new print", async () => {
    const { farm, id, saved, status, report } = withFakePrinter();
    report("finished");
    expect(status()).toBe("finished");
    await farm.clearBed(id);
    report("finished");
    expect(status()).toBe("idle");
    expect(saved.at(-1)!.bedCleared).toEqual({ [id]: "Clips" }); // also after OPF restarts

    report("preparing", "Brackets");
    report("printing", "Brackets");
    report("finished", "Brackets");
    expect(status()).toBe("finished");
    expect(saved.at(-1)!.bedCleared).toEqual({});
    farm.shutdown();
  });

  it("still says so when a different print finished", async () => {
    const { farm, id, status, report } = withFakePrinter();
    report("finished", "Clips");
    await farm.clearBed(id);
    report("finished", "Started on the printer's screen");
    expect(status()).toBe("finished");
    farm.shutdown();
  });
});

describe("duplicating a plate", () => {
  it("puts copies right after it, each its own plate on the same files", () => {
    const { farm } = setup();
    const a = farm.addPrinter({ name: "A1", model: "m", driver: "simulator" });
    farm.enqueue(a, { ...plate("Clips"), file: "/u/clips.gcode.3mf", project: "/u/clips.3mf" });
    farm.enqueue(a, plate("Lid"));
    const ids = farm.duplicateQueued(a, 0, 2);
    const q = farm.snapshot().data.queues[a];
    expect(q.map((j) => j.name)).toEqual(["Clips", "Clips", "Clips", "Lid"]);
    expect(new Set(q.map((j) => j.id)).size).toBe(4);
    expect(q.slice(1, 3).map((j) => j.id)).toEqual(ids);
    expect(farm.fileInUse("/u/clips.3mf")).toBe(true);
    farm.dequeue(a, 0); farm.dequeue(a, 0);
    expect(farm.fileInUse("/u/clips.gcode.3mf")).toBe(true);
    farm.dequeue(a, 0);
    expect(farm.fileInUse("/u/clips.gcode.3mf")).toBe(false);
    farm.shutdown();
  });
});
