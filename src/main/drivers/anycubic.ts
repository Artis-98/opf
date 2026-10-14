// Anycubic printers over the local network: Kobra 3, Kobra 3 Max, Kobra 3 V2, Kobra S1, S1 Max.
//
// The printer must be in LAN mode (in its network settings). Then:
//
//   1. GET http://<printer>:18910/info gives a token, the model id and where to ask next.
//   2. A POST there, signed with md5(md5(token[0..16]) + time + nonce), answers with the MQTT
//      login, AES-128-CBC encrypted: key token[16..32], IV the answer's own token.
//   3. MQTT over TLS on port 9883 with that login. The printer's certificate is its own,
//      self-signed, so it is not verified: this is a device on the local network, reached by
//      the address the operator typed in. No client certificate is needed.
//   4. Files go to the upload address the printer gives in its info report (HTTP, port 18910,
//      multipart: `filename` and `gcode`), then a `print`/`start` command starts them.
//
// Nothing here comes from Anycubic's apps: each connection gets its login from the printer.
// The protocol was worked out by the community; see src/core/anycubic-report.ts. Starting a
// print was checked on a Kobra X; on the Kobra 3 family it is the same command.

import { createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mqtt, { type MqttClient } from "mqtt";
import { unzipSync } from "fflate";
import { emptyLive, type Emit, type PrinterDriver, type StartOptions } from "../../core/driver";
import { applyReport, emptyAnycubic, liveFromAnycubic, startData, statusOf, type AnycubicState } from "../../core/anycubic-report";
import { matchFilaments, slotsForStart } from "../../core/filament";
import type { LiveState, PlateJob, PrinterConfig } from "../../core/types";

type Json = Record<string, unknown>;

export interface Login {
  port: number;
  username: string;
  password: string;
  deviceId: string;
  modelId: string;
}

const INFO_PORT = 18910;

export function sign(token: string, ts: number, nonce: string): string {
  const md5 = (s: string) => createHash("md5").update(s).digest("hex");
  return md5(md5(token.slice(0, 16)) + String(ts) + nonce);
}

export function decryptLogin(sealed: string, token: string, localToken: string): Json {
  const key = Buffer.from(token.slice(16, 32), "utf8");
  const iv = Buffer.alloc(16);
  Buffer.from(localToken, "utf8").copy(iv, 0, 0, 16);
  const d = createDecipheriv("aes-128-cbc", key, iv);
  const plain = Buffer.concat([d.update(Buffer.from(sealed, "base64")), d.final()]).toString("utf8");
  return JSON.parse(plain) as Json;
}

const random = (chars: string, n: number) => Array.from(randomBytes(n), (b) => chars[b % chars.length]).join("");

async function getJson(url: string, method: "GET" | "POST"): Promise<Json> {
  const r = await fetch(url, { method, signal: AbortSignal.timeout(8000), redirect: "error" });
  const body = (await r.json().catch(() => null)) as Json | null;
  if (!body || typeof body !== "object") throw new Error("The device at this address did not answer like an Anycubic printer.");
  return body;
}

/** The MQTT login, from the printer itself. */
export async function handshake(host: string, get = getJson): Promise<Login> {
  let info: Json;
  try {
    info = await get(`http://${host}:${INFO_PORT}/info`, "GET");
  } catch (e) {
    throw new Error(/did not answer/.test((e as Error).message) ? (e as Error).message : "Cannot reach the printer. Check that it is on, in LAN mode, and on the same network.");
  }
  if (info.ctrlType === "cloud") throw new Error("The printer is in cloud mode. Turn on LAN mode in the printer's network settings.");
  const token = info.token, modelId = info.modelId, ctrl = info.ctrlInfoUrl;
  if (typeof token !== "string" || token.length < 32 || (typeof modelId !== "string" && typeof modelId !== "number") || typeof ctrl !== "string") {
    throw new Error("This Anycubic printer does not offer the LAN connection OPF uses (Kobra 3 and S1 printers do).");
  }
  // Signed request to the path the printer named, on the address the operator typed.
  const where = new URL(ctrl, `http://${host}:${INFO_PORT}`);
  const ts = Date.now();
  const nonce = random("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 6);
  const query = new URLSearchParams({ ts: String(ts), nonce, sign: sign(token, ts, nonce), did: random("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 32) });
  const ctrlUrl = `http://${host}:${where.port || INFO_PORT}${where.pathname}?${where.search ? where.search.slice(1) + "&" : ""}${query}`;
  const answer = await get(ctrlUrl, "POST");
  const data = answer.data as Json | undefined;
  if (answer.code !== 200 || typeof data?.info !== "string" || typeof data?.token !== "string") {
    throw new Error(`The printer did not give a login${typeof answer.message === "string" ? `: ${answer.message}` : "."}`);
  }
  const login = decryptLogin(data.info, token, data.token);
  const port = /:(\d+)/.exec(String(login.broker ?? ""))?.[1];
  if (typeof login.username !== "string" || typeof login.password !== "string" || typeof login.deviceId !== "string") {
    throw new Error("The printer's login was not readable.");
  }
  return { port: port ? Number(port) : 9883, username: login.username, password: login.password, deviceId: login.deviceId, modelId: String(modelId) };
}

/** A multipart form with the file name and the G-code, the way the printer's upload address takes it. */
export function uploadForm(name: string, gcode: Uint8Array): { body: Buffer; type: string } {
  const boundary = `----opf${randomUUID().replace(/-/g, "")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n${name}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="gcode"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(gcode),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

/** Plain G-code for the printer: the file itself, or the plate's G-code inside a .gcode.3mf. */
export async function gcodeOf(file: string, plate = 1): Promise<Uint8Array> {
  const bytes = await readFile(file);
  if (/\.gcode$/i.test(file)) return bytes;
  const name = `Metadata/plate_${plate}.gcode`;
  const found = unzipSync(new Uint8Array(bytes), { filter: (f) => f.name === name })[name];
  if (!found) throw new Error(`Plate ${plate} in this file has no G-code. Slice it again.`);
  return found;
}

export class AnycubicDriver implements PrinterDriver {
  private client: MqttClient | null = null;
  private login: Login | null = null;
  private state: AnycubicState = emptyAnycubic();
  private live: LiveState = emptyLive();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private poll: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private retryMs = 10_000;
  private waiters = new Set<(type: string, msg: Json) => void>();

  constructor(private cfg: PrinterConfig, private emit: Emit) {}

  private topic(kind: "web" | "slicer", type: string) {
    return `anycubic/anycubicCloud/v1/${kind}/printer/${this.login!.modelId}/${this.login!.deviceId}/${type}`;
  }

  connect() {
    this.stopped = false;
    if (!this.cfg.host) {
      this.emit({ status: "offline", error: "Add the printer's IP address." });
      return;
    }
    void this.open();
  }

  private offline(why: string) {
    this.live = { ...this.live, status: "offline", error: why };
    this.emit({ status: "offline", error: why });
  }

  /** Handshake, then MQTT. On any failure, try again a little later, with a fresh login. */
  private async open() {
    try {
      this.login = await handshake(this.cfg.host!);
    } catch (e) {
      this.offline((e as Error).message);
      return this.retry();
    }
    if (this.stopped) return;
    const client = mqtt.connect(`mqtts://${this.cfg.host}:${this.login.port}`, {
      username: this.login.username,
      password: this.login.password,
      rejectUnauthorized: false,
      reconnectPeriod: 0, // a lost connection gets a new login: see close below
      connectTimeout: 10_000,
      clientId: `opf-${Math.random().toString(16).slice(2, 10)}`,
    });
    this.client = client;
    client.on("connect", () => {
      this.retryMs = 10_000;
      client.subscribe(`anycubic/anycubicCloud/v1/printer/public/${this.login!.modelId}/${this.login!.deviceId}/#`);
      this.query("info");
      this.query("multiColorBox");
      // The info report comes on its own only now and then, and the ACE only when it changes.
      if (this.poll) clearInterval(this.poll);
      this.poll = setInterval(() => {
        this.query("info");
        this.query("multiColorBox");
      }, 20_000);
    });
    client.on("message", (topic, payload) => {
      let msg: Json;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const parts = topic.split("/");
      if (parts.at(-1) !== "report") return;
      const type = parts.at(-2) ?? String(msg.type ?? "");
      this.state = applyReport(this.state, type, msg);
      this.live = { ...emptyLive(), ...liveFromAnycubic(this.state), updatedAt: Date.now() };
      this.emit(this.live);
      for (const w of this.waiters) w(type, msg);
    });
    client.on("error", (e) => {
      const msg = String((e as Error).message || e);
      this.offline(/auth|not authorized|bad user/i.test(msg) ? "The printer refused OPF's login. Check that LAN mode is on." : `Connection problem: ${msg}`);
    });
    client.on("close", () => {
      if (this.poll) clearInterval(this.poll);
      this.poll = null;
      if (this.client !== client || this.stopped) return;
      this.client = null;
      if (this.live.status !== "offline") this.offline("Lost the connection to the printer. Trying again.");
      this.retry();
    });
  }

  private retry() {
    if (this.stopped) return;
    this.timers.push(setTimeout(() => void this.open(), this.retryMs));
    this.retryMs = Math.min(60_000, this.retryMs * 2);
  }

  disconnect() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.client?.end(true);
    this.client = null;
  }

  private send(kind: "web" | "slicer", type: string, action: string, data: unknown) {
    if (!this.client?.connected || !this.login) throw new Error(`${this.cfg.name} is not connected.`);
    this.client.publish(this.topic(kind, type), JSON.stringify({ type, action, timestamp: Date.now(), msgid: randomUUID(), data }));
  }

  private query(type: string) {
    try {
      // The ACE only answers getInfo.
      this.send("web", type, type === "multiColorBox" ? "getInfo" : "query", null);
    } catch { /* not connected: the next connection asks again */ }
  }

  /** The next report of a type that `match` accepts, or null after `ms`. */
  private next(match: (type: string, msg: Json) => boolean, ms: number): Promise<Json | null> {
    return new Promise((resolve) => {
      const w = (type: string, msg: Json) => {
        if (!match(type, msg)) return;
        this.waiters.delete(w);
        clearTimeout(t);
        resolve(msg);
      };
      const t = setTimeout(() => {
        this.waiters.delete(w);
        resolve(null);
      }, ms);
      this.waiters.add(w);
    });
  }

  async pause() { this.send("web", "print", "pause", { taskid: "-1" }); }
  async resume() { this.send("web", "print", "resume", { taskid: "-1" }); }
  async stop() { this.send("web", "print", "stop", { taskid: "-1" }); }

  async start(job: PlateJob, opts: StartOptions = {}) {
    if (!job.file) throw new Error("Slice this plate before sending it.");
    if (!this.client?.connected) throw new Error(`${this.cfg.name} is not connected.`);
    if (["printing", "preparing", "paused"].includes(statusOf(this.state))) throw new Error(`${this.cfg.name} is busy.`);

    // Which ACE slot feeds each filament, before anything is uploaded.
    let slots = slotsForStart(job, this.live, false);
    if (job.filaments.length) {
      const missing = matchFilaments(job, this.live).filter((m) => !m.slot);
      if (missing.length && !opts.anyFilament) throw new Error(`Load the filament first: ${missing.map((m) => m.problem).join("; ")}.`);
      slots = slotsForStart(job, this.live, true);
    }

    const gcode = await gcodeOf(job.file, job.plate ?? 1);
    const name = `${job.name.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 40)}-${job.id}.gcode`.replace(/^[_.-]+/, "");
    if (!this.state.uploadUrl) {
      this.query("info");
      await this.next(() => this.state.uploadUrl !== null, 8000);
    }
    const url = this.state.uploadUrl ? new URL(this.state.uploadUrl) : null;
    if (!url || url.pathname !== "/gcode_upload") throw new Error(`${this.cfg.name} did not say where files go. Try again in a moment.`);
    // To the printer the operator named, whatever host the report gives.
    const target = `http://${this.cfg.host}:${url.port || INFO_PORT}${url.pathname}${url.search}`;
    const form = uploadForm(name, gcode);
    try {
      const r = await fetch(target, {
        method: "POST",
        body: form.body,
        headers: { "Content-Type": form.type, "X-File-Length": String(gcode.length), "User-Agent": "AnycubicSlicerNext/1.3.9.4", Accept: "*/*" },
        signal: AbortSignal.timeout(300_000),
        redirect: "error",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // The printer answers in JSON; a code other than 200 there is a refusal.
      const answer = (await r.json().catch(() => null)) as Json | null;
      if (answer && typeof answer.code === "number" && answer.code !== 200) throw new Error(typeof answer.msg === "string" ? answer.msg : `code ${answer.code}`);
    } catch (e) {
      throw new Error(`Could not upload ${job.name} to ${this.cfg.name}: ${(e as Error).message}`);
    }

    const md5 = createHash("md5").update(gcode).digest("hex");
    const answer = this.next((type, msg) => type === "print" && msg.action === "start", 8000);
    this.send("slicer", "print", "start", startData({ filename: name, md5, size: gcode.length }, job.filaments, slots));
    const reply = await answer;
    if (reply && typeof reply.code === "number" && reply.code !== 200) {
      throw new Error(`${this.cfg.name} did not start ${job.name}${typeof reply.msg === "string" ? `: ${reply.msg}` : "."}`);
    }
    this.query("info");
  }
}
