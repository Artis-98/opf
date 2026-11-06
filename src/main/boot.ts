// The farm's first file. An installed OPF that has downloaded a small farm update (farm-update.ts) runs
// that update's code instead of its own; everything else starts the farm as it is.

import { app } from "electron";
import Module from "node:module";
import { delimiter, join } from "node:path";
import { chooseUpdate } from "./farm-update";

let entry = join(__dirname, "index.js");
if (app.isPackaged) {
  try {
    const update = chooseUpdate(app.getPath("userData"), app.getVersion());
    if (update) {
      // The update is OPF's code only; the packages it uses are the installer's, in its app folder.
      // NODE_PATH is where require() looks last; _initPaths() makes it read NODE_PATH again.
      const modules = join(app.getAppPath(), "node_modules");
      process.env.NODE_PATH = process.env.NODE_PATH ? `${modules}${delimiter}${process.env.NODE_PATH}` : modules;
      (Module as unknown as { _initPaths(): void })._initPaths();
      process.env.OPF_FARM_UPDATE = update.version;
      entry = update.main;
    }
  } catch { /* the installed farm */ }
}
require(entry);
