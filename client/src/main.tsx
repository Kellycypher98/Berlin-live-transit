import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope"; // self-hosted: no requests to Google Fonts
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { App } from "./App";
import "./hooks/useInstall"; // starts listening for the browser's install prompt right away

// The admin dashboard is a separate page at /admin, loaded only when opened
const AdminPage = lazy(() => import("./admin/AdminPage").then(m => ({ default: m.AdminPage })));
const isAdmin = location.pathname.replace(/\/+$/, "") === "/admin";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isAdmin ? <Suspense fallback={null}><AdminPage /></Suspense> : <App />}
  </StrictMode>,
);

// Service worker (only in the built app): needed for "Install app" in Chrome / Android
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
