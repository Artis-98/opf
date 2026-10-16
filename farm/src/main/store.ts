// The farm is one JSON file in the user's app-data folder. Written to a
// temporary file and renamed into place, so a crash mid-write never leaves
// half a farm. A file that cannot be read is kept aside, not overwritten.

import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { emptyFarm } from "../core/farm";
import type { FarmData } from "../core/types";

export function loadFarm(path: string): FarmData {
  if (!existsSync(path)) return emptyFarm();
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as FarmData;
    if (data?.version !== 1) throw new Error(`Unknown farm file version ${data?.version}`);
    return data;
  } catch (e) {
    const aside = `${path}.unreadable-${Date.now()}`;
    renameSync(path, aside);
    console.error(`Could not read ${path} (${(e as Error).message}); kept it as ${aside} and started a new farm.`);
    return emptyFarm();
  }
}

export function makeSaver(path: string) {
  let pending: FarmData | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(pending, null, 1));
    renameSync(tmp, path);
    pending = null;
  };
  return {
    save(data: FarmData) {
      pending = data;
      if (!timer) timer = setTimeout(flush, 300);
    },
    flush() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}
