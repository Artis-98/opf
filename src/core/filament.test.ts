import { describe, expect, it } from "vitest";
import { emptyLive } from "./driver";
import { colorDistance, filamentOk, filamentWarning, materialFamily, matchFilaments, SAME_COLOR, slotsForStart } from "./filament";
import type { LiveState } from "./types";
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

describe("starting with filament that is not loaded", () => {
  const live = (...slots: [string, string][]): LiveState => ({
    ...emptyLive("idle"),
    ams: [{ id: 0, humidity: null, tempC: null, slots: slots.map(([color, material], i) => ({ unit: 0, slot: i, color, material, remainPct: null })) }],
  });
  const job = (...f: [string, string][]) => ({ filaments: f.map(([color, material]) => ({ color, material, grams: 5 })) });

  it("says what is missing, or nothing when it is all loaded", () => {
    expect(filamentWarning(job(["#FF0000", "PLA"]), live(["#FF0000", "PLA"]))).toBeNull();
    expect(filamentWarning(job(["#00FF00", "PLA"]), live(["#FF0000", "PLA"]))).toBe("PLA in this colour is not loaded");
  });

  it("feeds a missing colour from the closest spool of the same material when started anyway", () => {
    const l = live(["#FFFFFF", "PETG"], ["#FF2020", "PLA"], ["#000000", "PLA"]);
    const slots = slotsForStart(job(["#FF0000", "PLA"], ["#202020", "PLA"], ["#00FF00", "PLA"]), l, true);
    expect(slots.map((s) => s?.slot)).toEqual([1, 2, 0]); // red, black, then the only spool left
    expect(slotsForStart(job(["#00FF00", "PLA"]), l, false)).toEqual([null]);
    expect(slotsForStart(job(["#00FF00", "PLA"]), emptyLive("idle"), true)).toEqual([null]);
  });
});

describe("a printer with one spool it cannot describe", () => {
  it("prints any plate from that spool, without asking", () => {
    const single: LiveState = { ...emptyLive("idle"), external: { unit: -1, slot: 0, color: null, material: null, remainPct: null } };
    const job = { filaments: [{ color: "#00FF00", material: "PETG", grams: 5 }] };
    expect(filamentWarning(job, single)).toBeNull();
    expect(slotsForStart(job, single, false)).toEqual([single.external]);
  });
});
