import { describe, expect, it } from "vitest";
import { estimatePlate, meshArea, meshVolume } from "./estimate";

/** A closed axis-aligned box as 12 triangles, outward facing. */
function box(w: number, d: number, h: number): number[] {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((t) => t.flatMap((i) => v[i]));
}

describe("mesh measurements", () => {
  it("measures a 20 mm cube", () => {
    expect(meshVolume(box(20, 20, 20))).toBeCloseTo(8000, 6);
    expect(meshArea(box(20, 20, 20))).toBeCloseTo(2400, 6);
  });
  it("does not care which way the triangles wind", () => {
    const b = box(10, 20, 30);
    const flipped: number[] = [];
    for (let i = 0; i < b.length; i += 9) flipped.push(...b.slice(i, i + 3), ...b.slice(i + 6, i + 9), ...b.slice(i + 3, i + 6));
    expect(meshVolume(flipped)).toBeCloseTo(6000, 6);
  });
});

describe("estimatePlate", () => {
  const s = { layerHeight: 0.2, infillPct: 15, wallLoops: 2 };
  it("gives a 20 mm calibration cube a sensible weight and time", () => {
    const e = estimatePlate([{ volume: 8000, area: 2400, height: 20, material: "PLA" }], s);
    // A slicer says roughly 3–5 g and 15–30 minutes for this cube.
    expect(e.grams).toBeGreaterThanOrEqual(3);
    expect(e.grams).toBeLessThanOrEqual(5);
    expect(e.minutes).toBeGreaterThanOrEqual(10);
    expect(e.minutes).toBeLessThanOrEqual(30);
    expect(e.layers).toBe(100);
  });
  it("gets heavier with more infill and slower with finer layers", () => {
    const base = estimatePlate([{ volume: 64000, area: 9600, height: 40, material: "PLA" }], s);
    expect(estimatePlate([{ volume: 64000, area: 9600, height: 40, material: "PLA" }], { ...s, infillPct: 50 }).grams).toBeGreaterThan(base.grams);
    expect(estimatePlate([{ volume: 64000, area: 9600, height: 40, material: "PLA" }], { ...s, layerHeight: 0.12 }).minutes).toBeGreaterThan(base.minutes);
  });
  it("is zero for an empty plate", () => {
    expect(estimatePlate([], s)).toMatchObject({ grams: 0, minutes: 0, layers: 0 });
  });
});
