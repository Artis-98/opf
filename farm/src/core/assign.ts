// Choosing a printer for a plate that arrives without one: the printer that
// can start it soonest among those with its filament loaded, and if none has
// it loaded, the one free soonest. Never a printer of another model than the
// plate was sliced for.

import { matchFilaments } from "./filament";
import { schedulePrinter } from "./schedule";
import type { FarmData, LiveState, PlateJob, PrinterConfig } from "./types";

// One machine under two names: their plates are interchangeable.
const SAME_MACHINE = [["Bambu Lab X1 Carbon", "Bambu Lab X1"], ["Bambu Lab P1S", "Bambu Lab P1P"]];
// Makers whose slicer profiles name the printer the way OPF's model list does.
const KNOWN_MAKERS = ["Bambu Lab ", "Anycubic "];

function machine(model: string) {
  const m = model.trim().toLowerCase();
  return (SAME_MACHINE.find((names) => names.some((n) => n.toLowerCase() === m))?.[0] ?? m).toLowerCase();
}

/**
 * Why a plate must not go to a printer: it was sliced for another model, so its G-code is for
 * another bed, height and start sequence. Null when it fits, or when OPF cannot tell (a printer
 * not named the way the slicers name it, or a file that does not say what it was sliced for).
 */
export function wrongPrinter(job: Pick<PlateJob, "name" | "slicedFor">, printer: Pick<PrinterConfig, "name" | "model">): string | null {
  const sliced = job.slicedFor?.trim() ?? "", model = printer.model?.trim() ?? "";
  const known = (m: string) => KNOWN_MAKERS.some((maker) => m.startsWith(maker));
  if (!known(sliced) || !known(model)) return null;
  if (machine(sliced) === machine(model)) return null;
  return `${job.name} was sliced for a ${sliced}, but ${printer.name} is a ${model}. Slice it again for the ${model}.`;
}

export function bestPrinter(
  data: FarmData, live: Record<string, LiveState>, job: Pick<PlateJob, "filaments"> & Partial<Pick<PlateJob, "slicedFor">>, now = new Date(),
): string | null {
  const candidates = data.printers
    .filter((p) => live[p.id] && live[p.id].status !== "offline" && !wrongPrinter({ name: "", slicedFor: job.slicedFor }, p))
    .map((p) => {
      const { slots } = schedulePrinter(data.settings, live[p.id], data.current[p.id], data.queues[p.id] ?? [], now);
      const free = slots.length ? slots[slots.length - 1].end.getTime() : now.getTime();
      const loaded = job.filaments.length === 0 || matchFilaments(job, live[p.id]).every((m) => m.slot);
      return { id: p.id, free, loaded };
    });
  candidates.sort((a, b) => Number(b.loaded) - Number(a.loaded) || a.free - b.free);
  return candidates[0]?.id ?? null;
}
