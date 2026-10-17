# Berlin Live Transit

Live map of Berlin's U-Bahn, S-Bahn, trams, buses, regional trains and ferries.
React + TypeScript (Vite) frontend, Node WebSocket backend.

## Run

```bash
npm install          # installs server + client
CONTACT=you@example.com npm run dev   # server on :3000, React dev server on :5173
# open http://localhost:5173
```

Production:

```bash
npm run build        # builds client/dist
npm start            # serves the app + live data on http://localhost:3000
```

Requires Node 18+.

## Features

- Live map of trains, trams, buses and ferries (see *How it works* for the data sources)
- **Line map**: U-Bahn, S-Bahn, tram, regional and ferry lines drawn along their real track
  in official colours (toggle "Line map"; follows the mode toggles).
- **Live tracking**: from any connection, "Track this journey live" (or one ride) highlights
  your vehicle on the map, follows it, and shows when it reaches your stop, how many stops
  are left, delays, and when to get off. Moves on to the next ride after each change.
  Position: live (community API, matched by trip or same line + direction nearby), else
  timetable + live delay, else timetable; trips we can't find fall back to the community API.
- **Stations**: rail stations from zoom 12, tram stops from 14, bus stops from 15.
  Click one for its lines and next departures (timetable + live delays).
- **Journey search from anywhere to anywhere**: addresses, places and stations, your exact location,
  or right-click / long-press the map ("Route from here / to here"). Addresses come from VBB's
  location search, with Photon (OpenStreetMap) as the fallback. Journeys include the walk to the first
  stop and from the last one (distance + minutes), along real streets when the OpenStreetMap walking
  router answers, otherwise as a straight-line estimate. Short trips also offer "Walk all the way".
  Leave now, depart at or arrive by any time (date + time), with Earlier / Later paging.
  Up to 3 connections with lines, changes and the stops along the way, drawn on the map.
  Uses the community journey planner first (it knows live delays); if that's down,
  a local planner answers from the official timetable (Connection Scan Algorithm,
  forwards for "depart at", backwards for "arrive by"). The local timetable covers today
  and tomorrow; further ahead needs the live planner.

## Hosting

App on Netlify, server on AWS Lightsail (Docker + Caddy, files in `deploy/`): see [DEPLOY.md](DEPLOY.md).

## Languages

English and German. The app picks German when the browser prefers it; switch any time at the bottom of
the layers panel (remembered per browser). Texts are written in English in the code and translated in
`client/src/i18n/de.ts` (missing ones fall back to English and are logged in dev). To add a language,
copy `de.ts`, translate it, and register it in `client/src/i18n/index.ts`.

## Admin dashboard

Open `/admin` (e.g. http://localhost:5173/admin in dev) for a small dashboard: people online and
visitors today, vehicles by source and type over the last hour, the state of each data source,
journey/tracking/search counts, API response times and errors, and recent server warnings.

- Locally it just works (only from this computer).
- On a server, set `ADMIN_TOKEN` to a long random secret (`openssl rand -hex 24`) and sign in with it.
  Without `ADMIN_TOKEN` the dashboard refuses every remote request. 5 wrong tokens lock that IP out for 10 min.
- Stats live in memory only and reset on restart. Visitors are counted by a salted hash, no IPs are stored.

## Structure

```
server.js              merges all sources -> positions, pushed over /live; serves client/dist
client/src/
  App.tsx              map + app state
  components/
    map/               map layers: vehicles, stations, line map, journey, tracked vehicle, map picker
    search/            search panel, place input, time picker
    journeys/          connection results
    stations/          station card (departures)
    tracking/          live tracking panel
    nearby/            "Stations near me": list, map blips, back-to-me button
    layout/            layers panel, loading screen
    icons/             mode badges and place icons
  hooks/               live vehicles (WebSocket), stations, lines, tracking, my location
  lib/                 API client + types, line colours, modes, station search, nearby maths
  i18n/                translations (English in the code, German in de.ts)
  admin/               admin dashboard (/admin), loaded only when opened
  assets/              logo
lib/
  timetable.js         downloads + indexes the GTFS timetable
  realtime.js          reads GTFS-Realtime delays
  radar.js             live positions per area, with fallback tracking
  shapes.js            track geometry: stops along shapes, position + heading on a track
  lines.js             network map (one deduplicated path set per line)
  places.js            address / place search (VBB, then Photon) and reverse lookup
  walk.js              street walking routes (OSRM foot, OpenStreetMap) with fallback
  stats.js             in-memory stats + access check for the admin dashboard
  tracking.js          live tracking of one trip; links community journey legs to the timetable
  journeys.js          journey planning (community API + local fallback), departures
  positions.js         timetable + delays -> vehicle positions
  berlinTime.js        Berlin service-day time helpers
```

## How it works

Three VBB sources, used per area of the map (Berlin is split into 16 areas), best first:

1. **Live positions** — community API `v6.vbb.transport.rest/radar`, polled every 20 s.
   Each area falls back on its own when it times out; when the whole API is down,
   polling backs off (up to 5 min) to stay polite.
2. **Timetable + live delays** — official VBB GTFS timetable (CC-BY-4.0), moved by delays
   from the official GTFS-Realtime feed (polled every 30 s). Cancelled trips are hidden.
3. **Timetable only** — when both live feeds are down.

- The timetable (~80 MB) downloads into `data/` on first start, gets indexed (about half a minute) and cached
  in a compact binary file (~45 MB), so restarts take well under a second. Re-downloaded every 3 days.
  Memory: ~600 MB peak while indexing, ~400 MB while running. Of yesterday's trips only the late ones are kept.
- Live positions can show up before the timetable has finished loading.
- Timetable-based vehicles move along the real track (GTFS shapes): each trip's stops are
  projected onto its shape once, then positions are interpolated along it. Trips without a
  usable shape fall back to straight lines between stops.
- Every 10 s the server merges everything and pushes it over a compressed WebSocket at `/live`.
- Vehicles show as dots when zoomed out, mode badges (U, S, tram, bus, RE, ferry) with a
  direction arrow from zoom 12, and line labels ("U2", "M10") from zoom 15.
  Live positions are solid; timetable estimates are slightly faded.
- `GET /api/vehicles` returns the same snapshot as JSON; `GET /health` reports every source's status.
- `GET /api/places?q=`, `GET /api/reverse?lat=&lng=`, `GET /api/lines`, `GET /api/stations`, `GET /api/stations/:i/departures`, `GET /api/journeys?from=:station|fromLat=&fromLng=&fromName=…&to=…[&mode=depart|arrive][&when=ISO]`,
  `GET /api/track?trip=:id&day=:d[&hafas=:id]`.

## Config

| Env var       | Default                                          |
|---------------|--------------------------------------------------|
| `PORT`        | `3000`                                           |
| `GTFS_URL`    | VBB GTFS zip (unternehmen.vbb.de, CC-BY-4.0)     |
| `GTFS_RT_URL` | `https://production.gtfsrt.vbb.de/data`          |
| `COMMUNITY_API` | `https://v6.vbb.transport.rest` (positions + journeys) |
| `RADAR_URL`   | `$COMMUNITY_API/radar`                           |
| `RADAR`       | set to `off` to use only the official feeds      |
| `PHOTON_URL`  | `https://photon.komoot.io` (address search fallback) |
| `WALK_ROUTER_URL` | `https://routing.openstreetmap.de/routed-foot` (walking routes) |
| `TRUST_PROXY` | set to `1` behind a proxy (Caddy, Render, Fly) so visitor counts use real addresses |
| `ADMIN_TOKEN` | unset = admin dashboard only from localhost |
| `CONTACT`     | your email or URL, sent in the User-Agent (VBB asks for this and blocks generic clients) |

Data: © VBB Verkehrsverbund Berlin-Brandenburg GmbH, CC-BY-4.0.
