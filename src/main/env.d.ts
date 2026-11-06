// electron-vite copies a file imported with ?asset next to the build and gives its path.
declare module "*?asset" {
  const path: string;
  export default path;
}

/** The packages the main process was built with (scripts/deps-fingerprint.cjs), set by electron.vite.config.ts. */
declare const __OPF_DEPS__: string;
