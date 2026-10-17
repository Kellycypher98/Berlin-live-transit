import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, Vite serves the React app on :5173 and forwards data calls to the Node server on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/live": { target: "ws://127.0.0.1:3000", ws: true },
      "/api": "http://127.0.0.1:3000",
    },
  },
});
