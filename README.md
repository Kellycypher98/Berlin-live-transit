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

## Structure

```
server.js              merges all sources -> positions, pushed over /live; serves client/dist
client/
  src/App.tsx          map + state
  src/VehicleLayer.tsx Leaflet markers, smooth movement between updates
  src/ControlPanel.tsx mode toggles, counts, connection status
  src/useLiveVehicles.ts  WebSocket hook with reconnect
  src/modes.ts         transport modes and colors
lib/
  timetable.js         downloads + indexes the GTFS timetable
  realtime.js          reads GTFS-Realtime delays
  radar.js             live positions per area, with fallback tracking
  shapes.js            track geometry: stops along shapes, position + heading on a track
  lines.js             network map (one deduplicated path set per line)
  places.js            address / place search (VBB, then Photon) and reverse lookup
  walk.js              street walking routes (OSRM foot, OpenStreetMap) with fallback
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

- The timetable (~60–100 MB) downloads into `data/` on first start, gets indexed (a minute or two)
  and cached, so restarts take about a second. Re-downloaded every 3 days.
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
| `CONTACT`     | your email or URL, sent in the User-Agent (VBB asks for this and blocks generic clients) |

Data: © VBB Verkehrsverbund Berlin-Brandenburg GmbH, CC-BY-4.0.
