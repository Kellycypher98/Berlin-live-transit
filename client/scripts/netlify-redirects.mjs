// Netlify build step: writes dist/_redirects so the static app can reach the Node server.
//   /api/*  -> proxied to BACKEND_URL (same origin for the browser, so no CORS needed)
//   /*      -> index.html (the app and /admin are client-side pages)
// The live WebSocket can't go through Netlify; the app connects to BACKEND_URL directly (see vite.config.ts).
import { writeFileSync } from "node:fs";

const backend = (process.env.BACKEND_URL ?? "").replace(/\/+$/, "");
if (!/^https:\/\/[^/]+$/.test(backend)) {
  console.error("BACKEND_URL must be set to the server's https address, e.g. https://3-121-45-67.sslip.io");
  process.exit(1);
}
writeFileSync(new URL("../dist/_redirects", import.meta.url), [
  `/api/*  ${backend}/api/:splat  200`,
  `/health  ${backend}/health  200`,
  `/*  /index.html  200`,
  "",
].join("\n"));
console.log(`_redirects written: /api -> ${backend}`);
