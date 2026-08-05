import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backendOrigin = process.env["BACKEND_ORIGIN"] ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // `xfwd` appends this connection's remote address to `x-forwarded-for`,
      // which is what lets the backend recover the real client IP for
      // rate-limiting instead of seeing every browser as this container. The
      // backend trusts exactly this one hop; see `TRUST_PROXY_HOPS`.
      // `ws` also proxies the WebSocket upgrade at /api/ws. `changeOrigin`
      // rewrites Host but leaves Origin alone, so the backend still checks the
      // browser's real origin against its allow-list.
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
