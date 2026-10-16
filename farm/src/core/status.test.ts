import { describe, expect, it } from "vitest";
import { emptyFarm } from "./farm";
import { emptyLive } from "./driver";
import { farmNews, farmSummary, statuses } from "./status";
import type { LiveState, PlateJob, PrinterStatus, Snapshot } from "./types";

const plate = (name: string): PlateJob => ({ id: name, name, ref: null, minutes: 10, grams: 1, filaments: [], file: null, thumbnail: null, source: "estimate", createdAt: 0 });

function snapshot(status: PrinterStatus, opts: { current?: string; next?: string; error?: string } = {}): Snapshot {
  const data = emptyFarm();
  data.printers = [{ id: "m", name: "A1 mini", model: "Bambu Lab A1 mini", driver: "simulator" }];
  data.current = { m: opts.current ? plate(opts.current) : null };
  data.queues = { m: opts.next ? [plate(opts.next)] : [] };
  const live: LiveState = { ...emptyLive(), status, error: opts.error ?? null };
  return { data, live: { m: live }, slicer: { found: false, name: null, path: null } } as unknown as Snapshot;
}

describe("news from the farm", () => {
  it("says nothing on the first look", () => {
    expect(farmNews(null, snapshot("idle", { current: "Clips" }))).toEqual([]);
  });

  it("says when a print finished, and what starts next once the bed is clear", () => {
    const before = statuses(snapshot("printing", { current: "Clips" }));
    expect(farmNews(before, snapshot("idle", { current: "Clips", next: "Brackets" }))).toEqual([
      { printerId: "m", title: "A1 mini finished", body: "Clips is done. Clear the bed to start Brackets." },
    ]);
    expect(farmNews(before, snapshot("idle", { current: "Clips" }))[0].body).toBe("Clips is done. Clear the bed.");
  });

  it("says when a printer stops with an error or is paused", () => {
    const before = statuses(snapshot("printing", { current: "Clips" }));
    expect(farmNews(before, snapshot("error", { current: "Clips", error: "Filament ran out." }))).toEqual([
      { printerId: "m", title: "A1 mini needs you", body: "Filament ran out." },
    ]);
    expect(farmNews(before, snapshot("paused", { current: "Clips" }))[0].title).toBe("A1 mini is paused");
  });

  it("stays quiet when nothing changed, or a printer just comes online", () => {
    const printing = snapshot("printing", { current: "Clips" });
    expect(farmNews(statuses(printing), printing)).toEqual([]);
    expect(farmNews(statuses(snapshot("offline")), snapshot("idle"))).toEqual([]);
  });

  it("sums the farm up for the tray icon", () => {
    expect(farmSummary(snapshot("printing", { current: "Clips" }))).toBe("1 printing");
    expect(farmSummary(snapshot("idle", { current: "Clips" }))).toBe("0 printing · 1 needs you");
  });
});
