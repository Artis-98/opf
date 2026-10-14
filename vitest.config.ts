import { defineConfig } from "vitest/config";

export default defineConfig({ define: { __OPF_DEMO__: "true" }, test: { include: ["src/**/*.test.ts"] } });
