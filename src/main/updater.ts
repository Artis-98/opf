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

/** Start the launcher, which waits for this window to close, updates, and opens OPF again. */
export function restartThroughLauncher(root: string) {
  const child = spawn(process.platform === "win32" ? "node.exe" : "node", [join(root, "scripts", "launch.cjs"), "--wait"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}
