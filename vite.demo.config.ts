import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The renderer on its own, in a browser, with simulated printers. No Electron needed.
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  build: { outDir: "../../dist-demo", emptyOutDir: true },
  server: { port: 5199 },
});
