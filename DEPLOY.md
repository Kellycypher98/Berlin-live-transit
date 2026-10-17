# Deploying: app on Netlify, server on Render

Netlify only hosts static sites, and this app also needs a server that runs all the time: it keeps the
VBB timetable in memory, polls the live feeds and pushes vehicles over a WebSocket. So it's split:

| Part | Where | What |
|------|-------|------|
| React app | **Netlify** | the map, search, `/admin` page |
| Node server | **Render** (or any container host) | live data, journeys, tracking, WebSocket |

Netlify forwards `/api/*` to the server, so the browser only ever talks to your Netlify address –
except the live WebSocket, which Netlify can't forward, so the app connects to the server for that directly.

## 1. Push the code to GitHub

```bash
git add -A && git commit -m "Deploy setup" && git push
```

## 2. Server on Render

1. Sign in at render.com with GitHub → **New → Blueprint** → pick `Berlin-live-transit`.
   It reads `render.yaml` and creates the service `berlin-live-api` from the `Dockerfile`.
2. When asked, set `CONTACT` to your email (VBB asks for it). `ADMIN_TOKEN` is generated for you;
   find it later under the service → **Environment**.
3. Wait for the first deploy, then open `https://<your-service>.onrender.com/health`. It returns JSON
   once it's running (the timetable takes a minute or two to load the first time).
4. Copy that address: it's your `BACKEND_URL`.

Free plan notes:
- The server sleeps after 15 minutes without visitors; the next visitor waits about a minute for it to wake,
  plus the timetable loading again (the free plan has no lasting disk). The app shows its loading screen meanwhile.
- If it restarts while building the timetable, it's out of memory: switch the service to a paid plan with
  at least 1 GB, or run the same `Dockerfile` on AWS Lightsail.

## 3. App on Netlify

1. app.netlify.com → **Add new site → Import an existing project** → GitHub → `Berlin-live-transit`.
   Netlify reads `netlify.toml` (base `client`, publish `dist`) – leave the build settings as they are.
2. **Site configuration → Environment variables → Add**: `BACKEND_URL` = `https://<your-service>.onrender.com`
   (no trailing slash).
3. **Deploys → Trigger deploy**. The build stops with a clear message if `BACKEND_URL` is missing.
4. Open your `*.netlify.app` address. Admin dashboard: `/admin`, signed in with the `ADMIN_TOKEN` from Render.

## 4. Your own domain (later)

Netlify → **Domain management → Add a domain** you bought (any registrar). Netlify gives the DNS records
to add and sets up HTTPS. The server can stay on its `onrender.com` address; visitors never see it.

## Before real traffic

- Map tiles: move from openstreetmap.org tiles to a keyed provider (MapTiler, Stadia) – OSM's servers
  aren't meant for public apps with real traffic.
- If you change the server's address, update `BACKEND_URL` on Netlify and redeploy.
