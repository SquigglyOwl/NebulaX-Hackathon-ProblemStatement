import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Quick Cloudflare Tunnel URLs change each run and aren't known ahead of
    // time; Vite's Host-header check would otherwise 403 them. Fine for a
    // hackathon dev tunnel — do not carry this into a production build.
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
