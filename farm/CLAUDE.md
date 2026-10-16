# OPF — notes for working on this repository

## Commands

- `npm test` — vitest, all of `src/**/*.test.ts`
- `npm run typecheck` — both TypeScript projects (main/core and renderer)
- `npm run build` — Electron bundle into `out/`
- `npm run demo` / `npm run build:demo` — the renderer alone in a browser with simulated printers

Run tests and typecheck before every commit.

## Layout and rules

- `src/core` must not import Electron or Node-only modules (except in tests); it runs in the browser demo too.
- Everything the window can do goes through `FarmService.act(name, args)`; add new actions to `ACTIONS` in `src/core/farm.ts`.
- Printer brands are drivers implementing `PrinterDriver` (`src/core/driver.ts`): Bambu Lab
  (`src/main/drivers/bambu.ts`) and Anycubic Kobra 3 / S1 in LAN mode (`anycubic.ts`, reports
  read in `src/core/anycubic-report.ts`). The Anycubic print start is checked on a Kobra X by
  others but not yet on the owner's Kobra 3 Max.
- The scheduler follows the same rules as iiteg-admin-hub's `src/lib/schedule.ts`; keep them in step.
- UI text is plain and from the operator's side ("Clear the bed", not "Acknowledge job completion").

## How the owner runs OPF, and what that means for every push

The owner runs OPF on their Windows PC straight from `main`, through
`OPF.bat` → `scripts/launch.cjs` (git pull, npm install when the lockfile
changed, build, open). An open OPF checks GitHub every 3 minutes and offers
"Update ready · Restart". So:

- Everything pushed to `main` reaches their PC within minutes. Run
  `npm run typecheck` and `npm test` before every push, and a quick run of
  the app for UI changes.
- The subject and first paragraph of each commit message are shown to them
  in OPF's "What's new" dialog. Write them for the person using OPF, in plain
  words about what changed for them, not about the code.
- Their farm lives in `%APPDATA%\opf\farm.json` with real printers in it.
  Changes to `FarmData` must keep reading older files (`normalise()` in
  `src/core/farm.ts`).
- They test on simulated A1 / A1 mini printers (Settings → Test printers).

## Installed copies (from 0.2.0)

OPF is also shipped as one Windows installer: OPF Slicer with this farm inside it. The slicer's
Windows build checks out this repository, runs `npm run pack:win` (electron-builder, folder only)
and installs `release/win-unpacked` as `farm\` next to `OPF.exe`; the farm program is
`farm\OPF-Farm.exe`. When the Farm tab finds no farm it starts that one with `--background`, unless
`launcher.json` points at a git copy (the owner's PC). An installed farm (`app.isPackaged`) does not
pull from git: it asks GitHub for the latest release of Artis-98/opf every few hours and offers the
download page (`DOWNLOAD_PAGE` in `src/main/updater.ts`: opf.iiteg.com, the site in `site/`). Its settings folder
is the same `%APPDATA%\OPF`. Keep `package.json`'s `version` in step with the release tag.

## OPF Slicer (Artis-98/opf-slicer)

The OrcaSlicer fork the owner uses: tabs Farm, Timeline, Prepare, Preview. Farm
and Timeline load this web page with `?embed=farm|timeline&theme=dark|light`;
the page then hides OPF's own tabs and talks to the slicer with
`window.wx.postMessage` (`toSlicer()` in `src/renderer/src/bridge.ts`; the
messages are listed in the fork's `OPF.md`). Send to farm posts to
`/api/v1/ui/plates`, Edit fetches `/api/v1/ui/plates/<id>/project`. When the farm
does not answer, the slicer runs `launch.cjs --background` through
`launcher.json` (in OPF's settings folder): Electron with no window and a tray
icon, and closing a window opened later keeps it running. The slicer writes
`slicer.json` there too, and from then on OPF.bat (the desktop icon) starts the
farm in the background and opens the slicer instead of OPF's window
(`--window` for the window). The tray icon is always there while OPF runs
(`src/main/mini.ts`): a popup (`?mini=1`, `views/Mini.tsx`), notifications from
`farmNews()` in `src/core/status.ts`, and a login item so it starts with
Windows. Changing these
messages or endpoints needs the fork changed too, and a slicer build takes about
an hour, so keep them backward compatible.

## OrcaSlicer

The plan (owner's choice, Oct 2026) is an OrcaSlicer fork with OPF's farm as a
tab. Until then, OPF speaks enough OctoPrint (`/api/version`,
`/api/files/local`, also under `/octo/<printer id>/`) that stock OrcaSlicer
sends plates into OPF and shows the farm page in its Device tab; see
`src/main/api.ts`. Learned from OrcaSlicer 2.4.2 itself (Linux AppImage from
its GitHub releases, run under `xvfb-run`, needs libopengl0 + libglu1-mesa):

- `--export-3mf` takes a file name inside `--outputdir`, not a path.
- The command line accepts the built-in system presets directly
  (`resources/profiles/BBL/{machine,process,filament}/*.json`, with `inherits`).
- `slice_info.config` from the command line may have an empty `weight` and
  `used_g="0.00"`; OPF works grams out from `used_m`.

## Running the real Electron app in a cloud session

`ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install` skips the binary; `node node_modules/electron/install.js` fetches it.
Then drive it under `xvfb-run` with Playwright's `_electron.launch` and `--no-sandbox --user-data-dir=<tmp>`.

## Setting up a new repository from a Claude session

The session's GitHub access cannot create repositories: the GitHub connector's
create call returns 403, and `gh repo create` is refused by the session proxy
("sessions are bound to their configured repositories"). What works:

1. The owner creates an empty repository at https://github.com/new (no README, licence or .gitignore).
2. If the Claude GitHub App only has access to selected repositories, add the new one at
   https://github.com/apps/claude/installations/select_target.
3. In the session, attach it with `add_repo` (access: push), clone it, and push.

This is how OPF (Artis-98/opf) was set up on 14 Oct 2026.
