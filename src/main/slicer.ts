// Slicing with the real Bambu Studio or OrcaSlicer, run from the command line.
//
// OPF does not slice by itself. It writes the plate's objects to STL files in
// a work folder, runs the installed slicer without a window, and reads the
// time and grams back out of the sliced .gcode.3mf. The settings come from
// profiles the operator exported from their slicer (File → Export → Export
// Configs in Bambu Studio), set per printer in OPF.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { JobFilament, SlicerInfo } from "../core/types";

const CANDIDATES: { name: string; paths: string[] }[] = [
  {
    name: "Bambu Studio",
    paths: [
      "C:\\Program Files\\Bambu Studio\\bambu-studio.exe",
      "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
      "/usr/bin/bambu-studio",
      "/usr/local/bin/bambu-studio",
      "/opt/bambu-studio/bambu-studio",
    ],
  },
  {
    name: "OrcaSlicer",
    paths: [
      "C:\\Program Files\\OrcaSlicer\\orca-slicer.exe",
      "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
      "/usr/bin/orca-slicer",
      "/usr/local/bin/orca-slicer",
    ],
  },
];

export function findSlicer(custom: string | null): SlicerInfo {
  if (custom) {
    return existsSync(custom)
      ? { found: true, name: /orca/i.test(custom) ? "OrcaSlicer" : "Bambu Studio", path: custom }
      : { found: false, name: null, path: custom };
  }
  for (const c of CANDIDATES) {
    const hit = c.paths.find((p) => existsSync(p));
    if (hit) return { found: true, name: c.name, path: hit };
  }
  return { found: false, name: null, path: null };
}

export interface SliceProfile {
  machine: string;
  process: string;
  filaments: string[];
}

export interface SliceRequest {
  name: string;
  objects: { name: string; stl: Uint8Array }[];
  profile: SliceProfile | null;
}

export interface SliceResult {
  file: string;
  minutes: number;
  grams: number;
  filaments: JobFilament[];
}

export async function slicePlate(req: SliceRequest, slicer: SlicerInfo, workRoot: string): Promise<SliceResult> {
  if (!slicer.found || !slicer.path) throw new Error("No slicer found. Install Bambu Studio or OrcaSlicer, or set its path in Settings.");
  if (!req.profile) throw new Error("This printer has no slicing profiles yet. Export them from your slicer and set them in the printer's settings.");
  if (!req.objects.length) throw new Error("The plate is empty.");

  const dir = join(workRoot, `slice-${Date.now().toString(36)}`);
  await mkdir(dir, { recursive: true });
  const inputs: string[] = [];
  for (const [i, o] of req.objects.entries()) {
    const p = join(dir, `${String(i).padStart(2, "0")}-${o.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40)}.stl`);
    await writeFile(p, o.stl);
    inputs.push(p);
  }
  const out = join(dir, `${req.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "plate"}.gcode.3mf`);
  const args = [
    "--slice", "0",
    "--arrange", "0",
    "--load-settings", `${req.profile.machine};${req.profile.process}`,
    "--load-filaments", req.profile.filaments.join(";"),
    "--outputdir", dir,
    "--export-3mf", out,
    ...inputs,
  ];

  await new Promise<void>((resolve, reject) => {
    execFile(slicer.path!, args, { timeout: 10 * 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, async (err, _stdout, stderr) => {
      if (!err && existsSync(out)) return resolve();
      // The slicer writes result.json with its own error message; that is the useful one.
      let reason = "";
      try {
        const r = JSON.parse(await readFile(join(dir, "result.json"), "utf8"));
        reason = r.error_string || r.message || "";
      } catch { /* no result.json */ }
      reject(new Error(`${slicer.name} could not slice this plate${reason ? `: ${reason}` : stderr ? `: ${stderr.trim().split("\n").pop()}` : "."}`));
    });
  });

  const info = readSliceInfo(await readFile(out));
  return { file: out, ...info };
}

/** Time, weight and filaments from a sliced .gcode.3mf's Metadata/slice_info.config. */
export function readSliceInfo(bytes: Uint8Array): Omit<SliceResult, "file"> {
  const files = unzipSync(bytes, { filter: (f) => f.name === "Metadata/slice_info.config" });
  const xml = files["Metadata/slice_info.config"];
  if (!xml) throw new Error("The sliced file has no slice information. Was it sliced?");
  return parseSliceInfo(strFromU8(xml));
}

export function parseSliceInfo(xml: string): Omit<SliceResult, "file"> {
  const plate = /<plate>([\s\S]*?)<\/plate>/.exec(xml)?.[1] ?? xml;
  const meta = (key: string) => {
    const m = new RegExp(`<metadata\\s+key="${key}"\\s+value="([^"]*)"`).exec(plate);
    return m ? parseFloat(m[1]) : NaN;
  };
  const seconds = meta("prediction");
  const weight = meta("weight");
  const filaments: JobFilament[] = [];
  for (const m of plate.matchAll(/<filament\s+([^>]*)\/?>/g)) {
    const attr = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(m[1])?.[1] ?? "";
    filaments.push({ color: attr("color").toUpperCase() || "#808080", material: attr("type") || "PLA", grams: Math.round(parseFloat(attr("used_g")) || 0) });
  }
  if (!Number.isFinite(seconds)) throw new Error("The slicer did not report a print time.");
  return {
    minutes: Math.round(seconds / 60),
    grams: Math.round(Number.isFinite(weight) ? weight : filaments.reduce((a, f) => a + f.grams, 0)),
    filaments,
  };
}
