import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Two entries: the interactive studio (index.html) and the minimal
  // deterministic render page (render.html) that Playwright drives.
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        studio: resolve(__dirname, "index.html"),
        render: resolve(__dirname, "render.html"),
      },
    },
  },
  server: {
    port: 5173,
    // The Node backend (renderer/server.js) owns /api and the sample files.
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/samples": "http://127.0.0.1:8787",
    },
  },
});
