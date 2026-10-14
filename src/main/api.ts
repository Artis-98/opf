// OPF's local web server. One port (7878 by default) serves:
//
//   /                          the farm, as a web page (the same window as the app)
//   /api/v1/ui/...             what that page uses: snapshot, actions, live events
//   /api/v1/printers, /inbox   the API for other software (token required)
//   /api/version, /api/files/local
//                              enough of OctoPrint's API for a slicer to send a
//                              sliced plate. OrcaSlicer, Bambu Studio's
//                              "third-party print host" and PrusaSlicer can all
//                              use it.
//   /octo/<printer id>/...     the same, for one printer: a slicer set up with
//                              this address sends plates straight to that
//                              printer's queue, and shows that printer's page.
//
// From this computer no token is needed for the page and for slicers; from
// anywhere else send the token (Authorization: Bearer, X-Api-Key, or ?token=).
// The API for other software always needs it.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import busboy from "busboy";
import { schedulePrinter } from "../core/schedule";
import { bestPrinter } from "../core/assign";
import { newId, type FarmService } from "../core/farm";
import type { PlateJob } from "../core/types";
import type { Result } from "../preload/api";
import { readPlateFile } from "./plate-file";

export interface ServerOptions {
  /** 127.0.0.1 keeps OPF to this computer. */
  host?: string;
  /** The built window (out/renderer), served as the web page. */
  uiRoot?: string | null;
  /** Where sliced files sent by slicers are kept. */
  uploads: string;
  /** Runs a window action, with the app's side effects (saving settings, telling admin.iiteg). */
  act: (name: string, args: unknown[]) => Promise<Result<unknown>>;
}

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
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(code === 204 ? undefined : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 50_000_000) throw new Error("Body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function isLoopback(req: IncomingMessage) {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

function tokenOk(req: IncomingMessage, url: URL, token: string) {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}` || req.headers["x-api-key"] === token || url.searchParams.get("token") === token;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
  ".woff": "font/woff", ".woff2": "font/woff2",
};

function serveStatic(res: ServerResponse, root: string, path: string) {
  const base = resolve(root);
  let file = resolve(base, "." + normalize(decodeURIComponent(path)));
  if (!file.startsWith(base + sep) && file !== base) return send(res, 403, { error: "Forbidden" });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(base, "index.html"); // the page handles its own paths
  if (!existsSync(file)) return send(res, 404, { error: "The window is not built. Run npm run build." });
  const isIndex = file.endsWith("index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": isIndex ? "no-cache" : "max-age=31536000, immutable" });
  createReadStream(file).pipe(res);
}

/** A slicer's upload: the multipart form OctoPrint takes (print, path, plateindex, file). */
function receiveUpload(req: IncomingMessage, dir: string): Promise<{ fields: Record<string, string>; file: string; filename: string }> {
  return new Promise((resolvePromise, reject) => {
    mkdirSync(dir, { recursive: true });
    const fields: Record<string, string> = {};
    let file: string | null = null;
    let filename = "";
    let writing: Promise<void> = Promise.resolve();
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { fileSize: 2 * 1024 ** 3, files: 1 } });
    } catch {
      return reject(new Error("Expected a file upload (multipart/form-data)."));
    }
    bb.on("field", (name, value) => (fields[name] = value));
    bb.on("file", (_name, stream, info) => {
      filename = info.filename || "plate.gcode.3mf";
      // Keep the extension: the reader tells .gcode from .gcode.3mf by it.
      file = join(dir, `incoming-${newId("")}${/\.gcode$/i.test(filename) ? ".gcode" : ".gcode.3mf"}`);
      const out = createWriteStream(file);
      writing = new Promise((ok, fail) => {
        out.on("finish", ok);
        out.on("error", fail);
      });
      stream.pipe(out);
    });
    bb.on("error", reject);
    bb.on("close", () => {
      writing.then(() => (file ? resolvePromise({ fields, file, filename }) : reject(new Error("No file in the upload."))), reject);
    });
    req.pipe(bb);
  });
}

export function plateName(filename: string) {
  return filename.replace(/\.(gcode\.3mf|3mf|gcode)$/i, "").replace(/[_]+/g, " ").trim() || "Plate";
}

export function startApi(farm: FarmService, opts: ServerOptions): Server | null {
  const { api } = farm.settings;
  if (!api.enabled) return null;
  const host = opts.host ?? "127.0.0.1";

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const token = farm.settings.api.token;
      const local = isLoopback(req) || tokenOk(req, url, token);

      // /octo/<printer id>/… is the same server, for one printer.
      const octo = /^\/octo\/([^/]+)(\/.*)?$/.exec(url.pathname);
      const printerId = octo ? decodeURIComponent(octo[1]) : null;
      const path = octo ? octo[2] || "/" : url.pathname;
      if (printerId && !farm.view().data.printers.some((p) => p.id === printerId)) return send(res, 404, { error: `OPF has no printer ${printerId}.` });

      /* ---- the web page's own API ---- */
      if (path.startsWith("/api/v1/ui/")) {
        if (!local) return send(res, 401, { error: "Add ?token=<token from OPF's Settings> to the address." });
        const what = path.slice("/api/v1/ui/".length);
        if (what === "snapshot" && req.method === "GET") return send(res, 200, farm.snapshot());
        if (what === "act" && req.method === "POST") {
          const b = (await readJson(req)) as { name?: string; args?: unknown[] };
          return send(res, 200, await opts.act(String(b.name), Array.isArray(b.args) ? b.args : []));
        }
        if (what === "events" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
          const push = (s: unknown) => res.write(`data: ${JSON.stringify(s)}\n\n`);
          push(farm.snapshot());
          const off = farm.subscribe(push);
          const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
          req.on("close", () => {
            off();
            clearInterval(ping);
          });
          return;
        }
        return send(res, 404, { error: "Not found" });
      }

      /* ---- OctoPrint, for slicers ---- */
      if (path === "/api/version" && req.method === "GET") {
        if (!local) return send(res, 403, { error: "Wrong API key. Use the token from OPF's Settings." });
        return send(res, 200, { api: "0.1", server: "1.10.0", text: "OctoPrint 1.10.0 (OPF)" });
      }
      if ((path === "/api/files/local" || path === "/api/files/sdcard") && req.method === "POST") {
        if (!local) return send(res, 403, { error: "Wrong API key. Use the token from OPF's Settings." });
        const up = await receiveUpload(req, opts.uploads);
        const plate = Math.max(1, parseInt(up.fields.plateindex ?? "1", 10) || 1);
        let info;
        try {
          info = await readPlateFile(up.file, plate);
        } catch (e) {
          if (existsSync(up.file)) unlinkSync(up.file);
          return send(res, 400, { error: (e as Error).message });
        }
        const jobId = newId("j-");
        const finalPath = join(opts.uploads, `${jobId}-${up.filename.replace(/[^A-Za-z0-9._-]/g, "_")}`);
        renameSync(up.file, finalPath);
        const job: Omit<PlateJob, "id" | "createdAt"> & { id: string } = {
          id: jobId, name: plateName(up.filename) + (plate > 1 ? ` (plate ${plate})` : ""), ref: null,
          minutes: info.minutes, grams: info.grams, filaments: info.filaments, file: finalPath, plate,
          thumbnail: info.thumbnail, source: "slicer",
        };
        const { data, live } = farm.view();
        const target = printerId ?? bestPrinter(data, live, job);
        if (!target) return send(res, 409, { error: "No printer in OPF can take this plate: every printer is offline." });
        const startNow = up.fields.print === "true";
        const q = await opts.act("enqueue", [target, job, startNow ? "next" : "end"]);
        if (!q.ok) return send(res, 400, { error: q.error });
        if (startNow) {
          const v = farm.view();
          const l = v.live[target];
          if (!v.data.current[target] && l && l.status === "idle") await opts.act("startNext", [target]);
        }
        return send(res, 201, { done: true, files: { local: { name: up.filename, origin: "local" } }, opf: { printer: target, job: jobId } });
      }
      if (path === "/api/files" && req.method === "GET") return send(res, 200, { files: [], free: 0 });

      /* ---- API for other software ---- */
      if (path.startsWith("/api/v1/")) {
        if (token && !tokenOk(req, url, token)) return send(res, 401, { error: "Send Authorization: Bearer <token> from OPF's Settings." });
        const [what, id] = path.slice("/api/v1/".length).replace(/\/+$/, "").split("/");
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
          const added = farm.addInbox({
            ref: str(b.ref), name, qty, material: str(b.material), color: str(b.color), due: str(b.due),
            fileUrl: str(b.file_url), notes: str(b.notes), source: str(b.source) ?? "api",
          });
          return send(res, 201, { id: added });
        }
        if (what === "inbox" && req.method === "DELETE" && id) {
          farm.removeInbox(id);
          return send(res, 204, {});
        }
        return send(res, 404, { error: "Not found" });
      }
      if (path.startsWith("/api/")) return send(res, 404, { error: "Not found" });

      /* ---- the web page ---- */
      if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
      if (!local) return send(res, 401, { error: "Add ?token=<token from OPF's Settings> to the address." });
      if (!opts.uiRoot) return send(res, 404, { error: "This OPF has no web page built." });
      return serveStatic(res, opts.uiRoot, path);
    } catch (e) {
      if (!res.headersSent) send(res, 400, { error: (e as Error).message });
      else res.end();
    }
  });
  server.on("error", (e) => console.error(`OPF could not listen on ${host}:${api.port}:`, e.message));
  server.listen(api.port, host);
  return server;
}

/** Stop the server, including open live-event connections. */
export function stopApi(server: Server | null) {
  if (!server) return;
  server.closeAllConnections?.();
  server.close();
}
