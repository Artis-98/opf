// When each plate actually comes off the printer.
//
// A forward walk over one printer's queue, not an optimiser. A print can run
// unattended, but starting the next plate needs a person to take the parts off,
// so a plate may only start inside working hours on a working day. When the
// farm does not allow overnight running, the plate must also finish before
// everyone leaves, which pushes a long plate to the next morning.
//
// Same rules as the scheduler in iiteg-admin-hub, so dates promised to a
// customer there and here agree.

import type { LiveState, PlateJob, Settings } from "./types";

export interface Slot {
  job: PlateJob;
  start: Date;
  end: Date;
  /** The plate on the printer now. */
  current: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function atHour(day: Date, hour: number): Date {
  const out = startOfDay(day);
  out.setHours(hour, 0, 0, 0); // setHours(24) rolls to next midnight, which is what workEnd 24 means
  return out;
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function isWorkDay(s: Settings, d: Date): boolean {
  const days = (s.workDays || "1111111").padEnd(7, "1");
  return days[weekdayIndex(d)] === "1";
}

/** Is someone in the workshop at this moment? */
export function inWorkingHours(s: Settings, d: Date): boolean {
  if (s.workEnd <= s.workStart) return true;
  return isWorkDay(s, d) && d >= atHour(d, s.workStart) && d < atHour(d, s.workEnd);
}

/**
 * The first moment at or after `from` that a plate of `minutes` may start.
 * Throws when nothing can ever fit, rather than promising a date that depends
 * on a print running unattended.
 */
export function nextStart(s: Settings, from: Date, minutes: number): Date {
  if (s.workEnd <= s.workStart) return new Date(from); // nonsense window: treat as always on
  let day = startOfDay(from);
  for (let i = 0; i < 400; i++) {
    if (isWorkDay(s, day)) {
      const open = atHour(day, s.workStart);
      const close = atHour(day, s.workEnd);
      const earliest = from > open ? from : open;
      if (earliest < close) {
        if (s.overnightOk) return earliest;
        if (earliest.getTime() + minutes * 60000 <= close.getTime()) return earliest;
      }
    }
    day = startOfDay(new Date(day.getTime() + 1.5 * DAY_MS)); // next day, safe across DST
  }
  throw new Error(`A ${minutes}-minute plate never fits inside working hours with overnight printing off.`);
}

/**
 * Every plate for one printer, in order, with when it starts and finishes.
 * Plates that can never fit are left out of the result and listed in `unschedulable`.
 */
export function schedulePrinter(
  s: Settings,
  live: LiveState | undefined,
  current: PlateJob | null,
  queue: PlateJob[],
  now: Date = new Date(),
): { slots: Slot[]; unschedulable: PlateJob[] } {
  const slots: Slot[] = [];
  const unschedulable: PlateJob[] = [];
  let t = now;

  const running = live && (live.status === "printing" || live.status === "paused" || live.status === "preparing" || live.status === "error");
  if (current && running) {
    const remainingSec = live.remainingSec ?? Math.round(current.minutes * 60 * (1 - (live.progress ?? 0)));
    const total = current.minutes * 60;
    const end = new Date(now.getTime() + remainingSec * 1000);
    slots.push({ job: current, start: new Date(now.getTime() - Math.max(0, total - remainingSec) * 1000), end, current: true });
    t = end;
  }

  for (const job of queue) {
    const ready = new Date(t.getTime() + s.changeoverMin * 60000);
    let start: Date;
    try {
      start = nextStart(s, ready, job.minutes);
    } catch {
      unschedulable.push(job);
      continue;
    }
    const end = new Date(start.getTime() + job.minutes * 60000);
    slots.push({ job, start, end, current: false });
    t = end;
  }
  return { slots, unschedulable };
}

/** When this printer has nothing left to do. */
export function freeAt(slots: Slot[], now: Date = new Date()): Date {
  return slots.length ? slots[slots.length - 1].end : now;
}
