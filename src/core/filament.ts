// Does a printer have what a plate needs loaded?
//
// Printers report each AMS slot's colour and material. A plate needs a list of
// colour + material pairs. A slot matches when its material family is the same
// (PLA Matte counts as PLA) and its colour is close enough that a person would
// call it the same colour. Exact hex equality is useless: the same black
// reads back as 000000, 161616 or 1A1A1A depending on the spool and firmware.

import type { FilamentSlot, JobFilament, LiveState, PlateJob } from "./types";

export function parseHex(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** "redmean" weighted RGB distance: cheap and close to how people see colour differences. 0–~765. */
export function colorDistance(a: string, b: string): number {
  const p = parseHex(a), q = parseHex(b);
  if (!p || !q) return Infinity;
  const rm = (p[0] + q[0]) / 2;
  const dr = p[0] - q[0], dg = p[1] - q[1], db = p[2] - q[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export const SAME_COLOR = 90;

/** "PLA Matte" → "PLA", "PETG-CF" → "PETG", "Generic ABS" → "ABS". */
export function materialFamily(m: string | null | undefined): string | null {
  if (!m) return null;
  const u = m.toUpperCase();
  for (const fam of ["PETG", "PCTG", "PLA", "ABS", "ASA", "TPU", "PA", "PC", "PVA", "HIPS", "PET"]) {
    if (new RegExp(`(^|[^A-Z])${fam}([^A-Z]|$)`).test(u)) return fam;
  }
  return u.split(/[\s-]/)[0] || null;
}

export function loadedSlots(live: LiveState | undefined): FilamentSlot[] {
  if (!live) return [];
  const all = live.ams.flatMap((u) => u.slots);
  if (live.external) all.push(live.external);
  return all.filter((s) => s.color || s.material);
}

export interface FilamentMatch {
  need: JobFilament;
  slot: FilamentSlot | null;
  /** Why there is no match, in words for the operator. */
  problem: string | null;
}

export function matchFilaments(job: Pick<PlateJob, "filaments">, live: LiveState | undefined): FilamentMatch[] {
  const slots = loadedSlots(live);
  // One spool and no way to tell what is on it (an Anycubic without an ACE, an external spool
  // nobody described on the printer): the plate prints from that spool.
  const single = live?.external;
  if (!slots.length && single && !live.ams.length) return job.filaments.map((need) => ({ need, slot: single, problem: null }));
  const used = new Set<FilamentSlot>();
  return job.filaments.map((need) => {
    const fam = materialFamily(need.material);
    const candidates = slots
      .filter((s) => !used.has(s))
      .map((s) => ({ s, sameMat: !fam || !s.material || materialFamily(s.material) === fam, d: s.color ? colorDistance(s.color, need.color) : Infinity }))
      .sort((a, b) => Number(b.sameMat) - Number(a.sameMat) || a.d - b.d);
    const best = candidates.find((c) => c.sameMat && c.d <= SAME_COLOR);
    if (best) {
      used.add(best.s);
      const low = best.s.remainPct !== null && best.s.remainPct < 10;
      return { need, slot: best.s, problem: low ? `Only ${best.s.remainPct}% left on that spool` : null };
    }
    const colorOnly = candidates.find((c) => c.d <= SAME_COLOR);
    if (colorOnly) return { need, slot: null, problem: `Colour is loaded, but as ${colorOnly.s.material ?? "unknown material"}, not ${need.material}` };
    return { need, slot: null, problem: `${need.material} in this colour is not loaded` };
  });
}

export function filamentOk(job: Pick<PlateJob, "filaments">, live: LiveState | undefined): boolean {
  return matchFilaments(job, live).every((m) => m.slot !== null);
}

/** What is wrong with the filament for a plate, in one sentence; null when everything is loaded. */
export function filamentWarning(job: Pick<PlateJob, "filaments">, live: LiveState | undefined): string | null {
  const problems = matchFilaments(job, live).filter((m) => !m.slot).map((m) => m.problem);
  return problems.length ? problems.join(". ") : null;
}

/**
 * The slot to feed each of a plate's filaments from, in the plate's order: its match, or, when the
 * operator chose to start anyway, the closest loaded spool (the same material first, then the
 * nearest colour). Null for a filament with nothing to feed it.
 */
export function slotsForStart(job: Pick<PlateJob, "filaments">, live: LiveState | undefined, anyFilament: boolean): (FilamentSlot | null)[] {
  const matches = matchFilaments(job, live);
  if (!anyFilament) return matches.map((m) => m.slot);
  const loaded = loadedSlots(live);
  const used = new Set(matches.map((m) => m.slot).filter((s): s is FilamentSlot => s !== null));
  return matches.map((m) => {
    if (m.slot) return m.slot;
    const fam = materialFamily(m.need.material);
    const rank = (s: FilamentSlot) => [fam && s.material && materialFamily(s.material) === fam ? 0 : 1, s.color ? colorDistance(s.color, m.need.color) : Infinity];
    const byFit = (a: FilamentSlot, b: FilamentSlot) => {
      const [ma, da] = rank(a), [mb, db] = rank(b);
      return ma - mb || da - db;
    };
    // A spool no other filament uses, or, with more filaments than spools, the closest one anyway.
    const pick = loaded.filter((s) => !used.has(s)).sort(byFit)[0] ?? [...loaded].sort(byFit)[0] ?? null;
    if (pick) used.add(pick);
    return pick;
  });
}
