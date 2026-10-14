// OPF's local HTTP API, for other software on this computer or network.
//
//   GET    /api/v1/printers              every printer, its live state and queue
//   GET    /api/v1/printers/:id          one printer
//   GET    /api/v1/inbox                 parts waiting to be put on a plate
//   POST   /api/v1/inbox                 send parts to OPF
//   DELETE /api/v1/inbox/:id
//
// Send `Authorization: Bearer <token>`; the token is in OPF's Settings.
// Listens on 127.0.0.1 only unless Settings say otherwise.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { schedulePrinter } from "../core/schedule";
import type { FarmService } from "../core/farm";

export function printerView(farm: FarmService, id?: string) {
  const { data, live } = farm.view();
  const now = new Date();
  const list = data.printers
    .filter((p) => !id || p.id === id)
    .map((p) => {
      const l = live[p.id];
      const { slots } = schedulePrinter(data.settings, l, data.current[p.id], data.queues[p.id] ?? [], now);
      return {
        id: p.id,
        name: p.name,
        model: p.model,
        status: l?.status ?? "offline",
        progress: l?.progress ?? 0,
        remaining_sec: l?.remainingSec ?? null,
        error: l?.error ?? null,
        filament: (l?.ams ?? []).flatMap((u) => u.slots).concat(l?.external ? [l.external] : []).map((s) => ({ unit: s.unit, slot: s.slot, color: s.color, material: s.material, remain_pct: s.remainPct })),
        current: data.current[p.id] ? { id: data.current[p.id]!.id, name: data.current[p.id]!.name, ref: data.current[p.id]!.ref } : null,
        queue: slots.filter((s) => !s.current).map((s) => ({ id: s.job.id, name: s.job.name, ref: s.job.ref, minutes: s.job.minutes, grams: s.job.grams, start: s.start.toISOString(), end: s.end.toISOString() })),
        free_at: (slots.length ? slots[slots.length - 1].end : now).toISOString(),
      };
    });
  return id ? list[0] ?? null : list;
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("Body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function startApi(farm: FarmService, host = "127.0.0.1"): Server | null {
  const { api } = farm.settings;
  if (!api.enabled) return null;
  const server = createServer(async (req, res) => {
    try {
      const token = farm.settings.api.token;
      if (token && req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: "Send Authorization: Bearer <token> from OPF's Settings." });
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["api","v1",...]
      if (parts[0] !== "api" || parts[1] !== "v1") return send(res, 404, { error: "Not found" });
      const [, , what, id] = parts;

      if (what === "printers" && req.method === "GET") {
        const v = printerView(farm, id);
        return v ? send(res, 200, v) : send(res, 404, { error: "No such printer" });
      }
      if (what === "inbox" && req.method === "GET" && !id) return send(res, 200, farm.view().data.inbox);
      if (what === "inbox" && req.method === "POST" && !id) {
        const b = (await readJson(req)) as Record<string, unknown>;
        const name = str(b.name);
        if (!name) return send(res, 400, { error: "name is required" });
        const qty = Math.max(1, Math.floor(Number(b.qty ?? 1)) || 1);
        const newId = farm.addInbox({
          ref: str(b.ref), name, qty, material: str(b.material), color: str(b.color), due: str(b.due),
          fileUrl: str(b.file_url), notes: str(b.notes), source: str(b.source) ?? "api",
        });
        return send(res, 201, { id: newId });
      }
      if (what === "inbox" && req.method === "DELETE" && id) {
        farm.removeInbox(id);
        return send(res, 204, {});
      }
      return send(res, 404, { error: "Not found" });
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  });
  server.on("error", (e) => console.error(`OPF API could not listen on ${host}:${api.port}:`, e.message));
  server.listen(api.port, host);
  return server;
}
