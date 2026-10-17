import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, Vite serves the React app on :5173 and forwards data calls to the Node server on :3000.
// BACKEND_URL (e.g. https://berlin-live-api.onrender.com) is only needed when the app is hosted apart from
// the server, like on Netlify: the live WebSocket then connects there directly. Empty = same host.
// (typed here so the build doesn't need @types/node)
declare const process: { env: Record<string, string | undefined> };
const BACKEND_URL = (process.env.BACKEND_URL ?? "").replace(/\/+$/, "");

export default defineConfig({
  plugins: [react()],
  define: { __BACKEND_URL__: JSON.stringify(BACKEND_URL) },
  server: {
    proxy: {
      "/live": { target: "ws://127.0.0.1:3000", ws: true },
      "/api": "http://127.0.0.1:3000",
    },
  },
});
