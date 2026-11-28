import { defineConfig } from "@playwright/test";
import chromium, { inflate } from "@sparticuz/chromium";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// Optional bundled Linux NSS libraries for minimal sandboxes without browser deps.
// This affects only the test browser, never the application or its users.
if (process.env.KNOWLM_BUNDLED_LIBS === "1") {
  const require = createRequire(import.meta.url);
  await inflate(
    join(
      dirname(require.resolve("@sparticuz/chromium")),
      "../bin/al2023.tar.br",
    ),
  );
  process.env.LD_LIBRARY_PATH = [
    join(tmpdir(), "al2023/lib"),
    process.env.LD_LIBRARY_PATH,
  ]
    .filter(Boolean)
    .join(":");
}
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.KNOWLM_TEST_URL || "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.KNOWLM_CHROMIUM_PATH || (await chromium.executablePath()),
      args: chromium.args.filter(
        (arg) =>
          arg !== "--disable-web-security" &&
          arg !== "--allow-running-insecure-content",
      ),
    },
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
