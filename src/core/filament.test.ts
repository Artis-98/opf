import { describe, expect, it } from "vitest";
import { emptyLive } from "./driver";
import { colorDistance, filamentOk, materialFamily, matchFilaments, SAME_COLOR } from "./filament";
import { amsOf } from "./simulator";

const live = (...slots: [string, string, number?][]) => ({ ...emptyLive("idle"), ams: amsOf(...slots) });

describe("materialFamily", () => {
  it("groups variants under their base material", () => {
    expect(materialFamily("PLA Matte")).toBe("PLA");
    expect(materialFamily("PLA Basic")).toBe("PLA");
    expect(materialFamily("PETG-CF")).toBe("PETG");
    expect(materialFamily("Generic ABS")).toBe("ABS");
    expect(materialFamily("PA6-CF")).toBe("PA");
    expect(materialFamily("PLA-CF")).toBe("PLA");
    expect(materialFamily(null)).toBeNull();
  });
});

describe("colorDistance", () => {
  it("calls slightly different blacks the same colour", () => {
    expect(colorDistance("#000000", "#1A1A1A")).toBeLessThan(SAME_COLOR);
    expect(colorDistance("#161616", "#202224")).toBeLessThan(SAME_COLOR);
  });
  it("tells black, grey and white apart", () => {
    expect(colorDistance("#000000", "#8E9399")).toBeGreaterThan(SAME_COLOR);
    expect(colorDistance("#F1F1EE", "#8E9399")).toBeGreaterThan(SAME_COLOR);
  });
  it("tells red and orange apart", () => {
    expect(colorDistance("#D63A2F", "#F47B20")).toBeGreaterThan(SAME_COLOR);
  });
  it("is infinite for missing colours", () => {
    expect(colorDistance("#000000", "nonsense")).toBe(Infinity);
  });
});

describe("matchFilaments", () => {
  const plate = { filaments: [{ color: "#000000", material: "PLA", grams: 30 }, { color: "#F1F1EE", material: "PLA", grams: 5 }] };

  it("finds each colour in a different slot", () => {
    const m = matchFilaments(plate, live(["#F1F1EE", "PLA Matte"], ["#1A1A1A", "PLA Basic"]));
    expect(m.map((x) => x.slot?.slot)).toEqual([1, 0]);
    expect(m.every((x) => x.problem === null)).toBe(true);
  });

  it("does not use one slot for two needs", () => {
    const m = matchFilaments({ filaments: [{ color: "#000000", material: "PLA", grams: 1 }, { color: "#050505", material: "PLA", grams: 1 }] }, live(["#000000", "PLA"]));
    expect(m[0].slot).not.toBeNull();
    expect(m[1].slot).toBeNull();
  });

  it("says when the colour is loaded but in the wrong material", () => {
    const m = matchFilaments({ filaments: [{ color: "#000000", material: "PETG", grams: 1 }] }, live(["#000000", "PLA"]));
    expect(m[0].slot).toBeNull();
    expect(m[0].problem).toMatch(/as PLA, not PETG/);
  });

  it("warns about a nearly empty spool but still matches it", () => {
    const m = matchFilaments({ filaments: [{ color: "#000000", material: "PLA", grams: 1 }] }, live(["#000000", "PLA", 4]));
    expect(m[0].slot).not.toBeNull();
    expect(m[0].problem).toMatch(/4% left/);
  });

  it("is not ok when something is missing", () => {
    expect(filamentOk(plate, live(["#000000", "PLA"]))).toBe(false);
    expect(filamentOk(plate, live(["#000000", "PLA"], ["#FFFFFF", "PLA"]))).toBe(true);
    expect(filamentOk(plate, undefined)).toBe(false);
  });

  it("uses the external spool too", () => {
    const l = { ...emptyLive("idle"), external: { unit: -1, slot: 0, color: "#000000", material: "PLA", remainPct: null } };
    expect(filamentOk({ filaments: [{ color: "#000000", material: "PLA", grams: 1 }] }, l)).toBe(true);
  });
});
