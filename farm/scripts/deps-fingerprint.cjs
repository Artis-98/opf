// Which packages the farm's main process loads at run time, with their exact versions. An installed OPF
// keeps these packages from its installer; a small farm update (src/main/farm-update.ts) replaces only
// OPF's own code. So an update is offered as small only to copies with the same packages; when they
// change, the full installer is needed. electron.vite.config.ts builds this into the farm, and
// scripts/publish-farm-update.cjs writes it into the update's manifest.

const fs = require("fs");
const path = require("path");

function depsFingerprint(root = path.join(__dirname, "..")) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  return Object.keys(pkg.dependencies ?? {})
    .sort()
    .map((name) => `${name}@${lock.packages?.[`node_modules/${name}`]?.version ?? "?"}`)
    .join(",");
}

module.exports = { depsFingerprint };
if (require.main === module) console.log(depsFingerprint());
