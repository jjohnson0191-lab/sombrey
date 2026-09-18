import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// Sombrey mobile app — a new Vite project, independent of the legacy
// root vite.config.ts. Does NOT use @usehercules/vite.
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5174,
    allowedHosts: true,
    // convex/ lives at the monorepo root, a sibling of apps/, not inside
    // apps/mobile — Vite's default fs restriction would otherwise block it.
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The canonical Sombrey backend stays at the repo root (convex/) —
      // see Phase 1/2 reports for why it isn't duplicated per-app.
      "@convex": path.resolve(__dirname, "../../convex"),
    },
  },
});
