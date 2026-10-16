# OPF Slicer

This is OrcaSlicer made into the slicer of OPF (Open Print Farm); the farm itself is in `farm/`, the website in `site/`.
Prepare and Preview are OrcaSlicer's own and are kept close to upstream so its updates can be merged.

## What is different

- **Four tabs: Farm, Timeline, Prepare, Preview.** Farm is the start page. Home, Device,
  Multi-device, Project and Calibration are not on the tab bar: the farm watches and drives the
  printers (`MainFrame::init_tabpanel`, `MainFrame::show_device`). Their pages are still made, so
  code that refers to them keeps working; they are never shown or built.
- **Farm and Timeline** (`src/slic3r/GUI/FarmPanel.*`) show the OPF farm service's web page,
  `http://127.0.0.1:7878/` (or the `opf_farm_url` app config value), with `?embed=farm` or
  `?embed=timeline` so the page shows that one view. When OPF is not answering, the tab starts it
  in the background through the launcher whose location OPF writes to `launcher.json` in its
  settings folder (`%APPDATA%\OPF` on Windows), or, before OPF has written it, the launcher in
  `Documents\opf` run with `node` from the PATH. It says so and keeps retrying.
- **One program**: the slicer writes its own location to `slicer.json` in OPF's settings folder, and
  OPF's desktop icon then starts the farm in the background and opens the slicer. It sets
  `OPF_FARM_STARTING=1` for the slicer, so the Farm tab waits for that farm instead of starting another.
- **Send plate to farm** (`src/slic3r/GUI/OpfFarm.*`) is the print button's default action. It sends the
  current plate, sliced (`.gcode.3mf`, as Export plate sliced file writes it), together with a copy of
  the project to `POST /api/v1/ui/plates`. It goes to the printer chosen in the Farm tab, or OPF
  picks one. **Send all plates** slices every plate that is not sliced yet (Slice all; the plater calls
  `OpfFarm::slicing_finished()` when it is done), then sends them one after another; with no printer
  picked, OPF puts each on the printer free first. The print button offers only these two and the three
  exports: OrcaSlicer's Print and Send go straight to a printer, past the farm.
- **Printers are added once, in the Farm tab.** There is no setup wizard on first run. The farm page sends
  `opf_printers` with each printer's model and profile, and the slicer sets up any printer profile not set
  up yet, with the filaments that printer comes with (`PresetBundle::apply_vendor_config`, as the wizard
  does). The wizard is still in the menu.
- **Sync** (both Sync buttons) reads what is loaded in the printer picked in the Farm tab from the farm
  (`GET /api/v1/ui/printers/<id>/filaments`) and fills the filament list through OrcaSlicer's own matching
  (`Sidebar::sync_ams_list_from_farm`), not Bambu's network.
- **Textured PEI** is the plate type when none was chosen (and once over a saved Smooth Cool Plate).
- **Edit** on a queued plate in the Farm tab downloads that plate's project
  (`GET /api/v1/ui/plates/<id>/project`) and opens it in Prepare. Sending it again replaces the plate
  in its place in the queue.
- **Looks like OPF**: the name people see is OPF (`SLIC3R_APP_FULL_NAME`; `SLIC3R_APP_NAME` and
  `SLIC3R_APP_KEY` stay OrcaSlicer for file formats and profiles). Every translated string goes through
  `I18N::branded()`, which turns "OrcaSlicer" into "OPF" except in credits, links and file names. The
  program is `OPF.exe`, its version info says Open Print Farm and OPF's own version (`OPF_VERSION` in
  `version.inc`; OrcaSlicer's version stays, because profiles and projects are checked against it).
  OrcaSlicer's update check is off: Help > Check for Updates opens OPF's download page. Settings live
  in their own folder, `%APPDATA%\OPF Slicer`, copied once from OrcaSlicer's, so an installed OrcaSlicer
  is not affected. OrcaSlicer's
  logo files keep their names and hold OPF's empty-shelf logo and loading screen; the window, taskbar
  and program icons are the shelf on a white tile, so they show on a dark taskbar. The accent colour
  is Bambu green, `#00AE42`, with its hover, pressed and light shades, in place of OrcaSlicer's
  teal; the swap was made with a script over `src/slic3r`, `resources/images` and `resources/web`,
  so after merging OrcaSlicer, new teal can be swapped the same way. The About box keeps the credit
  to OrcaSlicer, PrusaSlicer and BambuStudio that their licence asks for.
- **One window, no save questions**: `single_instance` is on (turned on once in `AppConfig::load()`,
  over a saved "false"; marker `opf_single_instance` = 2), and
  `save_project_choise` defaults to "no", so a new or another project never asks to save the open
  one. Add plate and Edit from the Farm tab start from a clean project without asking.
- **Windows build** (`.github/workflows/opf_windows.yml`): Windows x64 only, on every change to `main`.
  It first packs the farm (`farm/`, `npm run pack:win`) into `opf-farm/`, which the install step
  puts in `farm\` next to `OPF.exe`: one installer, `OPF_Setup_<version>_x64.exe`, for the whole of OPF.
  The installer and the portable folder are attached to each run under **Actions**; releases go on
  Artis-98/opf. The Farm tab starts `farm\OPF-Farm.exe` when no farm answers, unless OPF's
  `launcher.json` points at a copy run from git.

## The farm page and the slicer

The page talks to the slicer with `window.wx.postMessage(JSON.stringify(message))`:

| `command`        | Fields                         | What the slicer does                                    |
|------------------|--------------------------------|---------------------------------------------------------|
| `opf_target`     | `printer`, `name`              | Send to farm goes to this printer; the button names it. |
| `opf_new_plate`  | `printer`, `name`, `machine`   | New project in Prepare, with that printer profile.      |
| `opf_edit_plate` | `job`, `name`, `plate`         | Opens the plate's project in Prepare.                   |
| `opf_printers`   | `machines`: `[{model, preset}]` | Sets up printer profiles not set up yet.               |
| `opf_online`     | `printers`: `[{id, name, model}]` | With none picked, the only printer online of the profile's model is the target. |

After a plate is sent the slicer shows the Farm tab and calls `window.opfShowJob(<job id>)`; after Send all
plates it also calls `window.opfToast(<text>)` with how many plates went where.

## Keeping up with OrcaSlicer

```bash
git remote add upstream https://github.com/OrcaSlicer/OrcaSlicer
git fetch upstream main
git merge upstream/main
```

OPF's changes are kept small and marked `// OPF:` so merges stay easy.
