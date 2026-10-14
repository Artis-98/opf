// Fetching work from an outside system, such as admin.iiteg.com.
//
// OPF asks; the outside system never has to reach into the workshop. Every
// `pollSec` OPF sends GET <url> with `Authorization: Bearer <token>` and
// expects:
//
//   { "items": [ { "id": "1052", "ref": "IITEG-1052", "name": "Wall bracket",
//                  "qty": 8, "material": "PETG", "color": "#202224",
//                  "due": "2026-10-17", "file_url": "https://…/bracket.stl",
//                  "notes": "…" } ] }
//
// Each id is taken once. When a plate made from it is queued, OPF reports
// back with POST <url>/status (see README) so the order shows its real date.

import type { FarmService } from "../core/farm";

let timer: ReturnType<typeof setInterval> | null = null;

export function startInboxSource(farm: FarmService, log: (msg: string) => void = console.log) {
  stopInboxSource();
  const src = farm.settings.inboxSource;
  if (!src?.url) return;
  const host = (() => { try { return new URL(src.url).host; } catch { return src.url; } })();

  const poll = async () => {
    try {
      const res = await fetch(src.url, { headers: { Authorization: `Bearer ${src.token}`, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { items?: Record<string, unknown>[] };
      const s = (v: unknown) => (typeof v === "string" && v ? v : null);
      const items = (body.items ?? []).filter((i) => i && (typeof i.id === "string" || typeof i.id === "number") && typeof i.name === "string").map((i) => ({
        id: String(i.id), ref: s(i.ref), name: String(i.name), qty: Math.max(1, Number(i.qty) || 1), material: s(i.material),
        color: s(i.color), due: s(i.due), fileUrl: s(i.file_url), notes: s(i.notes),
      }));
      const added = farm.receive(host, items);
      if (added) log(`Fetched ${added} new item(s) from ${host}`);
    } catch (e) {
      log(`Could not fetch work from ${host}: ${(e as Error).message}`);
    }
  };
  void poll();
  timer = setInterval(poll, Math.max(15, src.pollSec) * 1000);
}

export function stopInboxSource() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Tell the outside system when its part is queued and when it will come off. */
export async function reportStatus(farm: FarmService, body: { ref: string | null; status: "queued" | "printing" | "done" | "removed"; printer: string; start?: string; end?: string }) {
  const src = farm.settings.inboxSource;
  if (!src?.url || !body.ref) return;
  try {
    await fetch(src.url.replace(/\/+$/, "") + "/status", {
      method: "POST",
      headers: { Authorization: `Bearer ${src.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* best effort: the next fetch still works */
  }
}
