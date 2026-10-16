import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./farm";
import { emptyLive } from "./driver";
import { inWorkingHours, nextStart, schedulePrinter } from "./schedule";
import type { PlateJob, Settings } from "./types";

const S: Settings = { ...DEFAULT_SETTINGS, workStart: 8, workEnd: 20, workDays: "1111100", overnightOk: true, changeoverMin: 10 };
// Wednesday 14 Oct 2026
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0, 0);
const job = (minutes: number, name = "plate"): PlateJob => ({ id: name, name, ref: null, minutes, grams: 10, filaments: [], file: null, thumbnail: null, source: "estimate", createdAt: 0 });

describe("nextStart", () => {
  it("starts now inside working hours", () => {
    expect(nextStart(S, at(14, 10), 60)).toEqual(at(14, 10));
  });
  it("waits for the morning after hours", () => {
    expect(nextStart(S, at(14, 21), 60)).toEqual(at(15, 8));
  });
  it("waits for opening before hours", () => {
    expect(nextStart(S, at(14, 6, 30), 60)).toEqual(at(14, 8));
  });
  it("skips the weekend", () => {
    // Friday 16 Oct, 20:30 → Monday 19 Oct, 08:00
    expect(nextStart(S, at(16, 20, 30), 60)).toEqual(at(19, 8));
  });
  it("lets a long plate start late when overnight running is allowed", () => {
    expect(nextStart(S, at(14, 19), 600)).toEqual(at(14, 19));
  });
  it("holds a long plate for the morning when it would run past closing", () => {
    expect(nextStart({ ...S, overnightOk: false }, at(14, 15), 600)).toEqual(at(15, 8));
  });
  it("refuses a plate longer than the day when overnight running is off", () => {
    expect(() => nextStart({ ...S, overnightOk: false }, at(14, 9), 13 * 60)).toThrow();
  });
  it("treats a window that ends before it starts as always open", () => {
    expect(nextStart({ ...S, workStart: 20, workEnd: 8 }, at(14, 3), 60)).toEqual(at(14, 3));
  });
});

describe("inWorkingHours", () => {
  it("knows opening, closing and weekends", () => {
    expect(inWorkingHours(S, at(14, 8))).toBe(true);
    expect(inWorkingHours(S, at(14, 20))).toBe(false);
    expect(inWorkingHours(S, at(17, 12))).toBe(false); // Saturday
  });
});

describe("schedulePrinter", () => {
  it("puts the running plate first and queues after it with a bed change", () => {
    const live = { ...emptyLive("printing"), remainingSec: 3600, progress: 0.5 };
    const { slots } = schedulePrinter(S, live, job(120, "cur"), [job(60, "a"), job(30, "b")], at(14, 10));
    expect(slots.map((s) => s.job.id)).toEqual(["cur", "a", "b"]);
    expect(slots[0].end).toEqual(at(14, 11));
    expect(slots[0].start).toEqual(at(14, 9));
    expect(slots[1].start).toEqual(at(14, 11, 10));
    expect(slots[1].end).toEqual(at(14, 12, 10));
    expect(slots[2].start).toEqual(at(14, 12, 20));
  });

  it("does not count a finished plate still on the bed as running", () => {
    const live = { ...emptyLive("finished"), remainingSec: 0, progress: 1 };
    const { slots } = schedulePrinter(S, live, job(120, "done"), [job(60, "a")], at(14, 10));
    expect(slots.map((s) => s.job.id)).toEqual(["a"]);
    expect(slots[0].start).toEqual(at(14, 10, 10));
  });

  it("pushes the next plate to the morning when the current one ends at night", () => {
    const live = { ...emptyLive("printing"), remainingSec: 4 * 3600, progress: 0.2 };
    const { slots } = schedulePrinter(S, live, job(300, "cur"), [job(60, "a")], at(14, 18));
    expect(slots[0].end).toEqual(at(14, 22));
    expect(slots[1].start).toEqual(at(15, 8));
  });

  it("uses progress when the printer has not reported time left", () => {
    const live = { ...emptyLive("printing"), remainingSec: null, progress: 0.75 };
    const { slots } = schedulePrinter(S, live, job(120, "cur"), [], at(14, 10));
    expect(slots[0].end).toEqual(at(14, 10, 30));
  });

  it("lists plates that can never fit instead of inventing a date", () => {
    const { slots, unschedulable } = schedulePrinter({ ...S, overnightOk: false }, emptyLive("idle"), null, [job(60, "ok"), job(14 * 60, "huge")], at(14, 10));
    expect(slots.map((s) => s.job.id)).toEqual(["ok"]);
    expect(unschedulable.map((j) => j.id)).toEqual(["huge"]);
  });
});
