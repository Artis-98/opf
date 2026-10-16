// A believable farm of simulated printers, for the browser demo and the
// "Try the demo farm" button. Nothing here talks to real hardware.

import { DEFAULT_SETTINGS } from "./farm";
import { amsOf, SimulatedPrinter, type SimScenario } from "./simulator";
import type { DriverFactory } from "./driver";
import { NotYetSupported } from "./driver";
import type { FarmData, PlateJob, PrinterConfig } from "./types";

const C = {
  black: "#202224", white: "#F1F1EE", green: "#00AE42", orange: "#F47B20", grey: "#8E9399",
  blue: "#2F6FD6", red: "#D63A2F", yellow: "#F2C230",
};

let n = 0;
function job(name: string, ref: string | null, minutes: number, grams: number, fil: [keyof typeof C, string][]): PlateJob {
  const total = fil.length;
  return {
    id: `demo-j${++n}`, name, ref, minutes, grams,
    filaments: fil.map(([c, m]) => ({ color: C[c], material: m, grams: Math.round(grams / total) })),
    file: null, thumbnail: null, source: "estimate", createdAt: Date.now(),
  };
}

const P = (id: string, name: string, model: string, enclosed = true): PrinterConfig => ({ id, name, model, driver: "simulator", enclosed });

export function demoFarm(): { data: FarmData; scenarios: Record<string, SimScenario> } {
  n = 0;
  const printers: PrinterConfig[] = [
    P("x1c-01", "X1C-01", "Bambu Lab X1 Carbon"), P("x1c-02", "X1C-02", "Bambu Lab X1 Carbon"),
    P("h2d-01", "H2D-01", "Bambu Lab H2D"), P("x1c-03", "X1C-03", "Bambu Lab X1 Carbon"),
    P("p1s-01", "P1S-01", "Bambu Lab P1S"), P("p1s-02", "P1S-02", "Bambu Lab P1S"),
    P("p1s-03", "P1S-03", "Bambu Lab P1S"), P("p1s-04", "P1S-04", "Bambu Lab P1S"),
    P("a1-01", "A1-01", "Bambu Lab A1", false), P("a1-02", "A1-02", "Bambu Lab A1", false),
    { ...P("mk4-01", "MK4S-01", "Prusa MK4S", false), driver: "prusalink" },
    { ...P("vrn-01", "VORON-01", "Voron 2.4 350"), driver: "moonraker" },
  ];

  const current: FarmData["current"] = {
    "x1c-01": job("Enclosure lid", "IITEG-1042", 214, 96, [["black", "PLA"]]),
    "x1c-02": job("Fan duct v3", null, 132, 41, [["orange", "PLA"], ["black", "PLA"]]),
    "x1c-03": job("Spool holder arm", "IITEG-1039", 176, 64, [["green", "PLA"]]),
    "p1s-01": job("Wall bracket ×10", "IITEG-1046", 248, 118, [["black", "PETG"]]),
    "p1s-02": job("Knob set", "IITEG-1043", 88, 30, [["red", "PLA"], ["black", "PLA"]]),
    "p1s-03": job("Tray dividers", "IITEG-1041", 142, 70, [["grey", "PETG"]]),
    "p1s-04": job("Badge holders ×16", "IITEG-1050", 64, 19, [["yellow", "PLA"], ["black", "PLA"]]),
    "a1-02": job("Plant pot", "IITEG-1040", 230, 102, [["green", "PLA"]]),
  };

  const queues: FarmData["queues"] = {
    "x1c-01": [job("Enclosure base", "IITEG-1042", 262, 131, [["black", "PLA"]]), job("Cable clips ×24", "IITEG-1044", 96, 38, [["white", "PLA"]])],
    "x1c-02": [job("Sensor mounts ×6", "IITEG-1045", 118, 44, [["grey", "PETG"]])],
    "h2d-01": [job("Gear housing", "IITEG-1047", 305, 152, [["blue", "PETG"], ["black", "PETG"]]), job("Name tags ×12", "IITEG-1048", 74, 22, [["white", "PLA"], ["black", "PLA"]])],
    "x1c-03": [job("Hinge pins ×40", "IITEG-1039", 58, 15, [["white", "PLA"]])],
    "p1s-01": [],
    "p1s-02": [job("Panel clips ×30", "IITEG-1043", 102, 33, [["black", "PLA"]]), job("Lamp shade", "IITEG-1049", 396, 188, [["white", "PLA"]])],
    "p1s-03": [job("Tray dividers (2/2)", "IITEG-1041", 142, 70, [["grey", "PETG"]])],
    "p1s-04": [job("Desk organiser", null, 188, 92, [["orange", "PLA"]])],
    "a1-01": [], "a1-02": [],
    "mk4-01": [job("Jig plate", null, 160, 74, [["orange", "PETG"]])],
    "vrn-01": [job("Chassis rails ×4", "IITEG-1051", 420, 210, [["black", "ABS"]])],
  };

  const scenarios: Record<string, SimScenario> = {
    "x1c-01": { status: "printing", jobName: "Enclosure lid", totalSec: 214 * 60, remainingSec: 5960, ams: amsOf([C.black, "PLA", 64], [C.white, "PLA", 80], [C.green, "PLA", 35], [C.orange, "PLA", 92]) },
    "x1c-02": { status: "printing", jobName: "Fan duct v3", totalSec: 132 * 60, remainingSec: 2240, ams: amsOf([C.orange, "PLA", 40], [C.black, "PLA", 71], [C.grey, "PETG", 55], [C.white, "PLA", 18]) },
    "h2d-01": { status: "idle", ams: amsOf([C.blue, "PETG", 88], [C.black, "PETG", 60], [C.white, "PLA", 47], [C.grey, "PETG", 21]) },
    "x1c-03": { status: "error", jobName: "Spool holder arm", totalSec: 176 * 60, remainingSec: 6800, error: "Spaghetti detected at layer 87. The print is paused.", ams: amsOf([C.green, "PLA", 52], [C.white, "PLA", 77], [C.black, "PLA", 12], [C.yellow, "PLA", 66]) },
    "p1s-01": { status: "printing", jobName: "Wall bracket ×10", totalSec: 248 * 60, remainingSec: 11600, nozzleTarget: 250, bedTarget: 70, ams: amsOf([C.black, "PETG", 74], [C.grey, "PETG", 30], [C.white, "PLA", 90], [C.blue, "PETG", 44]) },
    "p1s-02": { status: "printing", jobName: "Knob set", totalSec: 88 * 60, remainingSec: 1490, ams: amsOf([C.red, "PLA", 61], [C.black, "PLA", 25], [C.white, "PLA", 83], [C.orange, "PLA", 50]) },
    "p1s-03": { status: "finished", jobName: "Tray dividers", ams: amsOf([C.grey, "PETG", 38], [C.white, "PLA", 70], [C.black, "PLA", 55], [C.green, "PLA", 81]) },
    "p1s-04": { status: "printing", jobName: "Badge holders ×16", totalSec: 64 * 60, remainingSec: 75, ams: amsOf([C.yellow, "PLA", 49], [C.black, "PLA", 33], [C.white, "PLA", 64], [C.red, "PLA", 72]) },
    "a1-01": { status: "idle", ams: amsOf([C.white, "PLA", 95], [C.green, "PLA", 40], [C.orange, "PLA", 58], [C.black, "PLA", 77]) },
    "a1-02": { status: "paused", jobName: "Plant pot", totalSec: 230 * 60, remainingSec: 4300, ams: amsOf([C.green, "PLA", 29], [C.white, "PLA", 66], [C.orange, "PLA", 81], [C.black, "PLA", 47]) },
    "mk4-01": { status: "printing", jobName: "Jig plate", totalSec: 160 * 60, remainingSec: 7420, nozzleTarget: 240, bedTarget: 85, ams: [{ id: 0, humidity: null, tempC: null, slots: [{ unit: 0, slot: 0, color: C.orange, material: "PETG", remainPct: null }] }] },
  };

  const data: FarmData = {
    version: 1,
    shelves: [
      { id: "shelf-a", name: "Shelf A · enclosed", slots: ["x1c-01", "x1c-02", "h2d-01", "x1c-03", null] },
      { id: "shelf-b", name: "Shelf B · P1S line", slots: ["p1s-01", "p1s-02", "p1s-03", "p1s-04", null] },
      { id: "shelf-c", name: "Shelf C · open frame", slots: ["a1-01", "a1-02", "mk4-01", "vrn-01", null] },
    ],
    printers,
    current,
    queues,
    inbox: [
      { id: "in-1052", ref: "IITEG-1052", name: "Wall bracket", qty: 8, material: "PETG", color: C.black, due: "2026-10-17", fileUrl: null, notes: null, source: "admin.iiteg.com", receivedAt: Date.now() },
      { id: "in-1053", ref: "IITEG-1053", name: "Cable grommet", qty: 16, material: "PLA", color: C.black, due: "2026-10-20", fileUrl: null, notes: null, source: "admin.iiteg.com", receivedAt: Date.now() },
      { id: "in-1054", ref: "IITEG-1054", name: "Display stand", qty: 2, material: "PLA", color: C.white, due: "2026-10-22", fileUrl: null, notes: null, source: "admin.iiteg.com", receivedAt: Date.now() },
    ],
    history: [],
    sourceSeen: [],
    settings: { ...DEFAULT_SETTINGS, api: { ...DEFAULT_SETTINGS.api, token: "demo" } },
  };
  return { data, scenarios };
}

/**
 * Simulated printers for the demo. The Prusa and Voron are simulated as well
 * in the demo so the farm looks alive, except the Voron, which shows as
 * offline the way an unsupported or unplugged printer does.
 */
export function demoFactory(scenarios: Record<string, SimScenario>, speed = 1): DriverFactory {
  return (cfg, emit) => {
    if (cfg.id === "vrn-01") return new NotYetSupported({ ...cfg, driver: "moonraker" }, (p) => emit({ ...p, error: "Last seen 2 hours ago. Check power and network." }));
    return new SimulatedPrinter(cfg, emit, scenarios[cfg.id] ?? {}, speed);
  };
}
