# OPF Slicer

This is OrcaSlicer made into the slicer of [OPF (Open Print Farm)](https://github.com/Artis-98/opf).
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
- **Send to farm** (`src/slic3r/GUI/OpfFarm.*`) is the print button's default action. It sends the
  current plate, sliced (`.gcode.3mf`, as Export plate sliced file writes it), together with a copy of
  the project to `POST /api/v1/ui/plates`. It goes to the printer chosen in the Farm tab, or OPF
  picks one.
- **Edit** on a queued plate in the Farm tab downloads that plate's project
  (`GET /api/v1/ui/plates/<id>/project`) and opens it in Prepare. Sending it again replaces the plate
  in its place in the queue.
- **Looks like OPF**: the name people see is OPF (`SLIC3R_APP_FULL_NAME`; `SLIC3R_APP_NAME` and
  `SLIC3R_APP_KEY` stay OrcaSlicer, so settings, presets and files are where they were). OrcaSlicer's
  logo files keep their names and hold OPF's empty-shelf logo and loading screen. The accent colour
  is Bambu green, `#00AE42`, with its hover, pressed and light shades, in place of OrcaSlicer's
  teal; the swap was made with a script over `src/slic3r`, `resources/images` and `resources/web`,
  so after merging OrcaSlicer, new teal can be swapped the same way. The About box keeps the credit
  to OrcaSlicer, PrusaSlicer and BambuStudio that their licence asks for.
- **One window, no save questions**: `single_instance` is on (once, over a saved "false"), and
  `save_project_choise` defaults to "no", so a new or another project never asks to save the open
  one. Add plate and Edit from the Farm tab start from a clean project without asking.
- **Windows build** (`.github/workflows/opf_windows.yml`): Windows x64 only, on every change to `main`.
  The installer and the portable folder are attached to each run under **Actions**.

## The farm page and the slicer

The page talks to the slicer with `window.wx.postMessage(JSON.stringify(message))`:

| `command`        | Fields                         | What the slicer does                                    |
|------------------|--------------------------------|---------------------------------------------------------|
| `opf_target`     | `printer`, `name`              | Send to farm goes to this printer; the button names it. |
| `opf_new_plate`  | `printer`, `name`, `machine`   | New project in Prepare, with that printer profile.      |
| `opf_edit_plate` | `job`, `name`, `plate`         | Opens the plate's project in Prepare.                   |

After a plate is sent the slicer shows the Farm tab and calls `window.opfShowJob(<job id>)`.

## Keeping up with OrcaSlicer

```bash
git remote add upstream https://github.com/OrcaSlicer/OrcaSlicer
git fetch upstream main
git merge upstream/main
```

OPF's changes are kept small and marked `// OPF:` so merges stay easy.
