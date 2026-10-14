// The farm: shelves, printers, their queues, and the drivers that talk to them.
//
// Runs in Electron's main process for the real app, and in the browser for the
// demo. Everything the window can do goes through `act()`, by name, so the
// list of things a window (or the local API) may ask for is written down once.

import { emptyLive, type DriverFactory, type PrinterDriver } from "./driver";
import type { FarmData, InboxItem, LiveState, PlateJob, PrinterConfig, Settings, SlicerInfo, Snapshot } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  workStart: 8,
  workEnd: 20,
  workDays: "1111100",
  overnightOk: true,
  changeoverMin: 10,
  api: { enabled: true, port: 7878, token: "" },
  inboxSource: null,
  slicerPath: null,
};

export function emptyFarm(): FarmData {
  return {
    version: 1,
    shelves: [{ id: "shelf-a", name: "Shelf A", slots: [null, null, null, null] }],
    printers: [],
    current: {},
    queues: {},
    inbox: [],
    history: [],
    sourceSeen: [],
    settings: { ...DEFAULT_SETTINGS, api: { ...DEFAULT_SETTINGS.api, token: newId("") + newId("") } },
  };
}

export function newId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

export interface FarmOptions {
  persist: (data: FarmData) => void;
  slicer: () => SlicerInfo;
  demo?: boolean;
}

/** Actions a window or the local API may call by name. */
export const ACTIONS = [
  "addPrinter", "updatePrinter", "removePrinter",
  "addShelf", "renameShelf", "removeShelf", "addSlot", "removeSlot", "placePrinter",
  "enqueue", "reorder", "dequeue", "transfer", "updateJob",
  "startNext", "pause", "resume", "stop", "clearBed",
  "addInbox", "removeInbox", "updateSettings", "replaceData",
] as const;
export type ActionName = (typeof ACTIONS)[number];

export class FarmService {
  private live: Record<string, LiveState> = {};
  private drivers = new Map<string, PrinterDriver>();
  private listeners = new Set<(s: Snapshot) => void>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private data: FarmData, private factory: DriverFactory, private opts: FarmOptions) {
    this.normalise();
  }

  /** Fill in anything an older or hand-edited farm file is missing. */
  private normalise() {
    const d = this.data;
    d.settings = { ...DEFAULT_SETTINGS, ...d.settings, api: { ...DEFAULT_SETTINGS.api, ...d.settings?.api } };
    d.shelves ??= [];
    d.inbox ??= [];
    d.history ??= [];
    d.sourceSeen ??= [];
    d.current ??= {};
    d.queues ??= {};
    for (const p of d.printers) {
      d.queues[p.id] ??= [];
      d.current[p.id] ??= null;
    }
  }

  start() {
    for (const p of this.data.printers) this.connect(p);
  }

  shutdown() {
    for (const d of this.drivers.values()) d.disconnect();
    this.drivers.clear();
  }

  private connect(cfg: PrinterConfig) {
    this.live[cfg.id] = emptyLive();
    const driver = this.factory(cfg, (patch) => this.onLive(cfg.id, patch));
    this.drivers.set(cfg.id, driver);
    driver.connect();
  }

  private disconnect(id: string) {
    this.drivers.get(id)?.disconnect();
    this.drivers.delete(id);
    delete this.live[id];
  }

  private onLive(id: string, patch: Partial<LiveState>) {
    const prev = this.live[id] ?? emptyLive();
    const next: LiveState = { ...prev, ...patch, updatedAt: Date.now() };
    this.live[id] = next;
    // A print that started from the printer's own screen or another app still shows up, without a plate in OPF.
    if (prev.status !== next.status && next.status === "finished" && this.data.current[id]) {
      this.changed(true);
    } else {
      this.changed(false);
    }
  }

  snapshot(): Snapshot {
    return structuredClone({ data: this.data, live: this.live, slicer: this.opts.slicer(), demo: !!this.opts.demo });
  }

  subscribe(cb: (s: Snapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Save if the farm itself changed, and tell windows soon, coalescing bursts of printer updates. */
  private changed(persist: boolean) {
    if (persist) this.opts.persist(this.data);
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      const snap = this.snapshot();
      for (const l of this.listeners) l(snap);
    }, persist ? 0 : 250);
  }

  async act(name: string, args: unknown[]): Promise<unknown> {
    if (!(ACTIONS as readonly string[]).includes(name)) throw new Error(`Unknown action: ${name}`);
    const fn = (this as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    return await fn.apply(this, args);
  }

  private printer(id: string): PrinterConfig {
    const p = this.data.printers.find((x) => x.id === id);
    if (!p) throw new Error("That printer no longer exists.");
    return p;
  }

  private queue(id: string): PlateJob[] {
    this.printer(id);
    return (this.data.queues[id] ??= []);
  }

  /* ---------- printers and shelves ---------- */

  addPrinter(cfg: Omit<PrinterConfig, "id"> & { id?: string }, place?: { shelfId: string; slot: number }): string {
    const id = cfg.id ?? newId("p-");
    if (this.data.printers.some((p) => p.id === id)) throw new Error("A printer with that id already exists.");
    const full: PrinterConfig = { ...cfg, id };
    this.data.printers.push(full);
    this.data.queues[id] = [];
    this.data.current[id] = null;
    const shelf = place ? this.data.shelves.find((s) => s.id === place.shelfId) : this.data.shelves.find((s) => s.slots.includes(null));
    if (shelf) {
      const slot = place && shelf.slots[place.slot] === null ? place.slot : shelf.slots.indexOf(null);
      if (slot >= 0) shelf.slots[slot] = id;
      else shelf.slots.push(id);
    } else {
      this.data.shelves.push({ id: newId("shelf-"), name: `Shelf ${String.fromCharCode(65 + this.data.shelves.length)}`, slots: [id, null, null, null] });
    }
    this.connect(full);
    this.changed(true);
    return id;
  }

  updatePrinter(id: string, patch: Partial<Omit<PrinterConfig, "id">>) {
    const p = this.printer(id);
    const reconnect = ["driver", "host", "serial", "accessCode", "apiKey"].some((k) => k in patch && (patch as Record<string, unknown>)[k] !== (p as unknown as Record<string, unknown>)[k]);
    Object.assign(p, patch);
    if (reconnect) {
      this.disconnect(id);
      this.connect(p);
    }
    this.changed(true);
  }

  removePrinter(id: string) {
    this.printer(id);
    this.disconnect(id);
    this.data.printers = this.data.printers.filter((p) => p.id !== id);
    for (const s of this.data.shelves) s.slots = s.slots.map((x) => (x === id ? null : x));
    // Plates waiting for it go back to nobody: put them in the inbox rather than losing them.
    for (const job of this.data.queues[id] ?? []) {
      this.data.inbox.push({ id: newId("in-"), ref: job.ref, name: job.name, qty: 1, material: job.filaments[0]?.material ?? null, color: job.filaments[0]?.color ?? null, due: null, fileUrl: null, notes: `Was queued on a removed printer (${job.minutes} min, ${job.grams} g).`, source: "opf", receivedAt: Date.now() });
    }
    delete this.data.queues[id];
    delete this.data.current[id];
    this.changed(true);
  }

  addShelf(name?: string): string {
    const id = newId("shelf-");
    this.data.shelves.push({ id, name: name || `Shelf ${String.fromCharCode(65 + this.data.shelves.length)}`, slots: [null, null, null, null] });
    this.changed(true);
    return id;
  }

  renameShelf(id: string, name: string) {
    const s = this.data.shelves.find((x) => x.id === id);
    if (!s || !name.trim()) return;
    s.name = name.trim();
    this.changed(true);
  }

  removeShelf(id: string) {
    const s = this.data.shelves.find((x) => x.id === id);
    if (!s) return;
    if (s.slots.some(Boolean)) throw new Error("Move the printers off this shelf first.");
    this.data.shelves = this.data.shelves.filter((x) => x.id !== id);
    this.changed(true);
  }

  addSlot(shelfId: string) {
    const s = this.data.shelves.find((x) => x.id === shelfId);
    if (!s) return;
    s.slots.push(null);
    this.changed(true);
  }

  removeSlot(shelfId: string) {
    const s = this.data.shelves.find((x) => x.id === shelfId);
    if (!s) return;
    const i = s.slots.lastIndexOf(null);
    if (i < 0) throw new Error("Every slot on this shelf has a printer.");
    s.slots.splice(i, 1);
    this.changed(true);
  }

  /** Put a printer in a slot. If another printer is there, the two swap places. */
  placePrinter(id: string, shelfId: string, slot: number) {
    this.printer(id);
    const target = this.data.shelves.find((s) => s.id === shelfId);
    if (!target || slot < 0 || slot >= target.slots.length) return;
    const from = this.data.shelves.find((s) => s.slots.includes(id));
    const fromSlot = from ? from.slots.indexOf(id) : -1;
    const occupant = target.slots[slot];
    if (from) from.slots[fromSlot] = occupant && occupant !== id ? occupant : null;
    target.slots[slot] = id;
    this.changed(true);
  }

  /* ---------- queues ---------- */

  enqueue(printerId: string, job: Omit<PlateJob, "id" | "createdAt"> & { id?: string }, position: "end" | "next" | number = "end"): string {
    const q = this.queue(printerId);
    const full: PlateJob = { ...job, id: job.id ?? newId("j-"), createdAt: Date.now() };
    const at = position === "end" ? q.length : position === "next" ? 0 : Math.max(0, Math.min(q.length, position));
    q.splice(at, 0, full);
    this.changed(true);
    return full.id;
  }

  reorder(printerId: string, from: number, to: number) {
    const q = this.queue(printerId);
    if (from < 0 || from >= q.length) return;
    const [j] = q.splice(from, 1);
    q.splice(Math.max(0, Math.min(q.length, to)), 0, j);
    this.changed(true);
  }

  dequeue(printerId: string, index: number): PlateJob | null {
    const q = this.queue(printerId);
    const [j] = q.splice(index, 1);
    this.changed(true);
    return j ?? null;
  }

  transfer(printerId: string, index: number, toPrinterId: string, position: "end" | "next" = "end") {
    const q = this.queue(printerId), to = this.queue(toPrinterId);
    const [j] = q.splice(index, 1);
    if (!j) return;
    if (position === "next") to.unshift(j);
    else to.push(j);
    this.changed(true);
  }

  updateJob(printerId: string, jobId: string, patch: Partial<Omit<PlateJob, "id">>) {
    const j = this.queue(printerId).find((x) => x.id === jobId);
    if (!j) return;
    Object.assign(j, patch);
    this.changed(true);
  }

  /* ---------- printing ---------- */

  async startNext(printerId: string) {
    const p = this.printer(printerId);
    const q = this.queue(printerId);
    const live = this.live[printerId];
    if (this.data.current[printerId]) throw new Error("Confirm the bed is clear first.");
    if (!q.length) throw new Error("Nothing is queued for this printer.");
    if (live && ["printing", "preparing", "paused"].includes(live.status)) throw new Error(`${p.name} is busy.`);
    if (live?.status === "offline") throw new Error(`${p.name} is offline.`);
    const job = q[0];
    if (!job.file && p.driver !== "simulator") throw new Error("Slice this plate before sending it. It only has an estimate.");
    await this.drivers.get(printerId)!.start(job);
    q.shift();
    this.data.current[printerId] = job;
    this.changed(true);
  }

  async pause(printerId: string) {
    await this.drivers.get(printerId)?.pause();
  }

  async resume(printerId: string) {
    await this.drivers.get(printerId)?.resume();
  }

  async stop(printerId: string) {
    await this.drivers.get(printerId)?.stop();
    const job = this.data.current[printerId];
    if (job) this.data.history.unshift({ printerId, job, endedAt: Date.now(), outcome: "stopped" });
    this.data.current[printerId] = null;
    this.trimHistory();
    this.changed(true);
  }

  /** Someone took the parts off. Optionally start the next plate straight away. */
  async clearBed(printerId: string, startNext = false) {
    const job = this.data.current[printerId];
    const live = this.live[printerId];
    if (job) {
      const failed = live?.status === "error";
      this.data.history.unshift({ printerId, job, endedAt: Date.now(), outcome: failed ? "failed" : "done" });
    }
    this.data.current[printerId] = null;
    if (live && live.status === "finished") this.live[printerId] = { ...live, status: "idle", progress: 0, remainingSec: null, jobName: null };
    this.trimHistory();
    this.changed(true);
    if (startNext && this.queue(printerId).length) await this.startNext(printerId);
  }

  private trimHistory() {
    if (this.data.history.length > 500) this.data.history.length = 500;
  }

  /* ---------- inbox ---------- */

  addInbox(item: Omit<InboxItem, "id" | "receivedAt"> & { id?: string }): string {
    const id = item.id ?? newId("in-");
    const existing = this.data.inbox.find((x) => x.id === id);
    if (existing) Object.assign(existing, item);
    else this.data.inbox.push({ ...item, id, receivedAt: Date.now() });
    this.changed(true);
    return id;
  }

  /**
   * Work fetched from an outside system. Each id is taken once: removing an
   * item from the inbox, or turning it into a plate, does not bring it back on
   * the next fetch. Returns how many were new.
   */
  receive(source: string, items: (Omit<InboxItem, "id" | "receivedAt" | "source"> & { id: string })[]): number {
    let added = 0;
    for (const it of items) {
      const key = `${source}:${it.id}`;
      if (this.data.sourceSeen.includes(key)) continue;
      this.data.sourceSeen.push(key);
      this.data.inbox.push({ ...it, id: `in-${newId("")}`, source, receivedAt: Date.now() });
      added++;
    }
    if (this.data.sourceSeen.length > 5000) this.data.sourceSeen.splice(0, this.data.sourceSeen.length - 5000);
    if (added) this.changed(true);
    return added;
  }

  removeInbox(id: string) {
    this.data.inbox = this.data.inbox.filter((x) => x.id !== id);
    this.changed(true);
  }

  /* ---------- settings ---------- */

  updateSettings(patch: Partial<Settings>) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.changed(true);
  }

  /** Swap in a whole farm, e.g. loading the demo or importing a backup. */
  replaceData(data: FarmData) {
    this.shutdown();
    this.data = structuredClone(data);
    this.normalise();
    this.live = {};
    this.start();
    this.changed(true);
  }

  get settings(): Settings {
    return this.data.settings;
  }

  /** Read-only view for the local API. */
  view() {
    return { data: this.data, live: this.live };
  }
}
