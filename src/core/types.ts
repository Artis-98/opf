/* The farm as OPF stores it, and the live state printers report. */

export type DriverKind = "bambu" | "anycubic" | "moonraker" | "prusalink" | "octoprint" | "simulator";

export type PrinterStatus =
  | "idle" // ready, bed clear
  | "preparing" // heating, levelling
  | "printing"
  | "paused"
  | "error" // stopped by the printer and waiting for a person
  | "finished" // print done, parts still on the bed
  | "offline";

export interface PrinterConfig {
  id: string;
  name: string;
  model: string;
  driver: DriverKind;
  /** IP address or host name on the local network. */
  host?: string;
  /** Bambu serial number; the printer's MQTT topics are named after it. */
  serial?: string;
  /** Bambu LAN access code, shown on the printer's screen. */
  accessCode?: string;
  /** API key for Moonraker, PrusaLink or OctoPrint. */
  apiKey?: string;
  /** Printers without a camera, enclosure or AMS draw differently. */
  enclosed?: boolean;
  /** Slicer profiles exported from Bambu Studio or OrcaSlicer, as file paths. */
  slicing?: { machine: string; process: string; filaments: string[] } | null;
  /** For a simulated printer: what is loaded in its AMS. */
  sim?: { ams: { color: string; material: string }[] } | null;
  /** What the printer does before each plate (bed levelling, flow calibration…). Unset: OPF's defaults. */
  printOptions?: Partial<Record<"bedLevelling" | "flowCalibration" | "vibrationCompensation" | "timelapse", boolean>>;
}

export interface FilamentSlot {
  /** AMS unit number, or -1 for the external spool. */
  unit: number;
  slot: number;
  /** "#RRGGBB", or null when the slot is empty or unknown. */
  color: string | null;
  /** "PLA", "PETG", "PLA Matte"… as the printer reports it. */
  material: string | null;
  /** 0–100, only known for spools with an RFID tag. */
  remainPct: number | null;
}

export interface AmsUnit {
  id: number;
  humidity: number | null;
  tempC: number | null;
  slots: FilamentSlot[];
}

export interface Temp {
  current: number;
  target: number;
}

export interface LiveState {
  status: PrinterStatus;
  jobName: string | null;
  /** 0–1 */
  progress: number;
  remainingSec: number | null;
  layer: number | null;
  totalLayers: number | null;
  nozzle: Temp;
  bed: Temp;
  ams: AmsUnit[];
  external: FilamentSlot | null;
  /** The slot feeding right now, as "unit:slot". */
  activeSlot: string | null;
  error: string | null;
  updatedAt: number;
}

export interface JobFilament {
  color: string;
  material: string;
  grams: number;
  /** Which of the slicer's filaments it is (0 for the first, T0), when the sliced file says. */
  index?: number;
}

/** One plate: what a printer prints in one go. */
export interface PlateJob {
  id: string;
  name: string;
  /** Order number in whatever system sent it, e.g. "IITEG-1042". */
  ref: string | null;
  minutes: number;
  grams: number;
  filaments: JobFilament[];
  /** Path to the sliced .gcode.3mf (or .gcode) on disk, once sliced. */
  file: string | null;
  /** Which plate in a .gcode.3mf project to print, 1-based. Default 1. */
  plate?: number;
  /** The project the plate was sliced from (.3mf), sent along by OPF Slicer so the plate can be opened and changed. */
  project?: string;
  /** The printer model the plate was sliced for, e.g. "Bambu Lab A1 mini", when the file says. */
  slicedFor?: string;
  /** Top view of the plate as a data: URL. */
  thumbnail: string | null;
  /** Where the time and grams came from. An estimate is replaced when the plate is sliced. */
  source: "slicer" | "estimate" | "api";
  createdAt: number;
}

export interface Shelf {
  id: string;
  name: string;
  /** Printer ids, left to right; null is an empty slot. */
  slots: (string | null)[];
}

/** Parts sent to OPF from outside, waiting to be put on a plate. */
export interface InboxItem {
  id: string;
  ref: string | null;
  name: string;
  qty: number;
  material: string | null;
  color: string | null;
  due: string | null;
  /** Where to download the model from, if the sender provided one. */
  fileUrl: string | null;
  notes: string | null;
  source: string;
  receivedAt: number;
}

export interface Settings {
  /** Hour of day a person is in the workshop to clear beds, 0–23. */
  workStart: number;
  /** Hour of day they leave, 1–24. */
  workEnd: number;
  /** Days someone is in, Monday first: "1111100" is weekdays only. */
  workDays: string;
  /** May a print that started in working hours run on after everyone has left? */
  overnightOk: boolean;
  /** Minutes to take parts off and start the next plate. */
  changeoverMin: number;
  api: { enabled: boolean; port: number; token: string };
  /** An outside system OPF fetches work from, such as admin.iiteg.com. */
  inboxSource: { url: string; token: string; pollSec: number } | null;
  /** Path to bambu-studio or orca-slicer; null to look in the usual places. */
  slicerPath: string | null;
  /** How fast simulated printers run: 1 is real time, 60 makes an hour take a minute. */
  simSpeed: number;
}

export interface FarmData {
  version: 1;
  shelves: Shelf[];
  printers: PrinterConfig[];
  /** What each printer is printing or has just printed and not yet been cleared. */
  current: Record<string, PlateJob | null>;
  /** Plates waiting for each printer, first is next. */
  queues: Record<string, PlateJob[]>;
  inbox: InboxItem[];
  history: { printerId: string; job: PlateJob; endedAt: number; outcome: "done" | "stopped" | "failed" }[];
  /** Ids already taken from the inbox source, so a handled order is not fetched again. */
  sourceSeen: string[];
  /**
   * Printers whose bed was confirmed clear after a print they still report as finished (Bambu Lab
   * printers do until the next print starts), by that print's name. They show as idle meanwhile.
   */
  bedCleared?: Record<string, string>;
  settings: Settings;
}

export interface SlicerInfo {
  found: boolean;
  name: string | null;
  path: string | null;
}

export interface Snapshot {
  data: FarmData;
  live: Record<string, LiveState>;
  slicer: SlicerInfo;
  demo: boolean;
}
