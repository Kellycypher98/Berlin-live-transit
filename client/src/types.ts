// Shape of one vehicle in the server's snapshot (see server.js)
export type VehicleSource = "live" | "delays" | "timetable";

export type Vehicle = {
  id: string;
  lat: number;
  lng: number;
  product: string;
  line: string;
  dir: string;
  /** Delay in seconds, or null when unknown */
  delay: number | null;
  /** live = real position; delays = timetable + live delay; timetable = timetable only */
  source: VehicleSource;
  /** Direction of travel in degrees (0 = north), when known from the track */
  h?: number | null;
};

export type Sources = {
  live: { enabled: boolean; areas: number; totalAreas: number; vehicles: number };
  delays: { ok: boolean; message: string; vehicles: number };
  timetable: { ready: boolean; vehicles: number };
};

export type Snapshot = {
  type: "snapshot";
  interval: number;
  updatedAt: string | null;
  vehicles: Vehicle[];
  loading?: boolean;
  error?: string;
  sources: Sources | null;
};

export type ConnectionState = "connecting" | "open" | "closed";
