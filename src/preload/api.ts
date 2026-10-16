// What the window can ask of OPF. Implemented by Electron's preload for the
// app, and by an in-browser farm of simulated printers for the demo.

import type { Snapshot } from "../core/types";

export interface ModelFile {
  name: string;
  /** Where it is on disk, when it came from the file dialog. */
  path: string | null;
  data: Uint8Array;
}

export interface SliceRequest {
  printerId: string;
  name: string;
  objects: { name: string; stl: Uint8Array }[];
}

export interface SliceResult {
  file: string;
  minutes: number;
  grams: number;
  filaments: { color: string; material: string; grams: number }[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** One change, from a commit message: a short title and a plain-words summary. */
export interface Change {
  subject: string;
  body: string;
}

export interface UpdateInfo {
  behind: number;
  changes: Change[];
  /** An installed OPF: the page with the new version's installer. restart() opens it. */
  download?: string;
}

export interface OpfApi {
  snapshot(): Promise<Snapshot>;
  act(name: string, ...args: unknown[]): Promise<Result<unknown>>;
  onUpdate(cb: (s: Snapshot) => void): () => void;
  /** Opens the system file dialog. Null in the browser demo, which uses a file input instead. */
  openModels: (() => Promise<ModelFile[]>) | null;
  /** Picks a slicer profile .json. Null in the browser demo. */
  pickProfile: (() => Promise<string | null>) | null;
  slice(req: SliceRequest): Promise<Result<SliceResult>>;
  loadDemo(): Promise<void>;
  /** A newer OPF on GitHub, when this copy runs from its git folder. */
  updateState(): Promise<UpdateInfo | null>;
  onUpdateReady(cb: (u: UpdateInfo) => void): () => void;
  /** What changed since OPF was last opened; empty after the first call. */
  whatsNew(): Promise<Change[]>;
  /** Close, update through the launcher, and open again. */
  restart(): Promise<void>;
  /** From the small OPF by the clock: open the full OPF (OPF Slicer, or the farm window). */
  openFull?: () => Promise<void>;
  isDemo: boolean;
}
