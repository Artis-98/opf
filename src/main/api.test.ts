import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { emptyFarm, FarmService } from "../core/farm";
import { SimulatedPrinter } from "../core/simulator";
import { startApi } from "./api";

let server: Server | null = null;
let farm: FarmService;

function setup(token = "secret") {
  const data = emptyFarm();
  data.settings.api = { enabled: true, port: 0, token };
  farm = new FarmService(data, (cfg, emit) => new SimulatedPrinter(cfg, emit, { status: "idle" }), { persist: () => {}, slicer: () => ({ found: false, name: null, path: null }) });
  farm.start();
  server = startApi(farm)!;
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
});
