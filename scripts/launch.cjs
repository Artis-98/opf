// Starts OPF from its git folder, up to date.
//
//   1. Fetches the newest version from GitHub (git pull). Offline? It starts
//      the version already here.
//   2. Installs packages, but only when package-lock.json changed.
//   3. Builds the app and opens it, then this window closes.
//   4. On Windows, the first time, puts an OPF icon on the desktop.
//
// OPF.bat (Windows) and OPF.sh (macOS, Linux) run this. The Restart button in
// OPF runs it with --wait, so the old window can close first.
// --background starts OPF without a window, for OPF Slicer's Farm tab. OPF Slicer
// finds this script through launcher.json, which is written to OPF's settings
// folder each time.
// --no-start does everything except opening the window (for testing).

const { spawn, spawnSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const args = new Set(process.argv.slice(2));
const win = process.platform === "win32";
const say = (msg) => console.log(msg);

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", shell: win && /\.cmd$/i.test(cmd), ...opts });
  return r.status === 0;
}

function capture(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// npm install may rewrite package-lock.json (another npm version writes it a
// little differently). Nobody edits it by hand here, and a changed copy would
// stop git pull from ever updating OPF again, so it is put back.
function restoreLock() {
  if (capture("git", ["status", "--porcelain", "--", "package-lock.json"])) {
    run("git", ["checkout", "--", "package-lock.json"], { stdio: "ignore" });
  }
}

let updateFailed = false;

function update() {
  if (!fs.existsSync(path.join(root, ".git"))) return;
  say("Checking for a new version of OPF…");
  restoreLock();
  const before = capture("git", ["rev-parse", "HEAD"]);
  if (!run("git", ["pull", "--ff-only", "--quiet"], { stdio: ["ignore", "ignore", "inherit"] })) {
    const changed = capture("git", ["status", "--short", "--untracked-files=no"]);
    say(changed
      ? `Could not get the new version, because these files in the OPF folder were changed:\n${changed}\nStarting the version you have.`
      : "Could not get the new version (offline?). Starting the version you have.");
    updateFailed = true;
    return;
  }
  const after = capture("git", ["rev-parse", "HEAD"]);
  if (before && after && before !== after) {
    const log = capture("git", ["log", "--format=  - %s", `${before}..${after}`]);
    say(`Updated OPF:\n${log}`);
  } else {
    say("OPF is up to date.");
  }
}

function lockHash() {
  const lock = path.join(root, "package-lock.json");
  return fs.existsSync(lock) ? createHash("sha256").update(fs.readFileSync(lock)).digest("hex") : "none";
}

function installIfNeeded() {
  const marker = path.join(root, "node_modules", ".opf-lock-hash");
  const want = lockHash();
  const have = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : null;
  if (have === want && fs.existsSync(path.join(root, "node_modules", "electron-vite"))) return true;
  say("Installing what this version needs (a minute or two)…");
  if (!run(win ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"])) return false;
  restoreLock();
  fs.writeFileSync(marker, want);
  return true;
}

function build() {
  say("Building…");
  return run(process.execPath, [path.join(root, "node_modules", "electron-vite", "bin", "electron-vite.js"), "build"], { stdio: ["ignore", "ignore", "inherit"] });
}

/** A desktop icon, made once. PowerShell is only used for this, through an inline command. */
function desktopShortcut() {
  if (!win) return;
  const ps = [
    "$d = [Environment]::GetFolderPath('Desktop')",
    "$p = Join-Path $d 'OPF.lnk'",
    "if (-not (Test-Path $p)) {",
    "  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($p)",
    "  $s.TargetPath = Join-Path $env:OPF_ROOT 'OPF.bat'",
    "  $s.WorkingDirectory = $env:OPF_ROOT",
    "  $s.IconLocation = (Join-Path $env:OPF_ROOT 'resources\\icon.ico') + ',0'",
    "  $s.Description = 'OPF, Open Print Farm'",
    "  $s.Save()",
    "  'created'",
    "}",
  ].join("; ");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    cwd: root, encoding: "utf8", env: { ...process.env, OPF_ROOT: root },
  });
  if (r.stdout && r.stdout.includes("created")) say("Put an OPF icon on your desktop. Open OPF from there next time.");
}

function start() {
  require(path.join(root, "scripts", "ensure-electron.cjs")).ensureElectron();
  const electron = require(path.join(root, "node_modules", "electron"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // OPF_ELECTRON_ARGS: extra Electron switches, for testing the launcher (e.g. a separate --user-data-dir).
  const extra = (process.env.OPF_ELECTRON_ARGS || "").split(" ").filter(Boolean);
  if (args.has("--background")) extra.push("--background");
  const child = spawn(electron, [root, ...extra], { cwd: root, detached: true, stdio: "ignore", env });
  child.unref();
  say(args.has("--background") ? "OPF is running for OPF Slicer." : "OPF is opening.");
}

/** OPF's settings folder, where Electron keeps it: <app data>/OPF. */
function settingsDir() {
  const name = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).productName || "opf";
  const base = win ? process.env.APPDATA
    : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support")
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return base ? path.join(base, name) : null;
}

/** Where OPF Slicer finds this launcher, to start OPF when its Farm tab needs it. */
function recordLauncher() {
  try {
    const dir = settingsDir();
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    const info = { node: process.execPath, script: path.join(root, "scripts", "launch.cjs"), root };
    fs.writeFileSync(path.join(dir, "launcher.json"), JSON.stringify(info, null, 2));
  } catch { /* the Farm tab then asks to start OPF from its icon */ }
}

// One launcher at a time: OPF Slicer and the desktop icon may both start OPF. The
// second one waits for the first to finish updating and building, then just starts.
const lockFile = path.join(root, ".launch.lock");

function takeLock() {
  try {
    const fd = fs.openSync(lockFile, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/** Left behind by a launcher that was closed halfway, or one that has been going far too long. */
function lockIsStale() {
  try {
    if (Date.now() - fs.statSync(lockFile).mtimeMs > 10 * 60_000) return true;
    const pid = parseInt(fs.readFileSync(lockFile, "utf8"), 10);
    if (!pid) return false; // just made, the pid not written yet
    process.kill(pid, 0); // throws when that launcher is gone
    return false;
  } catch (e) {
    return !e || e.code !== "EPERM"; // EPERM: it runs, as someone else
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(lockFile);
  } catch { /* already gone */ }
}

let locked = false;
try {
  if (args.has("--wait")) sleep(2500); // let the window that asked for the restart close
  locked = takeLock();
  if (!locked && lockIsStale()) {
    releaseLock();
    locked = takeLock();
  }
  if (locked) {
    update();
    if (!installIfNeeded()) throw new Error("Installing packages failed.");
    if (!build()) throw new Error("Building OPF failed.");
    desktopShortcut();
  } else {
    say("OPF is already being updated. Waiting for that to finish…");
    while (fs.existsSync(lockFile) && !lockIsStale()) sleep(1000);
  }
  recordLauncher();
  if (!args.has("--no-start")) start();
  sleep(updateFailed ? 10000 : 1500); // long enough to read why it did not update
} catch (e) {
  console.error(`\n${e.message}`);
  process.exitCode = 1;
} finally {
  if (locked) releaseLock();
}
