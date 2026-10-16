// Finding printers on the local network, for Add a printer.
//
//   Bambu Lab   Printers announce themselves every few seconds over UDP (SSDP-style NOTIFY messages,
//               broadcast to port 2021 and multicast to 239.255.255.250:1990), with their IP address,
//               serial number, name and model code. That is how Bambu Studio finds them. The LAN access
//               code is not announced: it is read from the printer's screen.
//   Anycubic    Kobra 3 and S1 printers in LAN mode do not announce themselves, but answer
//               GET http://<printer>:18910/info. Every address on this computer's own networks (the /24
//               around each address) is asked, a few dozen at a time, with a short timeout.
//
// Nothing here connects to a printer or changes anything on it.

import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import type { FoundPrinter } from "../core/types";

export type { FoundPrinter };

/** The model codes Bambu printers announce, as OPF names the models. */
const BAMBU_MODELS: Record<string, string> = {
  "3DPrinter-X1-Carbon": "Bambu Lab X1 Carbon",
  "BL-P001": "Bambu Lab X1 Carbon",
  "C13": "Bambu Lab X1E",
  "C11": "Bambu Lab P1P",
  "C12": "Bambu Lab P1S",
  "N1": "Bambu Lab A1 mini",
  "N2S": "Bambu Lab A1",
  "O1D": "Bambu Lab H2D",
};

/** One announcement from a Bambu printer, or null when it is something else. */
export function parseBambuAnnouncement(text: string): FoundPrinter | null {
  if (!/urn:bambulab-com:device:3dprinter/i.test(text)) return null;
  const header = (name: string) => new RegExp(`^${name.replace(/\./g, "\\.")}:\\s*(.+?)\\s*$`, "im").exec(text)?.[1] ?? null;
  const host = header("Location");
  const serial = header("USN");
  if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || !serial) return null;
  const code = header("DevModel.bambu.com");
  const connect = header("DevConnect.bambu.com");
  return {
    driver: "bambu",
    host,
    serial: serial.toUpperCase(),
    name: header("DevName.bambu.com"),
    model: code ? BAMBU_MODELS[code] ?? null : null,
    ...(connect && connect.toLowerCase() === "cloud" ? { note: "Turn on LAN mode on the printer to add it." } : {}),
  };
}

/** An Anycubic printer's answer to /info, or null when the address is something else. */
export function anycubicFromInfo(host: string, info: unknown): FoundPrinter | null {
  if (!info || typeof info !== "object") return null;
  const j = info as Record<string, unknown>;
  const looksLikeOne = typeof j.ctrlInfoUrl === "string" || (typeof j.token === "string" && "modelId" in j);
  if (!looksLikeOne) return null;
  const text = (k: string) => (typeof j[k] === "string" && (j[k] as string).trim() ? (j[k] as string).trim() : null);
  const named = text("modelName") ?? text("printerName") ?? text("model");
  const model = named ? (/^anycubic /i.test(named) ? named : `Anycubic ${named}`) : null;
  // Until it is renamed on its screen, a Kobra calls itself by its model: that is no name.
  const name = text("deviceName") ?? text("name");
  const serial = text("cn");
  return {
    driver: "anycubic",
    host,
    name: name && name !== named && name !== model ? name : null,
    model,
    ...(serial ? { serial: serial.toUpperCase() } : {}),
    ...(j.ctrlType === "cloud" ? { note: "In cloud mode. Turn on LAN mode on the printer to add it." } : {}),
  };
}

/** The addresses next to this computer's own: the /24 around each IPv4 address it has on a real network. */
export function neighbourAddresses(ifaces = networkInterfaces()): string[] {
  const own = new Set<string>();
  const nets = new Set<string>();
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // Link-local (no DHCP answer) is not a network printers sit on.
      if (a.address.startsWith("169.254.")) continue;
      own.add(a.address);
      nets.add(a.address.split(".").slice(0, 3).join("."));
    }
  }
  const out: string[] = [];
  for (const net of nets) for (let i = 1; i < 255; i++) if (!own.has(`${net}.${i}`)) out.push(`${net}.${i}`);
  return out;
}

/** Listens for Bambu printers' announcements for a while. Nothing when the ports cannot be opened. */
function listenForBambu(ms: number): Promise<FoundPrinter[]> {
  const found = new Map<string, FoundPrinter>();
  const sockets: Socket[] = [];
  const open = (port: number, group?: string) =>
    new Promise<void>((resolve) => {
      const s = createSocket({ type: "udp4", reuseAddr: true });
      s.on("error", () => resolve());
      s.on("message", (msg) => {
        const p = parseBambuAnnouncement(msg.toString("utf8"));
        if (p) found.set(p.serial ?? p.host, p);
      });
      s.bind(port, () => {
        try {
          if (group) s.addMembership(group);
        } catch { /* broadcast still arrives on 2021 */ }
        sockets.push(s);
        resolve();
      });
    });
  return Promise.all([open(2021), open(1990, "239.255.255.250")]).then(
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          for (const s of sockets) {
            try { s.close(); } catch { /* already closed */ }
          }
          resolve([...found.values()]);
        }, ms),
      ),
  );
}

/** Asks every neighbouring address whether it is an Anycubic printer in LAN mode. */
async function askForAnycubic(addresses: string[], timeoutMs: number, parallel = 48): Promise<FoundPrinter[]> {
  const found: FoundPrinter[] = [];
  let next = 0;
  const worker = async () => {
    while (next < addresses.length) {
      const host = addresses[next++];
      try {
        const r = await fetch(`http://${host}:18910/info`, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
        const p = anycubicFromInfo(host, await r.json().catch(() => null));
        if (p) found.push(p);
      } catch { /* nothing there */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, addresses.length) }, worker));
  return found;
}

/** Printers on this computer's networks, Bambu and Anycubic, found in about seven seconds. */
export async function discoverPrinters(): Promise<FoundPrinter[]> {
  const [bambu, anycubic] = await Promise.all([listenForBambu(7000), askForAnycubic(neighbourAddresses(), 1200)]);
  const all = [...bambu, ...anycubic.filter((a) => !bambu.some((b) => b.host === a.host))];
  return all.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}
