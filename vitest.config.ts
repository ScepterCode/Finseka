import path from "node:path";
import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so unit tests don't load the app's server build plugins.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
