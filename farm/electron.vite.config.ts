import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

// The packages the main process loads, built in so a small farm update can tell whether it fits.
const { depsFingerprint } = createRequire(import.meta.url)("./scripts/deps-fingerprint.cjs");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __OPF_DEPS__: JSON.stringify(depsFingerprint()) },
    // boot: the first file, which starts a downloaded farm update or index (scripts in package.json "main").
    // index: the desktop app. server: the same farm without a window (npm run server).
    build: { rollupOptions: { input: { boot: "src/main/boot.ts", index: "src/main/index.ts", server: "src/server/index.ts" } } },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()], define: { __OPF_DEMO__: "false" } },
});
