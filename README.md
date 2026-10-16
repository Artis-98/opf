# OPF: Open Print Farm

A desktop app for running a 3D printer farm the way it stands in your
workshop. Every printer sits on a shelf, grey until you pick it. Pick one and
it lights up: what it is printing, what is loaded in its AMS, and the plates
lined up behind it, which you can reorder, move to another printer or add to.
OPF Slicer, OrcaSlicer with the farm built in, slices the plates and sends them
into the queues.

Free and open source (AGPL-3.0). No cloud, no account.

**Download for Windows:** [opf.iiteg.com](https://opf.iiteg.com/), or the
installer on the [latest release](https://github.com/Artis-98/opf/releases/latest). One
installer puts in OPF Slicer and this farm; open **OPF** from the Start menu.

![The farm view](docs/farm.png)

## What it does

**Farm**
- Shelves of printers, laid out like your real shelves. Drag printers between
  slots, rename shelves, add slots and shelves.
- Every printer at a glance: time left, idle, finished ("clear the bed"),
  paused, error, offline. Errors stay red even when the printer is not picked.
- Pick a printer to see it live: time left, layer, temperatures, the AMS slots
  with their real colours, material, remaining filament and humidity.
- A queue on every printer: drag plates to reorder, move a plate to another
  printer, remove it. Each plate shows when it starts and finishes.
- A warning when a queued plate needs a colour or material that is not loaded
  on that printer.
- "Bed is clear, start next": a finished plate waits for a person, then the
  next one is sent.

**Timeline**
- The next 48 hours of every printer on one screen.
- Working hours: prints run unattended, but the next plate only starts when
  someone is in to clear the bed. Times outside working hours are shaded and
  plates wait for the morning. Same rules as iiteg-admin-hub's scheduler.

![The timeline](docs/timeline.png)

**Prepare**
- Drop STL, 3MF or OBJ files on a 3D plate sized for the chosen printer.
- Arrange, turn, copy, drag objects around the plate.
- Assign each object a colour straight from the printer's AMS slots.
- The printer list says which printers have the filament loaded and when each
  is free.
- An estimate of time and grams straight away; Slice runs Bambu Studio or
  OrcaSlicer for the exact numbers and the file the printer needs.
- Add the plate to the end of a printer's queue, next up, or send it and start.

![Prepare](docs/prepare.png)

**Work from other systems**
- An inbox of parts waiting to be put on a plate.
- OPF fetches approved parts from a URL you set (such as admin.iiteg.com)
  and reports back when they are queued. Nothing in the workshop has to be
  reachable from the internet.
- A local HTTP API for anything else on the network.

## Status

Version 0.2.0, the first one shipped as an installer. What has been checked where:

| Part | State |
|---|---|
| Farm, shelves, queues, timeline, Duplicate, Edit, the small OPF by the clock | Working, in daily use |
| Bambu Lab A1 and A1 mini over LAN: status, AMS colours, send and start | In daily use on the owner's farm. Needs Developer Mode on the printer to start prints. |
| Bambu Lab P1 and X1 series | Same protocol; parser tested against messages shaped like their reports, not run on one |
| Anycubic Kobra 3 / 3 Max / S1 over LAN | Status and controls written to the community's protocol notes; starting a print not yet confirmed on a Kobra 3 Max |
| Before each print (bed levelling, flow, resonance, timelapse) | New in 0.2.0, sent the way Bambu Studio and the Anycubic app send them |
| OPF Slicer: Send to farm, Edit, one window | Working; the 0.2.0 installer is the first build with the farm inside |
| Scheduling, filament matching, estimates, farm actions, local API | Covered by tests (`npm test`) |
| Klipper / Moonraker, PrusaLink, OctoPrint | Listed, not connected yet: they show as offline and keep their queue |

## Everyday use on Windows

Most people: install OPF from [opf.iiteg.com](https://opf.iiteg.com/). An
installed OPF tells you when a new release is out and links to it.

Running it from this repository instead, always on the newest `main`:

1. Once: in the `opf` folder, double-click **OPF.bat**. It puts an **OPF**
   icon on your desktop and opens OPF.
2. From then on, open OPF from the desktop icon. Each time, it fetches the
   newest version from GitHub first (a few seconds), so new features arrive
   without any commands.
3. While OPF is open, an **Update ready · Restart** button appears in the top
   bar when there is something new. After the restart, **What's new** lists
   the changes.

macOS and Linux: run `./OPF.sh` the same way.

To try things without printing, open **Settings → Test printers** and add a
simulated A1 and A1 mini. They sit on their own shelf, behave like real
printers, and can run up to 60 times faster.

## Running it

Needs Node.js 22 or newer.

```bash
npm install
npm run dev          # the desktop app, with live reload
```

On Windows, if PowerShell says *running scripts is disabled on this system*,
type `npm.cmd` instead of `npm`, or allow local scripts once with
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

`npm run dev` downloads Electron itself the first time if npm skipped that
step (newer npm versions hold back install scripts until approved, which
otherwise ends in "Error: Electron uninstall").

Try it in a browser with simulated printers, no Electron needed:

```bash
npm run demo         # http://localhost:5199
```

Pack the farm on its own (OPF Slicer's Windows build does this and puts it in its installer):

```bash
npm run pack:win     # release/win-unpacked/OPF-Farm.exe
```

The website is `site/`, uploaded to opf.iiteg.com (`bash ~/.claude/deploy.sh push opf site` on the owner's PC); its Coming next list is read live from the admin board by `tools/api/opf-upcoming.php`. `docs/` holds the pictures this README shows, and forwards the old GitHub Pages address to opf.iiteg.com.

Checks:

```bash
npm test
npm run typecheck
```

## Connecting a Bambu Lab printer

1. On the printer: Settings → Network. Note the **IP address** and the
   **access code**. Turn on **LAN mode**, and **Developer Mode** if you want
   OPF to start and stop prints (status works without it).
2. Settings → Device: note the **serial number**.
3. In OPF: Add printer → Bambu Lab, local network → fill in the three.

The printer's own certificate cannot be checked against its IP address, so OPF
accepts it for this local connection only.

## Connecting an Anycubic printer

Kobra 3, Kobra 3 Max, Kobra 3 V2, Kobra S1 and S1 Max, with or without an ACE.

1. On the printer, turn on **LAN mode** in its network settings and note its
   **IP address**. LAN mode takes it off the Anycubic app and cloud.
2. In OPF: Add printer → Anycubic Kobra 3 / S1, local network → the IP address.

OPF asks the printer for a login each time it connects (nothing from Anycubic's
apps is needed), then reads its status and the ACE's colours, and starts,
pauses and stops prints. Plates sliced in OPF Slicer for the Kobra are sent as
plain G-code. The protocol was worked out by the community
([anycubic_ha_local](https://github.com/chrisfore/anycubic_ha_local),
[kobra-connect](https://github.com/rvanderp3/kobra-connect)); starting prints
from OPF is new, so watch the first one.

## Slicing profiles

OPF slices with your own slicer and your own settings. For each printer:

1. In Bambu Studio (or OrcaSlicer) pick that printer, your process and
   filament, then **File → Export → Export Configs**.
2. In OPF: the printer's settings → Slicing profiles → choose the exported
   printer, process and filament `.json` files.

OPF finds Bambu Studio or OrcaSlicer in their usual install folders, or set the
path in Settings.

## OPF Slicer

[OPF Slicer](https://github.com/Artis-98/opf-slicer) is OrcaSlicer with four tabs:
**Farm**, **Timeline**, **Prepare** and **Preview**. Farm and Timeline are this
farm; Prepare and Preview are OrcaSlicer's own.

- Click a printer in the Farm tab, slice in Prepare, and **Send to** that printer
  from Preview. The plate goes into its queue together with its project.
- **Edit** on a plate in a queue opens its project in Prepare. Sending it again
  replaces the plate in its place in the queue.
- One program: once OPF Slicer has been opened, OPF's desktop icon opens OPF
  Slicer, with the farm running in the background. OPF Slicer also starts the
  farm by itself when it is not running. `OPF.bat --window` opens the farm
  window instead, as before.

## The small OPF by the clock

While OPF runs, its icon sits next to the clock. Click it for every printer at a
glance (time left, finished, errors) with the buttons needed at the printer:
**Bed is clear, start next**, **Start**, **Resume**. **Open OPF** opens the full
OPF. When a print finishes or a printer needs you, a notification says so. It
starts with Windows (untick **Start OPF with Windows** in its right-click menu
to stop that), and closing OPF Slicer or the farm window leaves it running;
**Quit OPF** in that menu stops it.

## Sending plates from OrcaSlicer

OPF answers like an OctoPrint printer, so OrcaSlicer (and Bambu Studio with a
third-party print host, and PrusaSlicer) can send sliced plates straight into
OPF's queues, and show the farm in its Device tab.

1. In OPF, open a printer's settings and copy the address under **Send plates
   from OrcaSlicer**, for example `http://127.0.0.1:7878/octo/p-1ikwceq6`.
2. In OrcaSlicer, open that printer's connection settings. For a Bambu Lab
   printer, first tick **Use 3rd-party print host** in the printer settings.
   Host type **OctoPrint**, paste the address, **Test**.
3. Slice and press **Send** (or **Upload and print**). The plate lands in that
   printer's queue with OrcaSlicer's own time, weight, colours and picture.

`http://127.0.0.1:7878` on its own (in **Settings → Send plates from
OrcaSlicer**) puts each plate on whichever printer can start it soonest with its
filament loaded.

## Running OPF without a window

For an always-on PC or a Raspberry Pi:

```bash
npm install
npm run server            # this computer only
node out/main/server.js --lan   # also phones and other PCs (they need the token)
```

The farm is kept in `~/.opf`. Open `http://127.0.0.1:7878/` in a browser.

## Sending work to OPF

### OPF fetches it (recommended for a website such as admin.iiteg.com)

Settings → Receive work → the URL and a token. Every minute OPF sends

```
GET <url>
Authorization: Bearer <token>
```

and expects

```json
{
  "items": [
    {
      "id": "1052",
      "ref": "IITEG-1052",
      "name": "Wall bracket",
      "qty": 8,
      "material": "PETG",
      "color": "#202224",
      "due": "2026-10-17",
      "file_url": "https://example.com/files/bracket.stl",
      "notes": "Matte side out"
    }
  ]
}
```

Only `id` and `name` are required. Each `id` is taken once, so a part that has
been handled or removed in OPF is not fetched again. When a plate made from it
is queued, OPF reports back:

```
POST <url>/status
Authorization: Bearer <token>

{ "ref": "IITEG-1052", "status": "queued", "printer": "P1S-02",
  "start": "2026-10-15T08:10:00.000Z", "end": "2026-10-15T12:20:00.000Z" }
```

### Local API

On by default at `http://127.0.0.1:7878`, token in Settings.

| | |
|---|---|
| `GET /api/v1/printers` | Every printer: status, progress, time left, loaded filament, queue with start and end times, when it is free |
| `GET /api/v1/printers/:id` | One printer |
| `GET /api/v1/inbox` | Parts waiting |
| `POST /api/v1/inbox` | Send parts: `{ "name": "…", "qty": 2, "ref": "…", "material": "PLA", "color": "#00AE42", "due": "2026-10-20", "file_url": "…" }` |
| `DELETE /api/v1/inbox/:id` | Remove one |

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7878/api/v1/printers
```

## How it is built

Electron, React and TypeScript, with three.js for the plate.

```
src/core/       the farm itself, no Electron: model, scheduler, filament
                matching, estimates, Bambu report parsing, simulated printers
src/main/       Electron main process: Bambu driver (MQTT + FTPS), slicer
                runner, local API, inbox fetcher, saving farm.json
src/preload/    the bridge the window talks through
src/renderer/   the window: Farm, Timeline, Prepare
```

The window talks to the farm only through `window.opf` (see
`src/preload/api.ts`). In a plain browser the same API is provided by a farm of
simulated printers running in the page, which is how `npm run demo` works.

The farm is one JSON file in the app's data folder (`farm.json`), written
atomically.

A new printer brand is one driver implementing `PrinterDriver` in
`src/core/driver.ts`.

## Next

- Run against real Bambu printers (X1C, P1S, A1, H2D) and fix what they
  disagree with
- Keep the models with queued plates, so a plate queued with an estimate can be
  sliced later
- Klipper / Moonraker, PrusaLink and OctoPrint drivers
- Camera view
- Windows installer on a release page, like DATUM's

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE). Bambu Studio and OrcaSlicer are
separate programs under their own licences; OPF runs them, it does not include
them.
