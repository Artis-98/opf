// On Windows the farm run from git is Electron's own program, so Windows calls it "Electron": in the
// firewall question when Add a printer searches the network, in Task Manager and on the taskbar.
// This gives electron.exe OPF's name, description and icon inside the file. It keeps its file name:
// Electron decides from the name electron.exe that it is not an installed copy (app.isPackaged), and
// the farm run from git depends on that. Installed copies already are OPF-Farm.exe.
// Done once per Electron version; if it cannot be done (say, the farm is running), the farm starts
// as before and it is tried again next time.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
// Bump when the name or icon below changes, so it is done again.
const BRAND = "2";

function stampOf(file) {
  const st = fs.statSync(file);
  return `${st.size}:${Math.round(st.mtimeMs)}:${BRAND}`;
}

/** Gives electron.exe OPF's name and icon (Windows only). Returns electron.exe either way. */
function brandedElectron(electronExe, log = () => {}) {
  if (process.platform !== "win32") return electronExe;
  const dir = path.dirname(electronExe);
  const stampFile = path.join(dir, ".opf-brand");
  try {
    try {
      if (fs.readFileSync(stampFile, "utf8") === stampOf(electronExe)) return electronExe;
    } catch { /* not done yet */ }

    const ResEdit = require(path.join(root, "node_modules", "resedit"));
    const exe = ResEdit.NtExecutable.from(fs.readFileSync(electronExe), { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(exe);

    // OPF's shelf icon in place of Electron's atom.
    const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
    if (group) {
      const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, "resources", "icon.ico")));
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icon.icons.map((i) => i.data));
    }

    // The name Windows shows: FileDescription in the firewall question and Task Manager.
    const info = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
    if (info) {
      for (const lang of info.getAllLanguagesForStringValues()) {
        info.setStringValues(lang, { FileDescription: "OPF", ProductName: "OPF", CompanyName: "IITEG" });
      }
      info.outputToResourceEntries(res.entries);
    }
    res.outputResource(exe);

    // Swapped in by renames: a running electron.exe can be renamed, not overwritten.
    const tmp = path.join(dir, "electron.exe.opf-new");
    const old = path.join(dir, "electron.exe.opf-old");
    fs.writeFileSync(tmp, Buffer.from(exe.generate()));
    try { fs.unlinkSync(old); } catch { /* none, or still running */ }
    fs.renameSync(electronExe, old);
    try {
      fs.renameSync(tmp, electronExe);
    } catch (e) {
      fs.renameSync(old, electronExe);
      throw e;
    }
    try { fs.unlinkSync(old); } catch { /* still running: removed next time */ }
    fs.writeFileSync(stampFile, stampOf(electronExe));
    log("Gave the farm OPF's name, so Windows asks about OPF, not Electron.");
  } catch (e) {
    log(`Could not give the farm OPF's name yet (${e.code ?? e.message}). It starts as Electron.`);
  }
  return electronExe;
}

module.exports = { brandedElectron };
