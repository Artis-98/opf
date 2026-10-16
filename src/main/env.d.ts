// electron-vite copies a file imported with ?asset next to the build and gives its path.
declare module "*?asset" {
  const path: string;
  export default path;
}
