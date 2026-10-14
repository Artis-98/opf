// Newer npm versions do not run a dependency's install script until it is
// approved, so Electron's own step that downloads the Electron program may
// never have run. That shows up as "Error: Electron uninstall" on
// `npm run dev`. Run that step here when it is missing.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(0);
const dir = path.join(__dirname, "..", "node_modules", "electron");
if (!fs.existsSync(dir)) process.exit(0);
if (fs.existsSync(path.join(dir, "path.txt"))) process.exit(0);

console.log("Downloading Electron (about 100 MB, once)…");
execFileSync(process.execPath, [path.join(dir, "install.js")], { stdio: "inherit", cwd: dir });
