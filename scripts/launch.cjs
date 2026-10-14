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
// --no-start does everything except opening the window (for testing).

const { spawn, spawnSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
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
  const child = spawn(electron, [root, ...extra], { cwd: root, detached: true, stdio: "ignore", env });
  child.unref();
  say("OPF is opening.");
}

try {
  if (args.has("--wait")) sleep(2500); // let the window that asked for the restart close
  update();
  if (!installIfNeeded()) throw new Error("Installing packages failed.");
  if (!build()) throw new Error("Building OPF failed.");
  desktopShortcut();
  if (!args.has("--no-start")) start();
  sleep(updateFailed ? 10000 : 1500); // long enough to read why it did not update
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}
