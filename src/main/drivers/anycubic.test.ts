import { describe, expect, it } from "vitest";
import { createCipheriv } from "node:crypto";
import { Readable } from "node:stream";
import busboy from "busboy";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { decryptLogin, gcodeOf, handshake, sign, uploadForm } from "./anycubic";

const TOKEN = "0123456789abcdefFEDCBA9876543210";

function seal(login: object, localToken: string) {
  const iv = Buffer.alloc(16);
  Buffer.from(localToken).copy(iv, 0, 0, 16);
  const c = createCipheriv("aes-128-cbc", Buffer.from(TOKEN.slice(16, 32)), iv);
  return Buffer.concat([c.update(JSON.stringify(login)), c.final()]).toString("base64");
}

describe("Anycubic LAN handshake", () => {
  it("signs the way the printer checks: md5(md5(token[0..16]) + time + nonce)", () => {
    // Worked out separately with Python's hashlib.
    expect(sign(TOKEN, 1760000000000, "aB3xY9")).toBe("7a579a7b92de76cf8277c0ad202aa917");
  });

  it("opens the login with key token[16..32] and the answer's token as IV", () => {
    expect(decryptLogin(seal({ username: "u", password: "p" }, "local-token-xyz"), TOKEN, "local-token-xyz")).toEqual({ username: "u", password: "p" });
  });

  it("asks the printer at the typed address, signed, and returns its login", async () => {
    const asked: string[] = [];
    const login = await handshake("192.168.1.50", async (url, method) => {
      asked.push(`${method} ${url}`);
      if (url.endsWith("/info")) return { token: TOKEN, modelId: 20026, cn: "SN1", ctrlType: "lan", ctrlInfoUrl: "http://10.9.9.9:18910/ctrl" };
      return { code: 200, data: { token: "local-token-xyz", info: seal({ broker: "mqtts://192.168.1.50:9883", username: "user", password: "pass", deviceId: "dev1" }, "local-token-xyz") } };
    });
    expect(login).toEqual({ port: 9883, username: "user", password: "pass", deviceId: "dev1", modelId: "20026" });
    expect(asked[0]).toBe("GET http://192.168.1.50:18910/info");
    // The printer named another host; the request still goes to the one typed in.
    expect(asked[1]).toMatch(/^POST http:\/\/192\.168\.1\.50:18910\/ctrl\?ts=\d+&nonce=[A-Za-z0-9]{6}&sign=[0-9a-f]{32}&did=[A-Z0-9]{32}$/);
  });

  it("says when the printer is in cloud mode", async () => {
    await expect(handshake("h", async () => ({ ctrlType: "cloud" }))).rejects.toThrow(/Turn on LAN mode/);
  });
});

describe("sending a file", () => {
  it("sends a form the printer reads as a file name and the G-code", async () => {
    const { body, type } = uploadForm("Clips-j-1.gcode", strToU8("G28\nG1 X10\n"));
    const got: Record<string, string> = {};
    await new Promise<void>((resolve, reject) => {
      const bb = busboy({ headers: { "content-type": type } });
      bb.on("field", (n, v) => (got[n] = v));
      bb.on("file", (n, stream, info) => {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c)).on("end", () => (got[n] = `${info.filename}:${Buffer.concat(chunks).toString()}`));
      });
      bb.on("close", resolve).on("error", reject);
      Readable.from(body).pipe(bb);
    });
    expect(got).toEqual({ filename: "Clips-j-1.gcode", gcode: "Clips-j-1.gcode:G28\nG1 X10\n" });
  });

  it("takes the plate's G-code out of a .gcode.3mf", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opf-ac-"));
    const file = join(dir, "p.gcode.3mf");
    writeFileSync(file, zipSync({ "Metadata/plate_2.gcode": strToU8("; plate 2\nG28\n"), "Metadata/plate_1.gcode": strToU8("; plate 1\n") }));
    expect(new TextDecoder().decode(await gcodeOf(file, 2))).toBe("; plate 2\nG28\n");
    await expect(gcodeOf(file, 3)).rejects.toThrow(/Plate 3/);
  });
});
