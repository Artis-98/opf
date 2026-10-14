// Bambu Lab printers over the local network.
//
// Status: MQTT over TLS on port 8883, user "bblp", password the printer's LAN
// access code. Reading status works in plain LAN mode. Starting, pausing and
// stopping prints from software needs the printer's Developer Mode on, since
// Bambu's 2025 firmware; without it the printer ignores these commands.
//
// Files: implicit FTPS on port 990 with the same login. The plate is uploaded
// to the printer's storage, then started with a `project_file` command.
//
// The printer's certificate is signed by Bambu's own CA and names the serial,
// not the IP, so it cannot be verified the usual way. This is a device on the
// local network, reached by address the operator typed in.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import mqtt, { type MqttClient } from "mqtt";
import { Client as FtpClient } from "basic-ftp";
import type { Emit, PrinterDriver } from "../../core/driver";
import { amsMapping, liveFromReport, mergeReport } from "../../core/bambu-report";
import { matchFilaments } from "../../core/filament";
import type { LiveState, PlateJob, PrinterConfig } from "../../core/types";

type Json = Record<string, unknown>;

export class BambuDriver implements PrinterDriver {
  private client: MqttClient | null = null;
  private report: Json = {};
  private live: Partial<LiveState> = {};
  private seq = 0;

  constructor(private cfg: PrinterConfig, private emit: Emit) {}

  private get topic() {
    return { report: `device/${this.cfg.serial}/report`, request: `device/${this.cfg.serial}/request` };
  }

  connect() {
    const { host, serial, accessCode } = this.cfg;
    if (!host || !serial || !accessCode) {
      this.emit({ status: "offline", error: "Add the printer's IP address, serial number and LAN access code." });
      return;
    }
    this.client = mqtt.connect(`mqtts://${host}:8883`, {
      username: "bblp",
      password: accessCode,
      rejectUnauthorized: false,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      clientId: `opf-${Math.random().toString(16).slice(2, 10)}`,
    });
    this.client.on("connect", () => {
      this.client!.subscribe(this.topic.report);
      // Ask for everything once; afterwards P1/A1 printers send only changes.
      this.publish({ pushing: { sequence_id: String(this.seq++), command: "pushall" } });
    });
    this.client.on("message", (_topic, payload) => {
      let msg: Json;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch {
        return;
      }
      if (!msg.print) return;
      this.report = mergeReport(this.report, msg);
      this.live = liveFromReport(this.report);
      this.emit(this.live);
    });
    const offline = (why: string) => this.emit({ status: "offline", error: why });
    this.client.on("offline", () => offline("Cannot reach the printer. Check that it is on and on the same network."));
    this.client.on("error", (e) => {
      const msg = String((e as Error).message || e);
      offline(/auth|not authorized|bad user/i.test(msg) ? "The printer refused the access code. Check it on the printer's screen." : `Connection problem: ${msg}`);
    });
  }

  disconnect() {
    this.client?.end(true);
    this.client = null;
  }

  private publish(body: Json) {
    if (!this.client?.connected) throw new Error(`${this.cfg.name} is not connected.`);
    this.client.publish(this.topic.request, JSON.stringify(body));
  }

  private command(command: string, extra: Json = {}) {
    this.publish({ print: { sequence_id: String(this.seq++), command, ...extra } });
  }

  async pause() { this.command("pause"); }
  async resume() { this.command("resume"); }
  async stop() { this.command("stop"); }

  async start(job: PlateJob) {
    if (!job.file) throw new Error("Slice this plate before sending it.");
    const { host, accessCode } = this.cfg;
    const remote = `opf-${job.id}.gcode.3mf`.replace(/[^A-Za-z0-9._-]/g, "_");

    // Work out which AMS slot feeds each filament before uploading anything.
    const live = this.live as LiveState;
    const hasAms = (live.ams?.length ?? 0) > 0;
    let mapping: number[] = [];
    if (job.filaments.length) {
      const matches = matchFilaments(job, live);
      const missing = matches.filter((m) => !m.slot);
      if (missing.length) throw new Error(`Load the filament first: ${missing.map((m) => m.problem).join("; ")}.`);
      mapping = amsMapping(matches.map((m) => m.slot));
    }

    const ftp = new FtpClient(30_000);
    try {
      await ftp.access({ host, port: 990, user: "bblp", password: accessCode, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
      await ftp.uploadFrom(createReadStream(job.file), remote);
    } catch (e) {
      throw new Error(`Could not upload ${basename(job.file)} to ${this.cfg.name}: ${(e as Error).message}`);
    } finally {
      ftp.close();
    }

    const md5 = await fileMd5(job.file);
    this.command("project_file", {
      param: "Metadata/plate_1.gcode",
      project_id: "0",
      profile_id: "0",
      task_id: "0",
      subtask_id: "0",
      subtask_name: job.name,
      url: `file:///sdcard/${remote}`,
      md5,
      timelapse: false,
      bed_type: "auto",
      bed_levelling: true,
      flow_cali: false,
      vibration_cali: false,
      layer_inspect: false,
      use_ams: hasAms && mapping.every((m) => m !== 254),
      ams_mapping: mapping,
    });
  }
}

function fileMd5(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("md5");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex").toUpperCase())).on("error", reject);
  });
}
