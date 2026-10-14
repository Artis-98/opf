# OPF Slicer

This is OrcaSlicer with a **Farm** tab, made for [OPF (Open Print Farm)](https://github.com/Artis-98/opf).
Everything else is OrcaSlicer, kept close to upstream so its updates can be merged.

## What is different

- **Farm tab** (`src/slic3r/GUI/FarmPanel.*`, added in `MainFrame::init_tabpanel`): shows the OPF farm
  service running on this computer, `http://127.0.0.1:7878/` (or the `opf_farm_url` app config
  value). While OPF is not running it says so and keeps trying.
- **Windows build** (`.github/workflows/opf_windows.yml`): Windows x64 only, on every change to `main`.
  The installer and the portable folder are attached to each run under **Actions**.

## Sending plates to the farm

OPF answers like an OctoPrint print host. In a printer's connection settings choose OctoPrint and use
the address OPF shows in that printer's settings (`http://127.0.0.1:7878/octo/<printer id>`). For a
Bambu Lab printer, tick "Use 3rd-party print host" in the printer settings first.

## Keeping up with OrcaSlicer

```bash
git remote add upstream https://github.com/OrcaSlicer/OrcaSlicer
git fetch upstream main
git merge upstream/main
```

OPF's changes are kept small and marked `// OPF:` so merges stay easy.
