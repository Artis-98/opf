// Anycubic printers on the local network (LAN mode): the Kobra 3, Kobra 3 Max, Kobra 3 V2,
// Kobra S1 and S1 Max. What they report over MQTT, turned into OPF's view of a printer, and the
// command that starts a print. The connection itself is in src/main/drivers/anycubic.ts.
//
// The protocol was worked out by the community and checked on real printers; see
// github.com/chrisfore/anycubic_ha_local (research/PROTOCOL-VALIDATED.md) and
// github.com/rvanderp3/kobra-connect (docs/mqtt-commands.md). Reports arrive on
// anycubic/anycubicCloud/v1/printer/public/<model id>/<device id>/<type>/report:
//
//   info            state free/busy, temperatures, the current print (project), upload address
//   tempature       temperatures, pushed as they change (the printer spells it this way)
//   print           progress during a print (only the shape with `progress` is progress)
//   multiColorBox   the ACE units and their slots (colour, material, how much is left)
//   status          busy/free
//
// Printers that reply in other shapes are read as far as they match, and the rest is ignored.

import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from "./print-options";
import type { AmsUnit, FilamentSlot, JobFilament, LiveState, PrinterStatus } from "./types";

export interface AnycubicProject {
  state?: string;
  progress?: number;
  remain_time?: number;
  curr_layer?: number;
  total_layers?: number;
  filename?: string;
  pause?: number;
}

export interface AnycubicSlot {
  index: number;
  type?: string;
  color?: number[];
  consumables_percent?: number;
  status?: number;
}

export interface AnycubicBox {
  id: number;
  humidity?: number | null;
  temp?: number | null;
  loaded_slot?: number;
  slots: Record<number, AnycubicSlot>;
}

export interface AnycubicState {
  /** "free" or "busy". */
  state: string | null;
  project: AnycubicProject | null;
  temp: { nozzle: number; nozzleTarget: number; bed: number; bedTarget: number };
  boxes: Record<number, AnycubicBox>;
  /** Where files go, from the info report. */
  uploadUrl: string | null;
}

export function emptyAnycubic(): AnycubicState {
  return { state: null, project: null, temp: { nozzle: 0, nozzleTarget: 0, bed: 0, bedTarget: 0 }, boxes: {}, uploadUrl: null };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function mergeTemp(s: AnycubicState, t: Obj) {
  s.temp = {
    nozzle: num(t.curr_nozzle_temp) ?? s.temp.nozzle,
    nozzleTarget: num(t.target_nozzle_temp) ?? s.temp.nozzleTarget,
    bed: num(t.curr_hotbed_temp) ?? s.temp.bed,
    bedTarget: num(t.target_hotbed_temp) ?? s.temp.bedTarget,
  };
}

const PROJECT_KEYS = ["state", "progress", "remain_time", "curr_layer", "total_layers", "filename", "pause"] as const;

function pickProject(p: Obj): AnycubicProject {
  const out: Obj = {};
  for (const k of PROJECT_KEYS) if (p[k] !== undefined && p[k] !== null) out[k] = p[k];
  return out as AnycubicProject;
}

/** Folds one report into what is known about the printer. `type` is the report's type, from its topic. */
export function applyReport(s: AnycubicState, type: string, msg: unknown): AnycubicState {
  const m = obj(msg);
  if (!m) return s;
  const data = obj(m.data);
  switch (type) {
    case "info": {
      if (!data) break;
      if (typeof data.state === "string") s.state = data.state;
      const t = obj(data.temp);
      if (t) mergeTemp(s, t);
      // The print in hand; when there is none, the report has none (only last_project).
      const p = obj(data.project);
      s.project = p ? pickProject(p) : null;
      const url = obj(data.urls)?.fileUploadurl;
      if (typeof url === "string" && url) s.uploadUrl = url;
      break;
    }
    case "tempature":
      if (data) mergeTemp(s, data);
      break;
    case "print":
      // Progress only: the same topic also carries command answers and settings.
      if (data && num(data.progress) !== undefined) s.project = { ...(s.project ?? {}), ...pickProject(data) };
      break;
    case "status":
      if (typeof m.state === "string") s.state = m.state;
      break;
    case "multiColorBox": {
      const boxes = data?.multi_color_box;
      if (!Array.isArray(boxes)) break;
      for (const b of boxes) {
        const box = obj(b);
        const id = num(box?.id);
        if (!box || id === undefined) continue;
        // Reports may carry one slot or all of them: merge.
        const known: AnycubicBox = s.boxes[id] ?? { id, slots: {} };
        const humidity = num(box.humidity) ?? num(obj(box.drying_status)?.humidity);
        const merged: AnycubicBox = {
          ...known,
          humidity: humidity ?? known.humidity ?? null,
          temp: num(box.temp) ?? known.temp ?? null,
          loaded_slot: num(box.loaded_slot) ?? known.loaded_slot,
          slots: { ...known.slots },
        };
        if (Array.isArray(box.slots)) {
          for (const sl of box.slots) {
            const slot = obj(sl);
            const index = num(slot?.index);
            if (!slot || index === undefined) continue;
            merged.slots[index] = {
              index,
              type: typeof slot.type === "string" ? slot.type : merged.slots[index]?.type,
              color: Array.isArray(slot.color) ? (slot.color as number[]) : merged.slots[index]?.color,
              consumables_percent: num(slot.consumables_percent) ?? merged.slots[index]?.consumables_percent,
              status: num(slot.status) ?? merged.slots[index]?.status,
            };
          }
        }
        s.boxes = { ...s.boxes, [id]: merged };
      }
      break;
    }
  }
  return s;
}

const PREPARING = ["preheating", "auto_leveling", "vibrating", "flow_calibrating", "heating", "downloading", "checking"];
const PRINTING = ["printing", "resuming", "resumed", "updated"];
const PAUSED = ["pausing", "paused"];

export function statusOf(s: AnycubicState): PrinterStatus {
  const p = s.project;
  if (p) {
    const st = (p.state ?? "").toLowerCase();
    if (st === "finished") return "finished";
    if (st === "stopping" || st === "stoped" || st === "stopped") return "idle";
    if (PAUSED.includes(st) || p.pause === 1 || p.pause === 2) return "paused";
    if (PREPARING.includes(st)) return "preparing";
    if (PRINTING.includes(st)) return "printing";
    return p.progress !== undefined ? "printing" : "preparing";
  }
  // Busy without a print: loading filament, calibrating. Not free for a new plate.
  return s.state === "busy" ? "preparing" : "idle";
}

export function hexColor(rgb: number[] | undefined): string | null {
  if (!rgb || rgb.length < 3) return null;
  return "#" + rgb.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function rgba(hex: string | null): number[] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex ?? "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 255] : [255, 255, 255, 255];
}

/** OPF's view of the printer. Without an ACE the plate prints from its one spool, whatever is on it. */
export function liveFromAnycubic(s: AnycubicState): Partial<LiveState> {
  const status = statusOf(s);
  const p = s.project;
  const running = status === "printing" || status === "paused" || status === "preparing";
  const ams: AmsUnit[] = Object.values(s.boxes)
    .sort((a, b) => a.id - b.id)
    .map((b) => ({
      id: Math.max(0, b.id),
      humidity: b.humidity ?? null,
      tempC: b.temp ?? null,
      slots: Object.values(b.slots)
        .sort((x, y) => x.index - y.index)
        .map((sl): FilamentSlot => {
          const empty = !sl.type;
          return { unit: Math.max(0, b.id), slot: sl.index, color: empty ? null : hexColor(sl.color), material: empty ? null : sl.type!, remainPct: empty ? null : sl.consumables_percent ?? null };
        }),
    }));
  const feeding = Object.values(s.boxes).find((b) => (b.loaded_slot ?? -1) >= 0);
  return {
    status,
    jobName: p?.filename ?? null,
    progress: status === "finished" ? 1 : running && p?.progress !== undefined ? p.progress / 100 : 0,
    remainingSec: running && p?.remain_time !== undefined ? p.remain_time * 60 : status === "finished" ? 0 : null,
    layer: running ? p?.curr_layer ?? null : null,
    totalLayers: running ? p?.total_layers ?? null : null,
    nozzle: { current: s.temp.nozzle, target: s.temp.nozzleTarget },
    bed: { current: s.temp.bed, target: s.temp.bedTarget },
    ams,
    external: ams.length ? null : { unit: -1, slot: 0, color: null, material: null, remainPct: null },
    activeSlot: feeding ? `${Math.max(0, feeding.id)}:${feeding.loaded_slot}` : null,
    error: null,
  };
}

export interface StartFile {
  /** The name it was uploaded under. */
  filename: string;
  md5: string;
  size: number;
}

/**
 * The `print`/`start` command's data for a file already on the printer: which ACE slot feeds each
 * of the plate's filaments (`slots`, in the plate's filament order, null for the printer's own
 * spool), and the calibrations chosen for the printer (auto levelling only, unless told).
 */
export function startData(file: StartFile, filaments: JobFilament[], slots: (FilamentSlot | null)[], print: PrintOptions = DEFAULT_PRINT_OPTIONS) {
  const useAce = slots.length > 0 && slots.every((s) => s !== null && s.unit >= 0);
  return {
    taskid: "-1",
    url: "",
    filename: file.filename,
    md5: file.md5,
    filepath: null,
    filetype: 1,
    project_type: 1,
    filesize: file.size,
    ams_settings: {
      use_ams: useAce,
      ams_box_mapping: useAce
        ? filaments.map((f, i) => {
          const slot = slots[i]!;
          return {
            paint_index: f.index ?? i,
            // With more than one ACE, the slots are numbered on from the first one's.
            ams_index: slot.unit * 4 + slot.slot,
            paint_color: rgba(f.color),
            ams_color: rgba(slot.color),
            material_type: slot.material ?? f.material,
          };
        })
        : [],
    },
    task_settings: {
      auto_leveling: print.bedLevelling ? 1 : 0,
      vibration_compensation: print.vibrationCompensation ? 1 : 0,
      flow_calibration: print.flowCalibration ? 1 : 0,
      dry_mode: 0,
      ai_settings: { status: 0, count: 0, type: 0 },
      timelapse: { status: print.timelapse ? 1 : 0, count: 0, type: 0 },
      drying_settings: { status: 0, target_temp: 0, duration: 0, remain_time: 0 },
      model_objects_skip_parts: [],
    },
  };
}
