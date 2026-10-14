// What each printer is doing, in the words the operator sees, and what changed since the last look:
// for the window, the small OPF by the clock, and its notifications.

import type { LiveState, PlateJob, PrinterStatus, Snapshot } from "./types";

export const STATUS_LABEL: Record<PrinterStatus, string> = {
  printing: "Printing", preparing: "Heating", idle: "Idle", paused: "Paused", error: "Error", finished: "Finished", offline: "Offline",
};

/** A plate still on the bed counts as finished even if the printer itself says idle. */
export function displayStatus(live: LiveState | undefined, current: PlateJob | null): PrinterStatus {
  const s = live?.status ?? "offline";
  if (current && s === "idle") return "finished";
  return s;
}

/** Statuses that wait for someone at the printer. */
export const NEEDS_YOU: PrinterStatus[] = ["error", "finished", "paused"];

export function statuses(snap: Snapshot): Record<string, PrinterStatus> {
  return Object.fromEntries(snap.data.printers.map((p) => [p.id, displayStatus(snap.live[p.id], snap.data.current[p.id])]));
}

/** "2 printing · 1 needs you", for the tray icon. */
export function farmSummary(snap: Snapshot): string {
  const st = Object.values(statuses(snap));
  const printing = st.filter((s) => s === "printing" || s === "preparing").length;
  const needs = st.filter((s) => NEEDS_YOU.includes(s)).length;
  const parts = [`${printing} printing`];
  if (needs) parts.push(`${needs} need${needs === 1 ? "s" : ""} you`);
  return parts.join(" · ");
}

export interface FarmNews {
  printerId: string;
  title: string;
  body: string;
}

const RUNNING: PrinterStatus[] = ["printing", "preparing"];

/**
 * What happened since the last snapshot that someone should hear about: a print finished, a printer
 * stopped with an error, a print was paused. `before` is the statuses from last time; with none
 * (the first look) nothing is news.
 */
export function farmNews(before: Record<string, PrinterStatus> | null, snap: Snapshot): FarmNews[] {
  if (!before) return [];
  const now = statuses(snap);
  const news: FarmNews[] = [];
  for (const p of snap.data.printers) {
    const was = before[p.id], is = now[p.id];
    if (!was || was === is) continue;
    const job = snap.data.current[p.id]?.name ?? snap.live[p.id]?.jobName ?? "the print";
    if (is === "finished" && RUNNING.includes(was)) {
      const next = snap.data.queues[p.id]?.[0]?.name;
      news.push({ printerId: p.id, title: `${p.name} finished`, body: next ? `${job} is done. Clear the bed to start ${next}.` : `${job} is done. Clear the bed.` });
    } else if (is === "error") {
      news.push({ printerId: p.id, title: `${p.name} needs you`, body: snap.live[p.id]?.error ?? "The printer stopped." });
    } else if (is === "paused" && RUNNING.includes(was)) {
      news.push({ printerId: p.id, title: `${p.name} is paused`, body: `${job} is paused. The nozzle cools while it waits.` });
    }
  }
  return news;
}
