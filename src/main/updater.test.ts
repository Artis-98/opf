import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changesSinceLastRun, checkForUpdate, isCheckout } from "./updater";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "opf-upd-"));
  dirs.push(d);
  return d;
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });

function commit(repo: string, file: string, subject: string, body = "") {
  writeFileSync(join(repo, file), subject);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", subject, ...(body ? ["-m", body] : []));
}

afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("updater", () => {
  // A "GitHub" repository, Claude's working copy, and the copy on the user's PC.
  const remote = tmp();
  git(remote, "init", "-q", "--bare");
  const dev = tmp();
  git(dev, "clone", "-q", remote, ".");
  commit(dev, "a.txt", "First version");
  git(dev, "push", "-q", "origin", "HEAD:main");
  const pc = tmp();
  git(pc, "clone", "-q", "-b", "main", remote, ".");
  const state = join(tmp(), "seen.json");

  it("knows a git checkout from a plain folder", () => {
    expect(isCheckout(pc)).toBe(true);
    expect(isCheckout(tmp())).toBe(false);
  });

  it("says nothing when the PC copy is up to date", async () => {
    expect(await checkForUpdate(pc)).toBeNull();
  });

  it("lists new commits on GitHub, newest first, with their first paragraph", async () => {
    commit(dev, "b.txt", "Test printers", "An A1 and an A1 mini you can\nprint on without printing.\n\nCo-Authored-By: X <x@y>");
    commit(dev, "c.txt", "Faster simulator");
    git(dev, "push", "-q", "origin", "HEAD:main");
    const u = await checkForUpdate(pc);
    expect(u?.behind).toBe(2);
    expect(u?.changes).toEqual([
      { subject: "Faster simulator", body: "" },
      { subject: "Test printers", body: "An A1 and an A1 mini you can print on without printing." },
    ]);
  });

  it("reports nothing on the first run, then what changed since the last run", async () => {
    expect(await changesSinceLastRun(pc, state)).toEqual([]);
    git(pc, "pull", "-q", "--ff-only");
    const changes = await changesSinceLastRun(pc, state);
    expect(changes.map((c) => c.subject)).toEqual(["Faster simulator", "Test printers"]);
    expect(await changesSinceLastRun(pc, state)).toEqual([]);
  });
});
