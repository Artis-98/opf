import { describe, expect, it } from "vitest";
import { amsMapping, errorText, liveFromReport, mergeReport, trayColor } from "./bambu-report";

// Shaped like a real X1C report, trimmed to the fields OPF reads.
const full = {
  print: {
    gcode_state: "RUNNING",
    mc_percent: 42,
    mc_remaining_time: 95,
    layer_num: 120,
    total_layer_num: 310,
    subtask_name: "Enclosure lid",
    nozzle_temper: 219.6,
    nozzle_target_temper: 220,
    bed_temper: 64.8,
    bed_target_temper: 65,
    print_error: 0,
    ams: {
      tray_now: "1",
      ams: [{
        id: "0", humidity: "4", humidity_raw: "23", temp: "26.1",
        tray: [
          { id: "0", tray_color: "161616FF", tray_type: "PLA", tray_sub_brands: "PLA Basic", remain: 64 },
          { id: "1", tray_color: "FFFFFFFF", tray_type: "PETG", tray_sub_brands: "", remain: -1 },
          { id: "2" },
          { id: "3", tray_color: "00AE42FF", tray_type: "PLA", remain: 12 },
        ],
      }],
    },
    vt_tray: { id: "254", tray_color: "00000000", tray_type: "" },
  },
};

describe("liveFromReport", () => {
  it("reads progress, time, layers and temperatures", () => {
    const l = liveFromReport(full);
    expect(l).toMatchObject({ status: "printing", jobName: "Enclosure lid", progress: 0.42, remainingSec: 95 * 60, layer: 120, totalLayers: 310 });
    expect(l.nozzle).toEqual({ current: 219.6, target: 220 });
    expect(l.bed).toEqual({ current: 64.8, target: 65 });
    expect(l.error).toBeNull();
  });

  it("reads each AMS slot's colour, material and what is left", () => {
    const l = liveFromReport(full);
    expect(l.ams).toHaveLength(1);
    expect(l.ams![0]).toMatchObject({ id: 0, humidity: 23, tempC: 26.1 });
    expect(l.ams![0].slots).toEqual([
      { unit: 0, slot: 0, color: "#161616", material: "PLA Basic", remainPct: 64 },
      { unit: 0, slot: 1, color: "#FFFFFF", material: "PETG", remainPct: null },
      { unit: 0, slot: 2, color: null, material: null, remainPct: null },
      { unit: 0, slot: 3, color: "#00AE42", material: "PLA", remainPct: 12 },
    ]);
    expect(l.activeSlot).toBe("0:1");
    expect(l.external).toBeNull();
  });

  it("knows the external spool when one is set", () => {
    const l = liveFromReport({ print: { gcode_state: "IDLE", vt_tray: { tray_color: "F47B20FF", tray_type: "PLA" }, ams: { tray_now: "254" } } });
    expect(l.external).toEqual({ unit: -1, slot: 0, color: "#F47B20", material: "PLA", remainPct: null });
    expect(l.activeSlot).toBe("-1:0");
  });

  it("maps every printer state", () => {
    const s = (gcode_state: string, print_error = 0) => liveFromReport({ print: { gcode_state, print_error } }).status;
    expect(s("IDLE")).toBe("idle");
    expect(s("PREPARE")).toBe("preparing");
    expect(s("RUNNING")).toBe("printing");
    expect(s("PAUSE")).toBe("paused");
    expect(s("PAUSE", 50348044)).toBe("error");
    expect(s("FINISH")).toBe("finished");
    expect(s("FAILED")).toBe("error");
  });

  it("does not report time left once the plate is finished", () => {
    expect(liveFromReport({ print: { gcode_state: "FINISH", mc_percent: 100, mc_remaining_time: 0 } })).toMatchObject({ remainingSec: 0, progress: 1 });
    expect(liveFromReport({ print: { gcode_state: "IDLE", mc_remaining_time: 12 } }).remainingSec).toBeNull();
  });
});

describe("mergeReport", () => {
  it("applies a P1-style partial update on top of the last full report", () => {
    const merged = mergeReport(full, { print: { mc_percent: 43, mc_remaining_time: 93 } });
    const l = liveFromReport(merged);
    expect(l.progress).toBe(0.43);
    expect(l.remainingSec).toBe(93 * 60);
    expect(l.jobName).toBe("Enclosure lid");
    expect(l.ams![0].slots).toHaveLength(4);
  });
  it("replaces arrays whole", () => {
    expect(mergeReport({ a: [1, 2, 3] }, { a: [9] })).toEqual({ a: [9] });
  });
});

describe("helpers", () => {
  it("reads tray colours", () => {
    expect(trayColor("ff8800ff")).toBe("#FF8800");
    expect(trayColor("00000000")).toBeNull();
    expect(trayColor("")).toBeNull();
    expect(trayColor(undefined)).toBeNull();
  });
  it("formats error numbers the way Bambu's wiki lists them", () => {
    expect(errorText({ print_error: 50348044 })).toMatch(/0300_400C/);
  });
  it("builds the AMS mapping for the start command", () => {
    expect(amsMapping([
      { unit: 0, slot: 2, color: null, material: null, remainPct: null },
      { unit: 1, slot: 0, color: null, material: null, remainPct: null },
      { unit: -1, slot: 0, color: null, material: null, remainPct: null },
      null,
    ])).toEqual([2, 4, 254, -1]);
  });
});
