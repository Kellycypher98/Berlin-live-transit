import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, ZoomControl } from "react-leaflet";
import { useLiveVehicles } from "./hooks/useLiveVehicles";
import { useStations } from "./hooks/useStations";
import { VehicleLayer } from "./components/map/VehicleLayer";
import { StationsLayer } from "./components/map/StationsLayer";
import { LinesLayer } from "./components/map/LinesLayer";
import { useLines } from "./hooks/useLines";
import { JourneyLayer, FlyTo } from "./components/map/JourneyLayer";
import { ControlPanel } from "./components/layout/ControlPanel";
import { SearchPanel } from "./components/search/SearchPanel";
import { MODES, modeOf, type ModeKey } from "./lib/modes";
import { fetchJourneys, placeKey, type JourneyResult, type Place, type Station } from "./lib/api";
import { MapPicker, PlacePins, FocusMode } from "./components/map/MapPicker";
import { choiceToIso, defaultChoice, type TimeChoice } from "./components/search/TimePicker";
import { useTracking, type Tracking } from "./hooks/useTracking";
import { TrackedVehicle } from "./components/map/TrackedVehicle";
import { LoadingScreen } from "./components/layout/LoadingScreen";
import { LocateButton } from "./components/nearby/LocateButton";
import { NearbyLayer } from "./components/nearby/NearbyLayer";
import { nearestStations } from "./lib/nearby";
import { useMyLocation } from "./hooks/useMyLocation";
import { t, useLang } from "./i18n";

const BERLIN_CENTER: [number, number] = [52.5163, 13.3777];

export function App() {
  useLang(); // re-render everything when the language changes
  const { snapshot, state } = useLiveVehicles();
  const { stations, searchIndex, error: stationsError } = useStations();
  const mapLines = useLines();
  const [showLines, setShowLines] = useState(true);
  const [enabled, setEnabled] = useState<Set<ModeKey>>(
    () => new Set(MODES.filter(m => m.defaultOn).map(m => m.key)),
  );

  // Journey search
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const fromKey = placeKey(from), toKey = placeKey(to);
  const [result, setResult] = useState<JourneyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  // Refresh: run the same search again for fresh connections, keeping the old results on screen meanwhile
  const [refreshKey, setRefreshKey] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const lastSearch = useRef("");
  const [timeChoice, setTimeChoice] = useState<TimeChoice>(() => defaultChoice());
  // "Earlier" / "Later" page through results without changing the user's chosen time
  const [page, setPage] = useState<{ mode: "depart" | "arrive"; when: string } | null>(null);
  // Live tracking of a journey from the results
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [follow, setFollow] = useState(true);
  const tracked = useTracking(tracking);
  useEffect(() => setTracking(null), [fromKey, toKey]);
  const startTracking = (journeyIndex: number, leg: number | null) => {
    const j = result?.journeys[journeyIndex];
    if (!j) return;
    setSelected(journeyIndex); setStation(null); setFollow(true);
    setTracking({ journey: j, leg });
  };
  useEffect(() => setPage(null), [fromKey, toKey, timeChoice]);
  const query = page ?? { mode: timeChoice.mode === "arrive" ? "arrive" as const : "depart" as const, when: choiceToIso(timeChoice) };

  // Station picked on the map or from a search
  const [station, setStation] = useState<Station | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; key: number } | null>(null);

  useEffect(() => {
    const searchKey = `${fromKey}|${toKey}|${query.mode}|${query.when}`;
    const isRefresh = searchKey === lastSearch.current && result !== null;
    lastSearch.current = searchKey;
    setError(null);
    if (!isRefresh) { setResult(null); setSelected(0); }
    if (!from || !to) return;
    if (fromKey === toKey) { setError(t("Start and destination are the same place.")); return; }
    if (!isRefresh) setStation(null);
    const ctrl = new AbortController();
    setLoading(true);
    // Short delay so typing a time doesn't fire a search per keystroke
    const timer = setTimeout(() => {
      fetchJourneys(from, to, query, ctrl.signal)
        .then(r => {
          if (ctrl.signal.aborted) return;
          setResult(r); setFetchedAt(Date.now());
          if (isRefresh) setSelected(k => Math.min(k, Math.max(0, r.journeys.length - 1)));
        })
        .catch(e => { if (!ctrl.signal.aborted) setError(isRefresh ? t("Couldn't refresh: {message}", { message: e.message }) : e.message); })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, isRefresh ? 0 : 250);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [fromKey, toKey, query.mode, query.when, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => setRefreshKey(k => k + 1);
  // Right-click / long-press on the map: the second call (with the street name) only renames the same spot
  const onMapPick = useCallback((end: "from" | "to", p: Place) => {
    setStation(null);
    (end === "from" ? setFrom : setTo)(p);
  }, []);

  const earlier = () => {
    const first = result?.journeys[0];
    if (first) setPage({ mode: "arrive", when: new Date(Date.parse(first.arr) - 60000).toISOString() });
  };
  const later = () => {
    const last = result?.journeys.at(-1);
    if (last) setPage({ mode: "depart", when: new Date(Date.parse(last.dep) + 60000).toISOString() });
  };

  // Fly to a station when only one end is chosen (no route to frame yet)
  const pickFrom = (s: Place | null) => { setFrom(s); if (s && !to) setFlyTarget({ lat: s.lat, lng: s.lng, key: Date.now() }); };
  const pickTo = (s: Place | null) => { setTo(s); if (s && !from) setFlyTarget({ lat: s.lat, lng: s.lng, key: Date.now() }); };

  const vehicles = snapshot?.vehicles ?? [];
  const counts = useMemo(() => {
    const c: Partial<Record<ModeKey, number>> = {};
    for (const v of vehicles) {
      const m = modeOf(v.product);
      if (m) c[m] = (c[m] ?? 0) + 1;
    }
    return c;
  }, [vehicles]);

  const toggle = (key: ModeKey) =>
    setEnabled(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // "Near me": your position and the closest stations
  const loc = useMyLocation();
  const near = useMemo(() => (loc.me && stations.length ? nearestStations(stations, loc.me) : []), [loc.me, stations]);

  const highlight = [from?.station, to?.station, station?.i].filter((x): x is number => x != null);
  const journey = tracking ? tracking.journey : !station ? result?.journeys?.[selected] ?? null : null;

  return (
    <>
      <MapContainer center={BERLIN_CENTER} zoom={13} zoomControl={false} preferCanvas className="map">
        <FocusMode on={!!tracking} />
        {/* OpenStreetMap tiles: no API key. For a public launch, move to MapTiler/Stadia. */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          className="basemap"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · VBB'
        />
        <ZoomControl position="topright" />
        {loc.on && <LocateButton on={loc.on} locating={loc.locating} onClick={loc.start} />}
        {showLines && <LinesLayer lines={mapLines} enabled={enabled} fade={tracking ? "focus" : journey ? "journey" : "none"} />}
        <JourneyLayer journey={journey} activeLeg={tracking ? tracked.legIndex : null} fit={!tracking} />
        <StationsLayer stations={stations} highlight={highlight} onSelect={s => setStation(s)} faded={!!tracking} />
        <VehicleLayer vehicles={vehicles} interval={snapshot?.interval ?? 10000} enabled={enabled} dimmed={!!tracking} />
        {tracking && <TrackedVehicle data={tracked.data} follow={follow} onUnfollow={() => setFollow(false)} />}
        <NearbyLayer me={loc.me} near={tracking ? [] : near} recenter={loc.recenter} onSelect={s => setStation(s)} />
        <FlyTo target={flyTarget} />
        <PlacePins from={from} to={to} />
        <MapPicker onPick={onMapPick} />
      </MapContainer>

      <SearchPanel
        stations={stations}
        searchIndex={searchIndex}
        stationsError={stationsError}
        from={from}
        to={to}
        setFrom={s => { setStation(null); pickFrom(s); }}
        setTo={s => { setStation(null); pickTo(s); }}
        result={result}
        loading={loading}
        error={error}
        selected={selected}
        onSelectJourney={setSelected}
        timeChoice={timeChoice}
        onTimeChoice={setTimeChoice}
        onEarlier={earlier}
        onLater={later}
        onTrack={startTracking}
        onRefresh={refresh}
        refreshing={loading && result !== null}
        fetchedAt={fetchedAt}
        tracking={tracking ? {
          journey: tracking.journey, legIndex: tracked.legIndex, leg: tracked.leg, data: tracked.data, error: tracked.error,
          follow, onFollow: () => setFollow(true), auto: tracking.leg === null,
          onPickLeg: (k: number | null) => { setTracking({ ...tracking, leg: k }); setFollow(true); },
          onStop: () => setTracking(null),
        } : null}
        station={station}
        onCloseStation={() => setStation(null)}
        nearby={loc.on ? { near, locating: loc.locating, onSelect: (s: Station) => setStation(s), onClose: loc.stop } : null}
        nearbyError={loc.error}
        onNearMe={loc.start}
      />

      <ControlPanel state={state} snapshot={snapshot} counts={counts} enabled={enabled} onToggle={toggle}
        showLines={showLines} onShowLines={setShowLines} linesReady={mapLines.length > 0} />

      <LoadingScreen state={state} snapshot={snapshot} stationsReady={stations.length > 0} linesReady={mapLines.length > 0} />
    </>
  );
}
