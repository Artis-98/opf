// Turning a Bambu printer's status messages into OPF's LiveState.
//
// The printer publishes JSON on `device/<serial>/report`. X1 machines send the
// full state each time; P1 and A1 machines send only what changed, so the
// driver keeps a running copy (`mergeReport`) and reads LiveState from that.
// Pure functions, so they can be tested against captured messages without a
// printer.

import type { AmsUnit, FilamentSlot, LiveState, PrinterStatus } from "./types";

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merge `patch` into `base`. Arrays are replaced whole, which is how the printer sends them. */
export function mergeReport(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObj(v) && isObj(out[k]) ? mergeReport(out[k] as Json, v) : v;
  }
  return out;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "FF8800FF" (RRGGBBAA) → "#FF8800". Empty or all-zero-alpha trays read as null. */
export function trayColor(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 6) return null;
  if (v.length >= 8 && v.slice(6, 8) === "00" && v.slice(0, 6) === "000000") return null;
  return "#" + v.slice(0, 6).toUpperCase();
}

function tray(t: Json, unit: number, slot: number): FilamentSlot {
  const material = (typeof t.tray_sub_brands === "string" && t.tray_sub_brands) || (typeof t.tray_type === "string" && t.tray_type) || null;
  const remain = num(t.remain);
  // For OPF Slicer's Sync: the exact filament, and the plain material behind a product name.
  const filamentId = typeof t.tray_info_idx === "string" && t.tray_info_idx ? t.tray_info_idx : null;
  const type = typeof t.tray_type === "string" && t.tray_type ? t.tray_type : null;
  return {
    unit, slot, color: trayColor(t.tray_color), material, remainPct: remain !== null && remain >= 0 ? remain : null,
    ...(filamentId ? { filamentId } : {}), ...(type && type !== material ? { type } : {}),
  };
}

export function statusOf(p: Json): PrinterStatus {
  const state = String(p.gcode_state ?? "").toUpperCase();
  const err = num(p.print_error) ?? 0;
  switch (state) {
    case "RUNNING": return "printing";
    case "PREPARE":
    case "SLICING": return "preparing";
    case "PAUSE": return err ? "error" : "paused";
    case "FINISH": return "finished";
    case "FAILED": return "error";
    case "IDLE":
    case "": return "idle";
    default: return "idle";
  }
}

/** Bambu's error numbers are looked up on its wiki by the hex form, e.g. 0300_8003. */
export function errorText(p: Json): string | null {
  const err = num(p.print_error) ?? 0;
  if (!err) return statusOf(p) === "error" ? "The print failed. See the printer's screen." : null;
  const hex = (err >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `Printer error ${hex.slice(0, 4)}_${hex.slice(4)}. See the printer's screen or the Bambu Lab wiki for this code.`;
}

export function liveFromReport(report: Json): Partial<LiveState> {
  const p = isObj(report.print) ? report.print : {};
  const status = statusOf(p);
  const percent = num(p.mc_percent);
  const remainingMin = num(p.mc_remaining_time);

  const amsBlock = isObj(p.ams) ? p.ams : {};
  const units = Array.isArray(amsBlock.ams) ? (amsBlock.ams as Json[]) : [];
  const ams: AmsUnit[] = units.map((u, i) => {
    const id = num(u.id) ?? i;
    const trays = Array.isArray(u.tray) ? (u.tray as Json[]) : [];
    return {
      id,
      humidity: num(u.humidity_raw),
      tempC: num(u.temp),
      slots: trays.map((t, j) => tray(t, id, num(t.id) ?? j)),
    };
  });
  const external = isObj(p.vt_tray) ? tray(p.vt_tray, -1, 0) : null;

  // tray_now: 0–15 is AMS unit*4+slot, 254 the external spool, 255 nothing.
  const now = num(amsBlock.tray_now);
  const activeSlot = now === null || now === 255 ? null : now === 254 ? "-1:0" : `${Math.floor(now / 4)}:${now % 4}`;

  const printing = status === "printing" || status === "paused" || status === "preparing" || status === "error";
  return {
    status,
    jobName: (typeof p.subtask_name === "string" && p.subtask_name) || null,
    progress: percent !== null ? percent / 100 : status === "finished" ? 1 : 0,
    remainingSec: printing && remainingMin !== null ? remainingMin * 60 : status === "finished" ? 0 : null,
    layer: num(p.layer_num),
    totalLayers: num(p.total_layer_num),
    nozzle: { current: num(p.nozzle_temper) ?? 0, target: num(p.nozzle_target_temper) ?? 0 },
    bed: { current: num(p.bed_temper) ?? 0, target: num(p.bed_target_temper) ?? 0 },
    ams,
    external: external && (external.color || external.material) ? external : null,
    activeSlot,
    error: errorText(p),
  };
}

/**
 * Which tray feeds each filament of a plate, in the plate's filament order:
 * AMS unit*4+slot, or 254 for the external spool. This is the `ams_mapping`
 * the printer's start command takes.
 */
export function amsMapping(slots: (FilamentSlot | null)[]): number[] {
  return slots.map((s) => (!s ? -1 : s.unit < 0 ? 254 : s.unit * 4 + s.slot));
}
