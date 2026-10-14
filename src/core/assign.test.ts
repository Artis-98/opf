import { describe, expect, it } from "vitest";
import { bestPrinter } from "./assign";
import { emptyFarm } from "./farm";
import { emptyLive } from "./driver";
import { amsOf } from "./simulator";
import type { PlateJob } from "./types";

const job = (minutes: number): PlateJob => ({ id: "j" + minutes, name: "x", ref: null, minutes, grams: 1, filaments: [], file: null, thumbnail: null, source: "estimate", createdAt: 0 });

describe("bestPrinter", () => {
  const data = emptyFarm();
  data.printers = ["a", "b", "c"].map((id) => ({ id, name: id, model: "Bambu Lab A1", driver: "simulator" as const }));
  data.queues = { a: [job(300)], b: [job(30)], c: [] };
  data.current = { a: null, b: null, c: null };
  const now = new Date(2026, 9, 14, 10, 0);
  const live = {
    a: { ...emptyLive("idle"), ams: amsOf(["#000000", "PLA"]) },
    b: { ...emptyLive("idle"), ams: amsOf(["#000000", "PLA"]) },
    c: { ...emptyLive("offline"), ams: amsOf(["#000000", "PLA"]) },
  };

  it("picks the printer free soonest, skipping offline ones", () => {
    expect(bestPrinter(data, live, { filaments: [] }, now)).toBe("b");
  });

  it("prefers a printer that has the filament loaded, even if it is free later", () => {
    const l = { ...live, b: { ...emptyLive("idle"), ams: amsOf(["#FFFFFF", "PLA"]) } };
    expect(bestPrinter(data, l, { filaments: [{ color: "#000000", material: "PLA", grams: 5 }] }, now)).toBe("a");
  });

  it("falls back to the soonest free when nobody has the filament", () => {
    expect(bestPrinter(data, live, { filaments: [{ color: "#FF0000", material: "PETG", grams: 5 }] }, now)).toBe("b");
  });

  it("returns null when every printer is offline", () => {
    expect(bestPrinter(data, { a: emptyLive("offline") }, { filaments: [] }, now)).toBeNull();
  });
});
