import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backendOrigin = process.env["BACKEND_ORIGIN"] ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Forward the browser IP through the one trusted Vite hop. `changeOrigin`
      // rewrites Host but preserves Origin for the WebSocket allow-list.
      "/api": {
        changeOrigin: true,
        target: backendOrigin,
        ws: true,
        xfwd: true,
      },
      "/health": {
        changeOrigin: true,
        target: backendOrigin,
        xfwd: true,
      },
    },
    strictPort: true,
  },
});
