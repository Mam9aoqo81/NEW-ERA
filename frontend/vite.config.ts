import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Only the dev server calls this internal address; browser requests stay same-origin.
const proxy = {
  "/v1": "http://127.0.0.1:8000",
  "/health": "http://127.0.0.1:8000",
};
export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", allowedHosts: [".e2b.app"], proxy },
  preview: { host: "0.0.0.0", allowedHosts: [".e2b.app"], proxy },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
