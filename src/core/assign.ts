// Choosing a printer for a plate that arrives without one: the printer that
// can start it soonest among those with its filament loaded, and if none has
// it loaded, the one free soonest.

import { matchFilaments } from "./filament";
import { schedulePrinter } from "./schedule";
import type { FarmData, LiveState, PlateJob } from "./types";

export function bestPrinter(data: FarmData, live: Record<string, LiveState>, job: Pick<PlateJob, "filaments">, now = new Date()): string | null {
  const candidates = data.printers
    .filter((p) => live[p.id] && live[p.id].status !== "offline")
    .map((p) => {
      const { slots } = schedulePrinter(data.settings, live[p.id], data.current[p.id], data.queues[p.id] ?? [], now);
      const free = slots.length ? slots[slots.length - 1].end.getTime() : now.getTime();
      const loaded = job.filaments.length === 0 || matchFilaments(job, live[p.id]).every((m) => m.slot);
      return { id: p.id, free, loaded };
    });
  candidates.sort((a, b) => Number(b.loaded) - Number(a.loaded) || a.free - b.free);
  return candidates[0]?.id ?? null;
}
