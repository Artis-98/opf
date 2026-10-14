import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyFarm, FarmService } from "./farm";
import { SimulatedPrinter } from "./simulator";
import type { DriverFactory } from "./driver";
import type { FarmData, PlateJob } from "./types";

const plate = (name: string, minutes = 1): Omit<PlateJob, "id" | "createdAt"> => ({
  name, ref: null, minutes, grams: 5, filaments: [], file: null, thumbnail: null, source: "estimate",
});

function setup(data: FarmData = emptyFarm()) {
  const saved: FarmData[] = [];
  const factory: DriverFactory = (cfg, emit) => new SimulatedPrinter(cfg, emit, { status: "idle" }, 60);
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
});
