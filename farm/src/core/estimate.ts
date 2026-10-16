// A rough time and weight before a plate is sliced, from the models' volume.
//
// Shown only until the real slicer has run, and always labelled "estimate".
// It exists so a plate can be queued and scheduled the moment it is laid out.

export interface EstimateSettings {
  layerHeight: number; // mm
  infillPct: number; // 0–100
  wallLoops: number;
}

export const DENSITY: Record<string, number> = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, PA: 1.14, PC: 1.2 };

/** Signed-tetrahedron volume of a closed triangle mesh, mm³. `pos` is xyz triples, three per triangle. */
export function meshVolume(pos: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v) / 6;
}

/** Surface area of the same mesh, mm². Walls scale with area, infill with volume. */
export function meshArea(pos: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
    const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    a += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return a;
}

/**
 * Grams and minutes for one object. Walls: area × loops × 0.42 mm line width.
 * Infill: the rest of the volume × infill %. Time from a typical 15 mm³/s
 * average volumetric flow on a modern machine, slowed for fine layers.
 */
export function estimateObject(volumeMm3: number, areaMm2: number, heightMm: number, material: string, s: EstimateSettings) {
  const shell = Math.min(volumeMm3, areaMm2 * s.wallLoops * 0.42);
  const solid = shell + Math.max(0, volumeMm3 - shell) * (s.infillPct / 100);
  const fam = Object.keys(DENSITY).find((k) => material.toUpperCase().includes(k)) ?? "PLA";
  const grams = (solid / 1000) * DENSITY[fam];
  const layers = Math.max(1, Math.round(heightMm / s.layerHeight));
  const flowSec = solid / (15 * Math.min(1, s.layerHeight / 0.2));
  const layerChangeSec = layers * 1.2;
  return { grams, seconds: flowSec + layerChangeSec, layers };
}

/** Whole plate: objects print together, so layer-change overhead counts once for the tallest. */
export function estimatePlate(objs: { volume: number; area: number; height: number; material: string }[], s: EstimateSettings) {
  let grams = 0, flow = 0, maxLayers = 0;
  const per: number[] = [];
  for (const o of objs) {
    const e = estimateObject(o.volume, o.area, o.height, o.material, s);
    grams += e.grams;
    per.push(e.grams);
    flow += e.seconds - e.layers * 1.2;
    maxLayers = Math.max(maxLayers, e.layers);
  }
  const heatUpSec = objs.length ? 6 * 60 : 0;
  const minutes = Math.round((flow + maxLayers * 1.2 * Math.max(1, Math.sqrt(objs.length)) + heatUpSec) / 60);
  return { grams: Math.round(grams), minutes, layers: maxLayers, perObjectGrams: per };
}
