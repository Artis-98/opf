// Publishes a small farm update (see src/main/farm-update.ts): builds the farm, zips out/, resources/ and
// package.json, signs the manifest with OPF's update key and puts both on the GitHub release
// "farm-latest", where installed copies look. Run from farm/ on the owner's PC, where the key is:
//
//   node scripts/publish-farm-update.cjs           the real thing (bump "version" in package.json first)
//   node scripts/publish-farm-update.cjs --test    to the release "farm-test" instead; point a copy at it
//                                                  with OPF_FARM_FEED=https://github.com/Artis-98/opf/releases/download/farm-test/farm.json
//   node scripts/publish-farm-update.cjs --dry     builds and signs, uploads nothing
//
// The key is %APPDATA%\IITEG\OPF\farm-update-key.pem (or OPF_FARM_KEY). Without it no copy accepts an update.

const { execFileSync } = require("child_process");
const { createHash, createPrivateKey, sign } = require("crypto");
const fs = require("fs");
const path = require("path");
const { zipSync } = require("fflate");
const { depsFingerprint } = require("./deps-fingerprint.cjs");

const root = path.join(__dirname, "..");
const args = new Set(process.argv.slice(2));
const test = args.has("--test");
const dry = args.has("--dry");
const repo = "Artis-98/opf";
const tag = test ? "farm-test" : "farm-latest";

const sh = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { cwd: root, encoding: "utf8", ...opts });

function addTree(files, dir, prefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const name = `${prefix}${e.name}`;
    if (e.isDirectory()) addTree(files, full, `${name}/`);
    else if (!e.name.startsWith(".")) files[name] = new Uint8Array(fs.readFileSync(full));
  }
}

/** What changed for someone using OPF: the farm's commits since the last update or installer. */
function changesSince() {
  let base = null;
  try {
    base = sh("git", ["describe", "--tags", "--abbrev=0", "--match", "farm-v*", "--match", "v*"]).trim();
  } catch { /* no tag yet */ }
  const range = base ? [`${base}..HEAD`] : ["-n", "20"];
  const out = sh("git", ["log", "--format=%s%x1f%b%x1e", ...range, "--", "."]);
  return out.split("\x1e").map((r) => r.trim()).filter(Boolean).map((r) => {
    const [subject, body = ""] = r.split("\x1f");
    const para = body.trim().split(/\n\s*\n/)[0] ?? "";
    return { subject: subject.trim(), body: /^(Co-Authored-By|Signed-off-by):/im.test(para) ? "" : para.replace(/\s*\n\s*/g, " ") };
  });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
// A test update is always newer than the copy it is tried on: an extra number, the time.
const version = test ? `${pkg.version.split("-")[0]}.${Math.floor(Date.now() / 1000)}` : pkg.version;
const keyFile = process.env.OPF_FARM_KEY || path.join(process.env.APPDATA || "", "IITEG", "OPF", "farm-update-key.pem");
if (!fs.existsSync(keyFile)) throw new Error(`No update key at ${keyFile}.`);

console.log(`Building the farm ${version}…`);
sh(process.execPath, [path.join(root, "node_modules", "electron-vite", "bin", "electron-vite.js"), "build"], { stdio: "inherit" });

const files = {};
addTree(files, path.join(root, "out"), "out/");
addTree(files, path.join(root, "resources"), "resources/");
// The update's own version, so the farm knows what it runs.
files["package.json"] = new TextEncoder().encode(JSON.stringify({ ...pkg, version }, null, 2));
const zip = zipSync(files, { level: 9 });
const file = `opf-farm-${version}.zip`;
const sha256 = createHash("sha256").update(zip).digest("hex");
const manifest = { version, file, sha256, deps: depsFingerprint(root), changes: test ? [{ subject: `Test update ${version}`, body: "" }] : changesSince() };
const text = `OPF farm update\n${manifest.version}\n${manifest.file}\n${manifest.sha256}\n${manifest.deps}\n`;
manifest.sig = sign(null, Buffer.from(text), createPrivateKey(fs.readFileSync(keyFile))).toString("base64");

const outDir = path.join(root, "release", "farm-update");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, file), zip);
fs.writeFileSync(path.join(outDir, "farm.json"), JSON.stringify(manifest, null, 2));
console.log(`${file}: ${(zip.length / 1048576).toFixed(1)} MB, ${manifest.changes.length} change(s), packages ${manifest.deps}`);
if (dry) process.exit(0);

let exists = true;
try { sh("gh", ["release", "view", tag, "-R", repo, "--json", "tagName"]); } catch { exists = false; }
if (!exists) {
  sh("gh", ["release", "create", tag, "-R", repo, "--target", "main", "--prerelease", "--latest=false",
    "--title", test ? "OPF farm update test" : "OPF farm updates",
    "--notes", "Small farm updates that installed copies of OPF download by themselves. To install OPF, use the latest release."]);
}
sh("gh", ["release", "upload", tag, "-R", repo, "--clobber", path.join(outDir, file), path.join(outDir, "farm.json")], { stdio: "inherit" });
// Older zips go: farm.json only ever names the newest.
const assets = JSON.parse(sh("gh", ["release", "view", tag, "-R", repo, "--json", "assets"])).assets;
for (const a of assets) if (a.name !== file && a.name !== "farm.json") sh("gh", ["release", "delete-asset", tag, a.name, "-R", repo, "--yes"]);
if (!test) {
  sh("git", ["tag", `farm-v${version}`]);
  sh("git", ["push", "origin", `farm-v${version}`], { stdio: "inherit" });
}
console.log(`Published ${version} to the release ${tag}.`);
