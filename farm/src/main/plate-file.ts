// Reading a sliced plate that a slicer sent to OPF: how long it takes, how
// much filament, which colours, and a picture of it.
//
// Two kinds arrive:
//   .gcode.3mf  Bambu Studio / OrcaSlicer project with the G-code inside.
//               Time and weight come from Metadata/slice_info.config, the
//               picture from Metadata/plate_<n>.png, the printer it was
//               sliced for from Metadata/project_settings.config.
//   .gcode      Plain G-code. Time, weight and printer come from the comments
//               the slicer writes at the top and bottom of the file.

import { open, readFile, stat } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import type { JobFilament } from "../core/types";
import { parseSliceInfo } from "./slicer";

export interface PlateInfo {
  minutes: number;
  grams: number;
  filaments: JobFilament[];
  thumbnail: string | null;
  /** The printer model it was sliced for ("Bambu Lab A1 mini"), when the file says. */
  slicedFor: string | null;
  /** The parts on the plate in the order they were added ("Bracket.stl"), when the file says. */
  parts?: string[];
}

/** "1d 2h 3m 4s", "2h 05m", "45m 10s" → seconds. */
export function parseDuration(s: string): number | null {
  let total = 0, found = false;
  for (const [, n, unit] of s.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) {
    found = true;
    total += parseFloat(n) * { d: 86400, h: 3600, m: 60, s: 1 }[unit.toLowerCase() as "d" | "h" | "m" | "s"];
  }
  return found ? Math.round(total) : null;
}

/** Time, weight and filaments from the comments in a G-code file's first and last few kilobytes. */
export function parseGcodeComments(text: string): Omit<PlateInfo, "thumbnail"> {
  const find = (re: RegExp) => re.exec(text)?.[1]?.trim() ?? null;
  const time =
    find(/^;\s*total estimated time:\s*([^;\n]+)/im) ??
    find(/^;.*?total estimated time:\s*([^;\n]+)/im) ??
    find(/^;\s*estimated printing time \(normal mode\)\s*=\s*([^\n]+)/im) ??
    find(/^;\s*model printing time:\s*([^;\n]+)/im) ??
    find(/^;\s*estimated printing time\s*[=:]\s*([^\n]+)/im);
  const seconds = time ? parseDuration(time) : null;
  if (seconds === null) throw new Error("The G-code does not say how long it takes. Was it sliced by Bambu Studio, OrcaSlicer or PrusaSlicer?");

  const list = (re: RegExp) => (find(re) ?? "").split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  const perFilament = list(/^;\s*filament used \[g\]\s*=\s*([^\n]+)/im).map(Number);
  const colours = list(/^;\s*filament_colou?r\s*=\s*([^\n]+)/im);
  const types = list(/^;\s*filament_type\s*=\s*([^\n]+)/im);
  const total = parseFloat(find(/^;\s*total filament (?:used|weight) \[g\]\s*[=:]\s*([\d.]+)/im) ?? "") || perFilament.reduce((a, b) => a + (b || 0), 0);

  // Only the filaments the plate actually uses (slicers list every slot, used or not).
  const n = Math.max(perFilament.length, colours.length);
  const filaments: JobFilament[] = [];
  for (let i = 0; i < n; i++) {
    const grams = perFilament[i] ?? (n === 1 ? total : 0);
    if (n > 1 && !(grams > 0)) continue;
    filaments.push({ color: (colours[i] ?? "#808080").toUpperCase(), material: types[i] ?? types[0] ?? "PLA", grams: Math.round(grams) });
  }
  return { minutes: Math.round(seconds / 60), grams: Math.round(total), filaments, slicedFor: find(/^;\s*printer_model\s*=\s*([^\n]+)/im) || null };
}

async function headAndTail(path: string, bytes = 96 * 1024): Promise<string> {
  const size = (await stat(path)).size;
  const fh = await open(path, "r");
  try {
    const head = Buffer.alloc(Math.min(bytes, size));
    await fh.read(head, 0, head.length, 0);
    if (size <= bytes * 2) {
      const rest = Buffer.alloc(size - head.length);
      await fh.read(rest, 0, rest.length, head.length);
      return head.toString("utf8") + rest.toString("utf8");
    }
    const tail = Buffer.alloc(bytes);
    await fh.read(tail, 0, bytes, size - bytes);
    return head.toString("utf8") + "\n" + tail.toString("utf8");
  } finally {
    await fh.close();
  }
}

/** Read a sliced .gcode.3mf or .gcode. `plate` is 1-based, for projects with several plates. */
export async function readPlateFile(path: string, plate = 1): Promise<PlateInfo> {
  const lower = path.toLowerCase();
  if (lower.endsWith(".gcode")) return { ...parseGcodeComments(await headAndTail(path)), thumbnail: null };
  if (!lower.endsWith(".3mf")) throw new Error("OPF takes sliced .gcode.3mf or .gcode files.");

  // One pass over the zip: note every name, unpack only the small files we read.
  const want = new Set([`Metadata/slice_info.config`, `Metadata/plate_${plate}.png`, "Metadata/project_settings.config"]);
  const names = new Set<string>();
  const files = unzipSync(new Uint8Array(await readFile(path)), {
    filter: (f) => {
      names.add(f.name);
      return want.has(f.name);
    },
  });
  if (!names.has(`Metadata/plate_${plate}.gcode`)) throw new Error(`Plate ${plate} in this file has not been sliced. Slice it before sending.`);
  const xml = files["Metadata/slice_info.config"];
  if (!xml) throw new Error("The file has no slice information.");
  const text = strFromU8(xml);
  const info = parseSliceInfoForPlate(text, plate);
  const png = files[`Metadata/plate_${plate}.png`];
  return {
    ...info,
    thumbnail: png ? `data:image/png;base64,${Buffer.from(png).toString("base64")}` : null,
    slicedFor: printerModel(files["Metadata/project_settings.config"]),
    parts: partNamesForPlate(text, plate),
  };
}

/** "printer_model" from a project's settings: the printer the plate was sliced for. */
function printerModel(settings: Uint8Array | undefined): string | null {
  if (!settings) return null;
  try {
    const model = (JSON.parse(strFromU8(settings)) as { printer_model?: unknown }).printer_model;
    return typeof model === "string" && model.trim() ? model.trim() : null;
  } catch {
    return null;
  }
}

/** slice_info.config lists every sliced plate; take the one asked for. */
export function parseSliceInfoForPlate(xml: string, plate: number) {
  return parseSliceInfo(plateXml(xml, plate));
}

/** The parts on one plate, in the order they were added: its `<object name="…">` entries. */
export function partNamesForPlate(xml: string, plate: number): string[] {
  return [...plateXml(xml, plate).matchAll(/<object\b[^>]*?\bname="([^"]*)"/g)].map((m) => unescapeXml(m[1]).trim()).filter(Boolean);
}

function plateXml(xml: string, plate: number) {
  const plates = [...xml.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map((m) => m[0]);
  return plates.find((p) => new RegExp(`<metadata\\s+key="index"\\s+value="${plate}"`).test(p)) ?? plates[0] ?? xml;
}

function unescapeXml(s: string) {
  return s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e]!);
}
