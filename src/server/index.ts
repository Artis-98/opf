// OPF without a window: the farm, its web page and its API, for an always-on
// PC or a Raspberry Pi. Open http://127.0.0.1:7878/ in a browser, or point a
// slicer's OctoPrint print host at it.
//
//   node out/main/server.js          this computer only
//   node out/main/server.js --lan    also other devices on the network (they need the token)
//
// The farm is kept in ~/.opf (or OPF_DATA).

import { homedir } from "node:os";
import { join } from "node:path";
import { makeDriverFactory } from "../main/drivers";
import { startHost, type Host } from "../main/host";

const dataDir = process.env.OPF_DATA ?? join(homedir(), ".opf");
const lan = process.argv.includes("--lan");
let host: Host | null = null;
host = startHost({
  dataDir,
  factory: makeDriverFactory(() => host?.farm.settings.simSpeed ?? 1, () => ({})),
  uiRoot: process.env.OPF_UI ?? join(__dirname, "../renderer"),
  host: lan ? "0.0.0.0" : "127.0.0.1",
});
const { port, token } = host.farm.settings.api;
console.log(`OPF is running. Farm: http://127.0.0.1:${port}/  (data in ${dataDir})`);
if (lan) console.log(`From other devices: http://<this computer's address>:${port}/?token=${token}`);

const stop = () => {
  host?.shutdown();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
