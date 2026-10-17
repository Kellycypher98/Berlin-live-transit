import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope"; // self-hosted: no requests to Google Fonts
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { App } from "./App";

// The admin dashboard is a separate page at /admin, loaded only when opened
const AdminPage = lazy(() => import("./admin/AdminPage").then(m => ({ default: m.AdminPage })));
const isAdmin = location.pathname.replace(/\/+$/, "") === "/admin";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isAdmin ? <Suspense fallback={null}><AdminPage /></Suspense> : <App />}
  </StrictMode>,
);
