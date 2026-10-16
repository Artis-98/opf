// What a printer does before a plate starts: the tick boxes Bambu Studio and
// the Anycubic app show when sending a print. Each printer keeps its own
// choice, and every plate it starts uses it.

import type { DriverKind, PrinterConfig } from "./types";

export type PrintOptionKey = "bedLevelling" | "flowCalibration" | "vibrationCompensation" | "timelapse";
export type PrintOptions = Record<PrintOptionKey, boolean>;

export const PRINT_OPTIONS: { key: PrintOptionKey; label: string; hint: string }[] = [
  { key: "bedLevelling", label: "Bed levelling", hint: "Probe the bed before printing." },
  { key: "flowCalibration", label: "Flow calibration", hint: "Calibrate the filament's flow dynamics before printing." },
  { key: "vibrationCompensation", label: "Resonance compensation", hint: "Measure the frame's resonance before printing." },
  { key: "timelapse", label: "Timelapse", hint: "Record a timelapse with the printer's camera." },
];

/** What OPF did before printers had a choice: level the bed, nothing else. */
export const DEFAULT_PRINT_OPTIONS: PrintOptions = { bedLevelling: true, flowCalibration: false, vibrationCompensation: false, timelapse: false };

/** The options a printer brand can take. Brands OPF cannot start prints on have none. */
export function printOptionsFor(driver: DriverKind): PrintOptionKey[] {
  return driver === "bambu" || driver === "anycubic" || driver === "simulator" ? PRINT_OPTIONS.map((o) => o.key) : [];
}

/** This printer's choice, with OPF's defaults for anything it has not chosen. */
export function printOptions(printer: Pick<PrinterConfig, "printOptions">): PrintOptions {
  return { ...DEFAULT_PRINT_OPTIONS, ...printer.printOptions };
}
