// Keeping a copy of OPF that runs from a git checkout up to date.
//
// OPF started with the launcher (OPF.bat / scripts/launch.cjs) runs straight
// from its git folder. While it is open it asks GitHub every few minutes
// whether there is something newer; the window then offers a Restart, and the
// launcher pulls, rebuilds and opens the new version. After an update the
// window lists what changed since the last time it was opened, from the
// commit messages.

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Change {
  subject: string;
  body: string;
}

export interface UpdateState {
  /** Commits on GitHub that this copy does not have yet. */
  behind: number;
  changes: Change[];
  /** An installed copy cannot update itself: the page to download the new version from. */
  download?: string;
}

/** Where the installer is offered. */
export const DOWNLOAD_PAGE = "https://opf.iiteg.com/";

/** "0.2.10" is newer than "0.2.9". Anything after a dash ("0.3.0-beta") is ignored. */
export function isNewer(version: string, than: string): boolean {
  const parts = (v: string) => v.replace(/^v/i, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const a = parts(version), b = parts(than);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** For an installed copy: the newest release on GitHub, when it is newer than this one. Null when up to date. */
export async function checkForRelease(current: string, repo = "Artis-98/opf"): Promise<UpdateState | null> {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "OPF" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const release = (await r.json()) as { tag_name?: string; body?: string | null };
  const latest = (release.tag_name ?? "").replace(/^v/i, "");
  if (!latest || !isNewer(latest, current)) return null;
  const summary = (release.body ?? "").trim().split(/\n\s*\n/)[0]?.replace(/\s*\n\s*/g, " ") ?? "";
  return { behind: 1, changes: [{ subject: `OPF ${latest} is out`, body: summary }], download: DOWNLOAD_PAGE };
}

function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: root, timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });
}

export function isCheckout(root: string): boolean {
  return existsSync(join(root, ".git"));
}

const SEP_FIELD = "\x1f";
const SEP_RECORD = "\x1e";

function parseLog(out: string): Change[] {
  return out
    .split(SEP_RECORD)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [subject, body = ""] = r.split(SEP_FIELD);
      // Keep the first paragraph of the body: the plain-words summary. Drop trailers.
      const para = body.trim().split(/\n\s*\n/)[0] ?? "";
      const clean = /^(Co-Authored-By|Claude-Session|Signed-off-by):/im.test(para) ? "" : para.replace(/\s*\n\s*/g, " ");
      return { subject: subject.trim(), body: clean };
    });
}

const LOG_FORMAT = `--format=%s${SEP_FIELD}%b${SEP_RECORD}`;

/** Fetch from GitHub and say what this copy is missing. Null when up to date. */
export async function checkForUpdate(root: string): Promise<UpdateState | null> {
  await git(root, ["fetch", "--quiet", "origin"]);
  const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const changes = parseLog(await git(root, ["log", LOG_FORMAT, "-n", "30", `HEAD..origin/${branch}`]));
  return changes.length ? { behind: changes.length, changes } : null;
}

/**
 * What changed since OPF was last opened, newest first. The first run only
 * records where it is and reports nothing.
 */
export async function changesSinceLastRun(root: string, stateFile: string): Promise<Change[]> {
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  let seen: string | null = null;
  try {
    seen = JSON.parse(readFileSync(stateFile, "utf8")).seen ?? null;
  } catch { /* first run */ }
  writeFileSync(stateFile, JSON.stringify({ seen: head }));
  if (!seen || seen === head) return [];
  try {
    return parseLog(await git(root, ["log", LOG_FORMAT, "-n", "30", `${seen}..${head}`]));
  } catch {
    return []; // the old commit is gone (history rewritten): nothing sensible to show
  }
}

/**
 * Start the launcher, which waits for this OPF to close, updates, and opens OPF again the way it
 * was: in the background (for OPF Slicer) out of sight, or with its own window.
 */
export function restartThroughLauncher(root: string, background = false) {
  const args = [join(root, "scripts", "launch.cjs"), "--wait", background ? "--background" : "--window"];
  const child = spawn(process.platform === "win32" ? "node.exe" : "node", args, {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: background,
  });
  child.unref();
}
