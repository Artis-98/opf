import { describe, expect, it } from "vitest";
import { applyReport, emptyAnycubic, liveFromAnycubic, startData, statusOf } from "./anycubic-report";

// Report shapes as captured from Kobra 3 / S1 printers in LAN mode (see the module's notes).
const info = (data: object) => ({ type: "info", action: "report", data });

describe("Anycubic reports", () => {
  it("reads a print in progress from the info report, then progress from print reports", () => {
    let s = applyReport(emptyAnycubic(), "info", info({
      state: "busy",
      temp: { curr_hotbed_temp: 59, curr_nozzle_temp: 214, target_hotbed_temp: 60, target_nozzle_temp: 215 },
      project: { state: "printing", progress: 12, remain_time: 95, curr_layer: 20, total_layers: 300, filename: "Clips.gcode", pause: 0 },
      urls: { fileUploadurl: "http://192.168.1.50:18910/gcode_upload?s=abc", rtspUrl: "http://192.168.1.50:18088/flv" },
    }));
    s = applyReport(s, "print", { type: "print", action: "report", data: { progress: 40, remain_time: 60, curr_layer: 120, total_layers: 300, filename: "Clips.gcode" } });
    s = applyReport(s, "tempature", { type: "tempature", data: { curr_nozzle_temp: 215 } });
    const live = liveFromAnycubic(s);
    expect(live).toMatchObject({ status: "printing", jobName: "Clips.gcode", progress: 0.4, remainingSec: 3600, layer: 120, totalLayers: 300 });
    expect(live.nozzle).toEqual({ current: 215, target: 215 });
    expect(live.bed).toEqual({ current: 59, target: 60 });
    expect(s.uploadUrl).toBe("http://192.168.1.50:18910/gcode_upload?s=abc");
  });

  it("knows heating, paused, finished and stopped, and idle once the print is gone", () => {
    const st = (project: object | null, state = "busy") => statusOf(applyReport(emptyAnycubic(), "info", info({ state, project })));
    expect(st({ state: "preheating" })).toBe("preparing");
    expect(st({ state: "auto_leveling" })).toBe("preparing");
    expect(st({ state: "paused", pause: 1 })).toBe("paused");
    expect(st({ state: "finished" })).toBe("finished");
    expect(st({ state: "stoped" })).toBe("idle");
    expect(st(null, "free")).toBe("idle");
    expect(st(null, "busy")).toBe("preparing"); // loading filament: not free for a plate
  });

  it("ignores command answers on the print topic", () => {
    const s = applyReport(emptyAnycubic(), "print", { type: "print", action: "pause", data: { taskid: "-1" } });
    expect(s.project).toBeNull();
  });

  it("reads the ACE slots, merging reports that carry only some of them", () => {
    let s = applyReport(emptyAnycubic(), "multiColorBox", { type: "multiColorBox", data: { multi_color_box: [{
      id: 0, humidity: 24, temp: 35, loaded_slot: 1,
      slots: [
        { index: 0, type: "PLA", color: [255, 255, 255], consumables_percent: 80, status: 5 },
        { index: 1, type: "PETG", color: [214, 58, 47], consumables_percent: 100, status: 5 },
        { index: 2, type: "", color: [0, 0, 0], status: 0 },
      ],
    }] } });
    s = applyReport(s, "multiColorBox", { type: "multiColorBox", data: { multi_color_box: [{ id: 0, slots: [{ index: 0, consumables_percent: 75 }] }] } });
    const live = liveFromAnycubic(s);
    expect(live.ams).toEqual([{ id: 0, humidity: 24, tempC: 35, slots: [
      { unit: 0, slot: 0, color: "#FFFFFF", material: "PLA", remainPct: 75 },
      { unit: 0, slot: 1, color: "#D63A2F", material: "PETG", remainPct: 100 },
      { unit: 0, slot: 2, color: null, material: null, remainPct: null },
    ] }]);
    expect(live.activeSlot).toBe("0:1");
    expect(live.external).toBeNull();
  });

  it("without an ACE, has one spool that takes any plate", () => {
    expect(liveFromAnycubic(emptyAnycubic()).external).toEqual({ unit: -1, slot: 0, color: null, material: null, remainPct: null });
  });
});

describe("the start command", () => {
  const file = { filename: "Clips-j-1.gcode", md5: "abc", size: 1234 };

  it("maps each of the plate's filaments to its ACE slot, by the slicer's filament number", () => {
    const d = startData(file, [{ color: "#FF0000", material: "PLA", grams: 3, index: 2 }], [{ unit: 0, slot: 3, color: "#EE1010", material: "PLA", remainPct: 50 }]);
    expect(d).toMatchObject({ taskid: "-1", url: "", filename: "Clips-j-1.gcode", md5: "abc", filetype: 1, filesize: 1234 });
    expect(d.ams_settings).toEqual({ use_ams: true, ams_box_mapping: [
      { paint_index: 2, ams_index: 3, paint_color: [255, 0, 0, 255], ams_color: [238, 16, 16, 255], material_type: "PLA" },
    ] });
    expect(d.task_settings.auto_leveling).toBe(1);
  });

  it("prints from the printer's own spool when there is no ACE", () => {
    const d = startData(file, [{ color: "#FF0000", material: "PLA", grams: 3 }], [{ unit: -1, slot: 0, color: null, material: null, remainPct: null }]);
    expect(d.ams_settings).toEqual({ use_ams: false, ams_box_mapping: [] });
  });
});
