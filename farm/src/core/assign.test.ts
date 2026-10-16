import { describe, expect, it } from "vitest";
import { bestPrinter, wrongPrinter } from "./assign";
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

describe("plates sliced for another printer", () => {
  const plate = (slicedFor?: string) => ({ name: "Clip", slicedFor });
  it("refuses another Bambu Lab model, and says what to do", () => {
    expect(wrongPrinter(plate("Bambu Lab A1"), { name: "Mini 1", model: "Bambu Lab A1 mini" })).toBe(
      "Clip was sliced for a Bambu Lab A1, but Mini 1 is a Bambu Lab A1 mini. Slice it again for the Bambu Lab A1 mini.",
    );
  });
  it("takes the same model, one machine under two names, and plates it cannot tell about", () => {
    expect(wrongPrinter(plate("Bambu Lab A1 mini"), { name: "m", model: "Bambu Lab A1 mini" })).toBeNull();
    expect(wrongPrinter(plate("Bambu Lab X1"), { name: "x", model: "Bambu Lab X1 Carbon" })).toBeNull();
    expect(wrongPrinter(plate("Bambu Lab P1P"), { name: "p", model: "Bambu Lab P1S" })).toBeNull();
    expect(wrongPrinter(plate(), { name: "m", model: "Bambu Lab A1 mini" })).toBeNull();
    expect(wrongPrinter(plate("Voron 2.4 350"), { name: "v", model: "Prusa MK4S" })).toBeNull();
  });
  it("never picks a printer of another model", () => {
    const data = emptyFarm();
    data.printers = [
      { id: "a1", name: "A1", model: "Bambu Lab A1", driver: "simulator" },
      { id: "mini", name: "Mini", model: "Bambu Lab A1 mini", driver: "simulator" },
    ];
    const live = { a1: { ...emptyLive(), status: "idle" as const }, mini: { ...emptyLive(), status: "idle" as const } };
    expect(bestPrinter(data, live, { filaments: [], slicedFor: "Bambu Lab A1 mini" })).toBe("mini");
    expect(bestPrinter(data, live, { filaments: [], slicedFor: "Bambu Lab H2D" })).toBeNull();
  });
});
