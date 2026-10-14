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
- Printer brands are drivers implementing `PrinterDriver` (`src/core/driver.ts`).
- The scheduler follows the same rules as iiteg-admin-hub's `src/lib/schedule.ts`; keep them in step.
- UI text is plain and from the operator's side ("Clear the bed", not "Acknowledge job completion").

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
