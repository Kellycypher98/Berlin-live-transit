import { useState } from "react";
import { fetchReverse, placeKey, stationPlace, type JourneyResult, type Place, type Station } from "../../lib/api";
import type { Indexed } from "../../lib/search";
import { PlaceInput } from "./PlaceInput";
import { PlaceIcon } from "../icons/PlaceIcon";
import { JourneyList } from "../journeys/JourneyList";
import { StationCard } from "../stations/StationCard";
import { TimePicker, type TimeChoice } from "./TimePicker";
import { TrackPanel } from "../tracking/TrackPanel";
import type { ComponentProps } from "react";
import { NearbyList } from "../nearby/NearbyList";
import type { NearStation } from "../../lib/nearby";

type Props = {
  stations: Station[];
  searchIndex: Indexed[];
  stationsError: string | null;
  from: Place | null;
  to: Place | null;
  setFrom: (p: Place | null) => void;
  setTo: (p: Place | null) => void;
  result: JourneyResult | null;
  loading: boolean;
  error: string | null;
  selected: number;
  onSelectJourney: (k: number) => void;
  station: Station | null;
  onCloseStation: () => void;
  timeChoice: TimeChoice;
  onTimeChoice: (c: TimeChoice) => void;
  onEarlier: () => void;
  onLater: () => void;
  onTrack: (journeyIndex: number, leg: number | null) => void;
  onRefresh: () => void;
  refreshing: boolean;
  fetchedAt: number | null;
  tracking: ComponentProps<typeof TrackPanel> | null;
  nearby: { near: NearStation[]; locating: boolean; onSelect: (s: Station) => void; onClose: () => void } | null;
  nearbyError: string | null;
  onNearMe: () => void;
};

export function SearchPanel(p: Props) {
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const ready = p.stations.length > 0;

  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocError("Your browser can't share its location."); return; }
    setLocating(true); setLocError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocating(false);
        // Your exact position; the street name is filled in when the lookup answers
        const here: Place = { kind: "location", name: "My location", lat: pos.coords.latitude, lng: pos.coords.longitude };
        p.setFrom(here);
        fetchReverse(here.lat, here.lng).then(r => { if (r.name) p.setFrom({ ...here, detail: `near ${r.name}` }); }).catch(() => {});
      },
      err => {
        setLocating(false);
        setLocError(err.code === err.PERMISSION_DENIED ? "Location access was blocked. Type an address or station instead." : "Couldn't get your location. Type an address or station instead.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <aside className="search-panel">
      <form className="search-form" onSubmit={e => e.preventDefault()}>
        <PlaceInput
          id="from" label="From" placeholder={ready ? "Address, place or station" : "Loading stations…"}
          value={p.from} onChange={p.setFrom} searchIndex={p.searchIndex} disabled={!ready}
          trailing={
            <button type="button" className="icon-btn" onClick={useMyLocation} disabled={!ready || locating}
              aria-label="Use my location" title="Use my location">
              {locating ? "…" : <PlaceIcon kind="location" size={16} />}
            </button>
          }
        />
        <PlaceInput
          id="to" label="To" placeholder={ready ? "Where to? Address, place or station" : "Loading stations…"}
          value={p.to} onChange={p.setTo} searchIndex={p.searchIndex} disabled={!ready}
          trailing={
            <button type="button" className="icon-btn" disabled={!p.from && !p.to}
              onClick={() => { const f = p.from; p.setFrom(p.to); p.setTo(f); }}
              aria-label="Swap start and destination" title="Swap">⇅</button>
          }
        />
        <TimePicker value={p.timeChoice} onChange={p.onTimeChoice} />
        {!ready && p.stationsError && <p className="muted small">{p.stationsError}</p>}
        {locError && <p className="err small">{locError}</p>}
        {p.from?.detail && p.from.kind === "location" && <p className="muted small from-detail">From {p.from.detail}</p>}
      </form>

      <div className="panel-body">
        {p.loading && !p.result && <p className="muted">Finding connections…</p>}
        {p.error && (
          <div className="err-row">
            <p className="err">{p.error}</p>
            {p.from && p.to && placeKey(p.from) !== placeKey(p.to) && <button className="btn sm" onClick={p.onRefresh}>Try again</button>}
          </div>
        )}
        {p.tracking ? (
          <TrackPanel {...p.tracking} />
        ) : p.station ? (
          <StationCard station={p.station} onClose={p.onCloseStation} onFrom={s => p.setFrom(stationPlace(s))} onTo={s => p.setTo(stationPlace(s))} />
        ) : (
          p.result && (!p.loading || p.refreshing) && (
            <JourneyList result={p.result} selected={p.selected} onSelect={p.onSelectJourney} onEarlier={p.onEarlier} onLater={p.onLater}
              onTrack={p.onTrack} onRefresh={p.onRefresh} refreshing={p.refreshing} fetchedAt={p.fetchedAt} />
          )
        )}
        {p.nearbyError && <p className="err small">{p.nearbyError}</p>}
        {p.nearby && !p.tracking && !p.station && !p.result && !p.loading && (
          <NearbyList {...p.nearby} onFrom={s => p.setFrom(stationPlace(s))} />
        )}
        {!p.nearby && !p.tracking && !p.result && !p.loading && !p.station && ready && (
          <>
            <button className="near-me-btn" onClick={p.onNearMe}>
              <PlaceIcon kind="location" size={18} />
              <span>Stations near me</span>
            </button>
            {!p.error && <p className="muted small hint">Search any address, place or station. Tap a station for its departures, or right-click (long-press) the map to route from or to that spot.</p>}
          </>
        )}
      </div>
    </aside>
  );
}
