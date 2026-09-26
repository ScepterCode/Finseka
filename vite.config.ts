import path from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

// Build output: on Vercel, Nitro detects Vercel and writes .vercel/output; elsewhere it
// builds a plain Node server in .output (run it with `node .output/server/index.mjs`).
export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tanstackStart({
      // src/server.ts wraps the app's server: error page and security headers.
      server: { entry: "server" },
      // Code in server/ folders or marked "server-only" must never reach the browser.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    command === "build" && nitro(),
    viteReact(),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    tsconfigPaths: true,
    // One copy of React and TanStack Query, even if a dependency brings its own.
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
}));
