import { defineConfig } from "vite";

// The new app is served under /next/ on GitHub Pages while the current viewer stays at the root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  build: { target: "es2023", sourcemap: true, chunkSizeWarningLimit: 1500 },
  server: { host: "127.0.0.1", port: 5173 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
}));
