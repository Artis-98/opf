import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // index: the desktop app. server: the same farm without a window (npm run server).
    build: { rollupOptions: { input: { index: "src/main/index.ts", server: "src/server/index.ts" } } },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()], define: { __OPF_DEMO__: "false" } },
});
