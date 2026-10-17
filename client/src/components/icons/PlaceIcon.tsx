import type { Place } from "../../lib/api";
import { ModeIcon } from "./modeIcons";
import { P } from "../../lib/api";

/** Pin for addresses, flag for points of interest, target for "my location". */
export function PlaceIcon({ kind, size = 18 }: { kind: Place["kind"] | "walk"; size?: number }) {
  const paths: Record<string, string> = {
    address: "M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z",
    poi: "M6 3h2v18H6z M8 4h10l-2 4 2 4H8z",
    location: "M12 2v3 M12 19v3 M2 12h3 M19 12h3 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
    walk: "M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7",
  };
  const stroke = kind === "location";
  return (
    <svg className="place-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d={paths[kind] ?? paths.address} fill={stroke ? "none" : "currentColor"} stroke={stroke ? "currentColor" : "none"} strokeWidth={stroke ? 2 : 0} strokeLinecap="round" />
    </svg>
  );
}

/** Station: its main mode badge; anything else: a place icon. */
export function PlaceGlyph({ place, size = 18 }: { place: Place; size?: number }) {
  if (place.kind === "station") {
    const p = place.p ?? 0;
    const mode = p & P.suburban ? "suburban" : p & P.subway ? "subway" : p & P.regional ? "regional" : p & P.tram ? "tram" : p & P.ferry ? "ferry" : "bus";
    return <ModeIcon mode={mode} size={size} />;
  }
  return <PlaceIcon kind={place.kind} size={size} />;
}
