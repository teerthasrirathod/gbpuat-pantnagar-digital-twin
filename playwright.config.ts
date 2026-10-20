import { defineConfig } from "@playwright/test";

// End-to-end checks run the production build in a real browser. CI has no GPU, so the app is opened on its WebGL2
// backend (software rendering); locally set PW_CHANNEL=chrome to use an installed Chrome instead of Playwright's.
export default defineConfig({
  testDir: "e2e",
  timeout: 900_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 640, height: 360 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    command: "npm run build && npm run preview -w @gbpuat/web -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
