import { afterEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { strToU8, zipSync } from "fflate";
import { chooseUpdate, installFarmUpdate, markGood, readState, signatureOk, signedText, writeState, type FarmManifest } from "./farm-update";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "opf-farm-update-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const signed = (m: Omit<FarmManifest, "sig">): FarmManifest => ({ ...m, sig: sign(null, Buffer.from(signedText(m)), keys.privateKey).toString("base64") });

describe("farm update signature", () => {
  const m = signed({ version: "0.2.3", file: "opf-farm-0.2.3.zip", sha256: "a".repeat(64), deps: "mqtt@5.16.0", changes: [] });

  it("accepts the manifest it signed", () => {
    expect(signatureOk(m, publicKey)).toBe(true);
  });

  it("refuses any change to what runs", () => {
    expect(signatureOk({ ...m, sha256: "b".repeat(64) }, publicKey)).toBe(false);
    expect(signatureOk({ ...m, version: "9.9.9" }, publicKey)).toBe(false);
    expect(signatureOk({ ...m, deps: "mqtt@6.0.0" }, publicKey)).toBe(false);
  });

  it("refuses another key, including OPF's own for a manifest it did not sign", () => {
    expect(signatureOk(m)).toBe(false);
  });
});

describe("which farm boots", () => {
  function withUpdate(version: string, state: object) {
    const userData = tmp();
    mkdirSync(join(userData, "farm-update", version, "out", "main"), { recursive: true });
    writeFileSync(join(userData, "farm-update", version, "out", "main", "index.js"), "");
    writeState(userData, { version, tries: 0, good: false, ...state });
    return userData;
  }

  it("runs a newer update and counts the try", () => {
    const u = withUpdate("0.2.3", {});
    expect(chooseUpdate(u, "0.2.2")?.version).toBe("0.2.3");
    expect(readState(u)?.tries).toBe(1);
  });

  it("goes back to the installed farm after an update failed to come up twice, and remembers it", () => {
    const u = withUpdate("0.2.3", { tries: 2 });
    expect(chooseUpdate(u, "0.2.2")).toBeNull();
    expect(readState(u)?.bad).toBe("0.2.3");
    expect(chooseUpdate(u, "0.2.2")).toBeNull();
  });

  it("keeps running an update that came up once, without counting", () => {
    const u = withUpdate("0.2.3", { good: true, tries: 0 });
    expect(chooseUpdate(u, "0.2.2")?.version).toBe("0.2.3");
    expect(chooseUpdate(u, "0.2.2")?.version).toBe("0.2.3");
    expect(readState(u)?.tries).toBe(0);
  });

  it("lets a newer installer win", () => {
    expect(chooseUpdate(withUpdate("0.2.3", { good: true }), "0.2.3")).toBeNull();
    expect(chooseUpdate(withUpdate("0.2.3", { good: true }), "0.2.4")).toBeNull();
  });

  it("marks the update good once it is up and hands over what changed once", () => {
    const u = withUpdate("0.2.3", { changes: [{ subject: "Stop asks", body: "" }] });
    chooseUpdate(u, "0.2.2");
    expect(markGood(u, "0.2.3")).toEqual([{ subject: "Stop asks", body: "" }]);
    expect(readState(u)).toMatchObject({ good: true, tries: 0 });
    expect(markGood(u, "0.2.3")).toEqual([]);
    expect(markGood(u, undefined)).toEqual([]);
  });
});

describe("installing an update", () => {
  let server: Server | null = null;
  afterEach(() => server?.close());

  async function serve(files: Record<string, Uint8Array>) {
    server = createServer((req, res) => {
      const body = files[(req.url ?? "").split("/").pop() ?? ""];
      if (!body) return res.writeHead(404).end();
      res.end(Buffer.from(body));
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/farm.json`;
  }

  it("downloads, checks and unpacks it for the next start", async () => {
    const zip = zipSync({ "out/main/index.js": strToU8("// farm"), "resources/icon.png": new Uint8Array([1, 2]), "package.json": strToU8("{}") });
    const m = signed({ version: "0.2.3", file: "opf-farm-0.2.3.zip", sha256: createHash("sha256").update(zip).digest("hex"), deps: "d", changes: [] });
    const feed = await serve({ "opf-farm-0.2.3.zip": zip });
    const u = tmp();
    await installFarmUpdate(m, u, "0.2.2", feed);
    expect(readFileSync(join(u, "farm-update", "0.2.3", "out", "main", "index.js"), "utf8")).toBe("// farm");
    expect(readState(u)).toMatchObject({ version: "0.2.3", tries: 0, good: false });
  });

  it("refuses a zip that is not the one signed", async () => {
    const zip = zipSync({ "out/main/index.js": strToU8("// farm") });
    const m = signed({ version: "0.2.3", file: "opf-farm-0.2.3.zip", sha256: "0".repeat(64), deps: "d", changes: [] });
    const feed = await serve({ "opf-farm-0.2.3.zip": zip });
    const u = tmp();
    await expect(installFarmUpdate(m, u, "0.2.2", feed)).rejects.toThrow(/whole/);
    expect(existsSync(join(u, "farm-update", "0.2.3"))).toBe(false);
  });

  it("refuses files that would land outside its folder", async () => {
    const zip = zipSync({ "../evil.js": strToU8("x"), "out/main/index.js": strToU8("// farm") });
    const m = signed({ version: "0.2.3", file: "opf-farm-0.2.3.zip", sha256: createHash("sha256").update(zip).digest("hex"), deps: "d", changes: [] });
    const feed = await serve({ "opf-farm-0.2.3.zip": zip });
    await expect(installFarmUpdate(m, tmp(), "0.2.2", feed)).rejects.toThrow(/outside/);
  });
});
