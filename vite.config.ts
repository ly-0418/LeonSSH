import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration tailored for a Tauri desktop app.
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],

  // Do not let Vite wipe the console: Rust compile errors must stay visible.
  clearScreen: false,

  server: {
    // Tauri expects a fixed dev-server port and fails loudly if it is taken.
    port: 1420,
    strictPort: true,
    watch: {
      // Rust sources are watched by cargo, not Vite.
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // WebView2 on Windows 10/11 tracks modern Chromium.
    target: "chrome120",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },

  envPrefix: ["VITE_", "TAURI_ENV_"],
});
