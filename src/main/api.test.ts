import { afterAll, afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { emptyFarm, FarmService } from "../core/farm";
import { SimulatedPrinter } from "../core/simulator";
import { startApi } from "./api";

let server: Server | null = null;
const tmp = mkdtempSync(join(tmpdir(), "opf-api-"));
const uploads = join(tmp, "uploads");
const uiRoot = join(tmp, "ui");
mkdirSync(join(uiRoot, "assets"), { recursive: true });
writeFileSync(join(uiRoot, "index.html"), "<!doctype html><title>OPF</title>");
writeFileSync(join(uiRoot, "assets", "app.js"), "console.log(1)");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let farm: FarmService;

function setup(token = "secret") {
  const data = emptyFarm();
  data.settings.api = { enabled: true, port: 0, token };
  farm = new FarmService(data, (cfg, emit) => new SimulatedPrinter(cfg, emit, { status: "idle" }), { persist: () => {}, slicer: () => ({ found: false, name: null, path: null }) });
  farm.start();
  server = startApi(farm, {
    uploads,
    uiRoot,
    act: async (name, args) => {
      try {
        return { ok: true, value: await farm.act(name, args) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  })!;
  return new Promise<string>((r) => server!.on("listening", () => r(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/v1`)));
}

afterEach(() => {
  server?.close();
  farm?.shutdown();
});

describe("local API", () => {
  it("refuses requests without the token", async () => {
    const base = await setup();
    expect((await fetch(`${base}/printers`)).status).toBe(401);
    expect((await fetch(`${base}/printers`, { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("lists printers with their queue and when they are free", async () => {
    const base = await setup();
    const id = farm.addPrinter({ name: "P1S-01", model: "Bambu Lab P1S", driver: "simulator" });
    farm.enqueue(id, { name: "Bracket", ref: "IITEG-1", minutes: 60, grams: 20, filaments: [], file: null, thumbnail: null, source: "estimate" });
    const res = await fetch(`${base}/printers`, { headers: { Authorization: "Bearer secret" } });
    const body = (await res.json()) as { free_at: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id, name: "P1S-01", queue: [{ name: "Bracket", ref: "IITEG-1", minutes: 60 }] });
    expect(Date.parse(body[0].free_at)).toBeGreaterThan(Date.now());
  });

  it("takes parts into the inbox and deletes them", async () => {
    const base = await setup();
    const h = { Authorization: "Bearer secret", "Content-Type": "application/json" };
    const post = await fetch(`${base}/inbox`, { method: "POST", headers: h, body: JSON.stringify({ name: "Wall bracket", qty: 8, ref: "IITEG-1052", material: "PETG", color: "#202224" }) });
    expect(post.status).toBe(201);
    const { id } = (await post.json()) as { id: string };
    const list = (await (await fetch(`${base}/inbox`, { headers: h })).json()) as unknown[];
    expect(list[0]).toMatchObject({ id, name: "Wall bracket", qty: 8, ref: "IITEG-1052", source: "api" });
    expect((await fetch(`${base}/inbox/${id}`, { method: "DELETE", headers: h })).status).toBe(204);
    expect(farm.view().data.inbox).toEqual([]);
  });

  it("rejects an inbox item without a name", async () => {
    const base = await setup();
    const res = await fetch(`${base}/inbox`, { method: "POST", headers: { Authorization: "Bearer secret" }, body: JSON.stringify({ qty: 2 }) });
    expect(res.status).toBe(400);
  });

  it("does not fetch the same outside order twice", () => {
    void setup();
    const item = { id: "1052", ref: "IITEG-1052", name: "Wall bracket", qty: 8, material: null, color: null, due: null, fileUrl: null, notes: null };
    expect(farm.receive("admin.iiteg.com", [item])).toBe(1);
    farm.removeInbox(farm.view().data.inbox[0].id);
    expect(farm.receive("admin.iiteg.com", [item])).toBe(0);
    expect(farm.view().data.inbox).toEqual([]);
  });

  /* ---- slicers sending plates, the way OrcaSlicer's OctoPrint host does ---- */

  const sliced = (secs: number, grams: number) => zipSync({
    "Metadata/slice_info.config": strToU8(`<config><plate><metadata key="index" value="1"/><metadata key="prediction" value="${secs}"/><metadata key="weight" value="${grams}"/><filament id="1" type="PLA" color="#161616" used_g="${grams}"/></plate></config>`),
    "Metadata/plate_1.gcode": strToU8("G28"),
    "Metadata/plate_1.png": new Uint8Array([137, 80, 78, 71]),
  });

  function upload(base: string, file: Uint8Array, name: string, print = false, headers: Record<string, string> = {}) {
    const form = new FormData();
    form.append("print", print ? "true" : "false");
    form.append("path", "");
    form.append("file", new Blob([new Uint8Array(file)]), name);
    return fetch(`${base}/api/files/local`, { method: "POST", body: form, headers });
  }

  it("answers OrcaSlicer's connection test like OctoPrint", async () => {
    const base = (await setup()).replace("/api/v1", "");
    const v = (await (await fetch(`${base}/api/version`)).json()) as { api: string; text: string };
    expect(v.api).toBeTruthy();
    expect(v.text.startsWith("OctoPrint")).toBe(true);
  });

  it("puts a plate sent to /octo/<printer> into that printer's queue, with time, grams and picture", async () => {
    const base = (await setup()).replace("/api/v1", "");
    const a = farm.addPrinter({ name: "A1", model: "Bambu Lab A1", driver: "simulator" });
    const res = await upload(`${base}/octo/${a}`, sliced(5400, 42), "Bracket_x4.gcode.3mf");
    expect(res.status).toBe(201);
    expect(((await res.json()) as { done: boolean }).done).toBe(true);
    const q = farm.view().data.queues[a];
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ name: "Bracket x4", minutes: 90, grams: 42, source: "slicer", plate: 1 });
    expect(q[0].thumbnail).toMatch(/^data:image\/png/);
    expect(readdirSync(uploads).some((f) => f.endsWith("Bracket_x4.gcode.3mf"))).toBe(true);
  });

  it("chooses a printer for a plate sent to the farm's own address", async () => {
    const base = (await setup()).replace("/api/v1", "");
    const busy = farm.addPrinter({ name: "Busy", model: "m", driver: "simulator" });
    const free = farm.addPrinter({ name: "Free", model: "m", driver: "simulator" });
    farm.enqueue(busy, { name: "long", ref: null, minutes: 600, grams: 1, filaments: [], file: null, thumbnail: null, source: "estimate" });
    await new Promise((r) => setTimeout(r, 50));
    const res = await upload(base, sliced(600, 5), "clip.gcode.3mf");
    expect(((await res.json()) as { opf: { printer: string } }).opf.printer).toBe(free);
  });

  it("starts the plate at once on 'Upload and print' when the printer is free", async () => {
    const base = (await setup()).replace("/api/v1", "");
    const a = farm.addPrinter({ name: "A1", model: "m", driver: "simulator" });
    await new Promise((r) => setTimeout(r, 50));
    await upload(`${base}/octo/${a}`, sliced(60, 1), "now.gcode.3mf", true);
    expect(farm.view().data.current[a]?.name).toBe("now");
  });

  it("refuses an unsliced file and an unknown printer", async () => {
    const base = (await setup()).replace("/api/v1", "");
    farm.addPrinter({ name: "A1", model: "m", driver: "simulator" });
    const bad = await upload(base, zipSync({ "3D/3dmodel.model": strToU8("<model/>") }), "raw.3mf");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/not been sliced/);
    expect((await upload(`${base}/octo/nope`, sliced(60, 1), "x.gcode.3mf")).status).toBe(404);
  });

  it("serves the farm page and its live data to this computer", async () => {
    const base = (await setup()).replace("/api/v1", "");
    const a = farm.addPrinter({ name: "A1", model: "m", driver: "simulator" });
    expect(await (await fetch(`${base}/`)).text()).toContain("<title>OPF</title>");
    expect(await (await fetch(`${base}/octo/${a}/`)).text()).toContain("<title>OPF</title>");
    expect(await (await fetch(`${base}/octo/${a}/assets/app.js`)).text()).toContain("console.log");
    // Paths that try to climb out of the app folder get the page, never the file.
    for (const p of ["/..%2f..%2f..%2fetc%2fpasswd", "/assets/..%2f..%2f..%2fetc/passwd"]) {
      expect(await (await fetch(`${base}${p}`)).text()).not.toContain("root:");
    }
    const snap = (await (await fetch(`${base}/api/v1/ui/snapshot`)).json()) as { data: { printers: unknown[] } };
    expect(snap.data.printers).toHaveLength(1);
    const act = await fetch(`${base}/api/v1/ui/act`, { method: "POST", body: JSON.stringify({ name: "addShelf", args: ["Wall"] }) });
    expect(((await act.json()) as { ok: boolean }).ok).toBe(true);
    const bad = await fetch(`${base}/api/v1/ui/act`, { method: "POST", body: JSON.stringify({ name: "shutdown", args: [] }) });
    expect(((await bad.json()) as { ok: boolean; error: string })).toMatchObject({ ok: false });
  });
});
