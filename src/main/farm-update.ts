// Small updates for an installed OPF: only the farm's own code, without the whole installer.
//
// Each update is a zip of the farm's build (out/, resources/, package.json) on the GitHub release
// "farm-latest", next to farm.json, which says its version, its SHA-256, the packages it was built
// against and what changed, signed with OPF's update key (scripts/publish-farm-update.cjs makes both).
// An installed OPF that has the same packages downloads the zip, checks hash and signature, unpacks it
// into <settings>/farm-update/<version>/ and offers Update ready, Restart. On the next start boot.ts
// runs that version instead of the installed one; if it does not come up twice in a row, the installed
// version runs again and that update is not offered again. A newer installer always wins.

import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { unzipSync } from "fflate";
import { isNewer, type Change } from "./updater";

/** OPF's farm update key (ed25519, SPKI). Its private half is on the owner's PC only. */
const PUBLIC_KEY = "MCowBQYDK2VwAyEA8wvhkFNDJBxjipuyiGAJ+H6vVfTu+aDyCbVgf+P7eVg=";

/** Where the manifest is. OPF_FARM_FEED points a copy at a test release instead. */
export const FARM_FEED = process.env.OPF_FARM_FEED || "https://github.com/Artis-98/opf/releases/download/farm-latest/farm.json";

export interface FarmManifest {
  version: string;
  /** The zip, next to farm.json. */
  file: string;
  sha256: string;
  /** The packages it runs with (scripts/deps-fingerprint.cjs). */
  deps: string;
  changes: Change[];
  /** Ed25519 over signedText(), base64. */
  sig: string;
}

/** What the signature covers: everything that decides what runs. */
export function signedText(m: Pick<FarmManifest, "version" | "file" | "sha256" | "deps">): string {
  return `OPF farm update\n${m.version}\n${m.file}\n${m.sha256}\n${m.deps}\n`;
}

export function signatureOk(m: FarmManifest, publicKey = PUBLIC_KEY): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(signedText(m)), key, Buffer.from(m.sig, "base64"));
  } catch {
    return false;
  }
}

/** Kept in <settings>/farm-update/state.json. */
export interface FarmUpdateState {
  /** The update to run instead of the installed farm. */
  version: string;
  /** Starts so far that did not come up. */
  tries: number;
  /** It came up once: no more counting. */
  good: boolean;
  /** A version that would not start; not offered again. */
  bad?: string;
  /** What changed, shown once after it first comes up. */
  changes?: Change[];
}

export const updateDir = (userData: string) => join(userData, "farm-update");

export function readState(userData: string): FarmUpdateState | null {
  try {
    return JSON.parse(readFileSync(join(updateDir(userData), "state.json"), "utf8")) as FarmUpdateState;
  } catch {
    return null;
  }
}

export function writeState(userData: string, s: FarmUpdateState) {
  mkdirSync(updateDir(userData), { recursive: true });
  writeFileSync(join(updateDir(userData), "state.json"), JSON.stringify(s, null, 2));
}

/**
 * Which farm boot.ts starts: an update's main file, or null for the installed one. Counts the try; an
 * update that did not come up twice is marked bad and the installed farm runs.
 */
export function chooseUpdate(userData: string, installed: string): { version: string; main: string } | null {
  const s = readState(userData);
  if (!s?.version || s.bad === s.version || !isNewer(s.version, installed)) return null;
  const main = join(updateDir(userData), s.version, "out", "main", "index.js");
  if (!existsSync(main)) return null;
  if (!s.good) {
    if (s.tries >= 2) {
      writeState(userData, { ...s, bad: s.version });
      return null;
    }
    writeState(userData, { ...s, tries: s.tries + 1 });
  }
  return { version: s.version, main };
}

/** Called once the farm is up: this update works, and what changed is shown once. */
export function markGood(userData: string, version: string | undefined): Change[] {
  if (!version) return [];
  const s = readState(userData);
  if (!s || s.version !== version || s.good) return [];
  writeState(userData, { ...s, good: true, tries: 0, changes: undefined });
  return s.changes ?? [];
}

/** The newest small update, when this copy can take it. Null when there is none for it. */
export async function checkFarmUpdate(running: string, deps: string, userData: string, feed = FARM_FEED): Promise<FarmManifest | null> {
  const r = await fetch(feed, { headers: { "User-Agent": "OPF" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`The update feed answered ${r.status}`);
  const m = (await r.json()) as FarmManifest;
  if (!m?.version || !isNewer(m.version, running) || m.deps !== deps) return null;
  if (readState(userData)?.bad === m.version) return null;
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(m.file) || !/^[0-9a-f]{64}$/.test(m.sha256) || !signatureOk(m)) throw new Error("The farm update is not signed by OPF.");
  return m;
}

/** Downloads, checks and unpacks an update, ready for the next start. `running` is the version running now. */
export async function installFarmUpdate(m: FarmManifest, userData: string, running: string, feed = FARM_FEED) {
  const url = new URL(m.file, feed).toString();
  const r = await fetch(url, { headers: { "User-Agent": "OPF" }, signal: AbortSignal.timeout(300_000), redirect: "follow" });
  if (!r.ok) throw new Error(`Downloading the farm update failed (${r.status})`);
  const zip = new Uint8Array(await r.arrayBuffer());
  if (createHash("sha256").update(zip).digest("hex") !== m.sha256) throw new Error("The farm update did not arrive whole.");
  const dir = updateDir(userData);
  const target = join(dir, m.version);
  const tmp = `${target}.unpacking`;
  rmSync(tmp, { recursive: true, force: true });
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    if (name.endsWith("/")) continue;
    const out = normalize(join(tmp, name));
    if (!out.startsWith(tmp + sep)) throw new Error("The farm update has a file outside its folder.");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  if (!existsSync(join(tmp, "out", "main", "index.js"))) throw new Error("The farm update is missing the farm.");
  rmSync(target, { recursive: true, force: true });
  renameSync(tmp, target);
  const before = readState(userData);
  writeState(userData, { version: m.version, tries: 0, good: false, changes: m.changes, ...(before?.bad ? { bad: before.bad } : {}) });
  // An older update that is not running now is not needed any more; the running one goes next time.
  if (before?.version && before.version !== m.version && before.version !== running) rmSync(join(dir, before.version), { recursive: true, force: true });
}
