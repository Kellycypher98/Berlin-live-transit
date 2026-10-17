import { useCallback, useEffect, useState } from "react";
import logo from "../assets/logo-128.png";
import { MODES } from "../lib/modes";
import { ModeIcon } from "../components/icons/modeIcons";
import { LineChart } from "./LineChart";
import "./admin.css";

type Stats = {
  now: number; startedAt: number; node: string;
  memory: { rss: number; heapUsed: number };
  clients: number; peakClients: number; visitorsToday: number; connectionsTotal: number;
  vehicles: number; byMode: Record<string, number>; updatedAt: string | null;
  counters: { journeys: number; journeysLive: number; journeysLocal: number; tracks: number; placeSearches: number; pushWatches?: number };
  push?: { watching: number; sent: number; failed: number };
  routes: { route: string; count: number; errors: number; avgMs: number; maxMs: number }[];
  history: { t: number; live: number; delays: number; timetable: number; clients: number }[];
  logs: { t: number; level: "warn" | "error"; message: string }[];
  sources: {
    live: { enabled: boolean; areas?: number; totalAreas?: number; vehicles?: number; failing?: number; failedSweeps?: number };
    delays: { ok: boolean; message: string; trips: number; fetchedAt: number | null; blockedUntil: number | null };
    timetable: { ready: boolean; serviceDate?: string; trips?: number; stations?: number; version?: string; loadedAt?: number; ms?: number; loading?: boolean; failedAt?: number | null };
  };
};

const TOKEN_KEY = "blt-admin-token";
const store = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } },
  set: (v: string) => { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

const num = (n: number) => n.toLocaleString("de-DE");
const mb = (b: number) => `${Math.round(b / 1048576)} MB`;
const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" });
function ago(ms: number | null | undefined, now: number) {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}
function duration(ms: number) {
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m % 60} min` : `${m} min`;
}

/** Admin dashboard at /admin: server health, data sources, usage. Polls every 5 s. */
export function AdminPage() {
  const [token, setToken] = useState(store.get);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  // Sign-in needed: stop polling, so a wrong token isn't retried every 5 s (the server locks out after 5 tries)
  const [login, setLogin] = useState<{ message: string | null } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/stats", { headers: token ? { authorization: `Bearer ${token}` } : {}, signal });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 429) {
        setLogin({ message: token || res.status === 429 ? body.error : null });
        if (token) { store.set(""); setToken(""); }
        return;
      }
      if (!res.ok) { setError({ status: res.status, message: body.error || `Request failed (${res.status})` }); return; }
      setStats(body); setError(null);
    } catch (e) {
      if (!signal?.aborted) setError({ status: 0, message: "Can't reach the server." });
    }
  }, [token]);

  useEffect(() => {
    if (login) return;
    const ctrl = new AbortController();
    load(ctrl.signal);
    const t = setInterval(() => load(ctrl.signal), 5000);
    return () => { ctrl.abort(); clearInterval(t); };
  }, [load, login]);

  if (login) {
    return <Login message={login.message} onSubmit={t => { store.set(t); setToken(t); setStats(null); setLogin(null); }} />;
  }

  return (
    <div className="admin">
      <header className="admin-head">
        <img src={logo} alt="" width={32} height={32} />
        <div className="ttl">
          <h1>Berlin Live Transit</h1>
          <span className="muted">Admin{stats && ` · updated ${time.format(stats.now)}`}</span>
        </div>
        <a className="btn" href="/">Open the map</a>
        {token && <button className="btn" onClick={() => { store.set(""); setToken(""); setStats(null); setLogin({ message: null }); }}>Sign out</button>}
      </header>

      {error && <p className={`banner ${error.status === 403 ? "" : "bad"}`}>{error.message}{error.status === 403 && <> Run the server with <code>ADMIN_TOKEN=some-long-secret</code>, then sign in with it.</>}</p>}
      {!stats && !error && <p className="muted">Loading…</p>}
      {stats && <Dashboard s={stats} />}
    </div>
  );
}

function Login({ message, onSubmit }: { message: string | null; onSubmit: (t: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="admin login">
      <form className="card login-card" onSubmit={e => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
        <img src={logo} alt="" width={48} height={48} />
        <h1>Admin sign-in</h1>
        <label htmlFor="admin-token">Admin token</label>
        <input id="admin-token" type="password" autoComplete="current-password" value={value} onChange={e => setValue(e.target.value)} autoFocus />
        {message && <p className="err small">{message}</p>}
        <button className="btn primary" type="submit">Sign in</button>
        <p className="muted small">The token is the <code>ADMIN_TOKEN</code> the server runs with. It's kept only for this browser tab.</p>
      </form>
    </div>
  );
}

function Dashboard({ s }: { s: Stats }) {
  const times = s.history.map(h => h.t);
  const live = s.sources.live, delays = s.sources.delays, tt = s.sources.timetable;
  const modeRows = MODES.map(m => ({ m, n: s.byMode[m.key] ?? 0 }));
  const modeMax = Math.max(1, ...modeRows.map(r => r.n));
  const errors5xx = s.routes.reduce((a, r) => a + r.errors, 0);

  return (
    <main className="admin-grid">
      <section className="kpis" aria-label="Key numbers">
        <Kpi label="Online now" value={num(s.clients)} sub={`peak ${num(s.peakClients)}`} />
        <Kpi label="Visitors today" value={num(s.visitorsToday)} sub={`${num(s.connectionsTotal)} connections since start`} />
        <Kpi label="Vehicles on map" value={num(s.vehicles)} sub={s.updatedAt ? `as of ${time.format(Date.parse(s.updatedAt))}` : "waiting for data"} />
        <Kpi label="Journey searches today" value={num(s.counters.journeys)} sub={`${num(s.counters.tracks)} tracking requests`} />
        <Kpi label="Uptime" value={duration(s.now - s.startedAt)} sub={`Node ${s.node}`} />
        <Kpi label="Memory" value={mb(s.memory.rss)} sub={`heap ${mb(s.memory.heapUsed)}`} />
      </section>

      <section className="card sources">
        <h2>Data sources</h2>
        <SourceRow
          name="Live positions" sub="VBB community API (radar)"
          status={!live.enabled ? "off" : live.areas === live.totalAreas ? "ok" : live.areas ? "warn" : "bad"}
          text={!live.enabled ? "Turned off (RADAR=off)" : `${live.areas}/${live.totalAreas} areas live · ${num(live.vehicles ?? 0)} vehicles${live.failedSweeps ? ` · backing off (${live.failedSweeps} failed rounds)` : ""}`}
        />
        <SourceRow
          name="Live delays" sub="VBB GTFS-Realtime"
          status={delays.ok ? "ok" : delays.blockedUntil ? "bad" : "warn"}
          text={`${delays.message} · fetched ${ago(delays.fetchedAt, s.now)}${delays.blockedUntil ? ` · paused until ${time.format(delays.blockedUntil)}` : ""}`}
        />
        <SourceRow
          name="Timetable" sub="VBB GTFS"
          status={tt.ready ? "ok" : tt.failedAt ? "bad" : "warn"}
          text={tt.ready
            ? `${(tt.serviceDate ?? "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")} · ${num(tt.trips ?? 0)} trips · ${num(tt.stations ?? 0)} stops${tt.ms ? ` · loaded in ${Math.round(tt.ms / 1000)} s` : ""}`
            : tt.failedAt ? `Failed ${ago(tt.failedAt, s.now)}, retrying` : "Loading…"}
        />
      </section>

      <section className="card wide">
        <h2>Vehicles on the map <span className="muted">· last hour, by source</span></h2>
        <LineChart label="Vehicles on the map over the last hour, by data source" times={times} series={[
          { key: "live", label: "Live", color: "var(--s1)", values: s.history.map(h => h.live) },
          { key: "delays", label: "Delays", color: "var(--s2)", values: s.history.map(h => h.delays) },
          { key: "timetable", label: "Timetable", color: "var(--s3)", values: s.history.map(h => h.timetable) },
        ]} />
      </section>

      <section className="card">
        <h2>People online <span className="muted">· last hour</span></h2>
        <LineChart label="People online over the last hour" height={160} times={times}
          series={[{ key: "clients", label: "Online", color: "var(--s1)", values: s.history.map(h => h.clients) }]} />
      </section>

      <section className="card">
        <h2>Vehicles by type <span className="muted">· now</span></h2>
        <ul className="bars">
          {modeRows.map(({ m, n }) => (
            <li key={m.key} title={`${m.label}: ${num(n)}`}>
              <span className="bar-label"><ModeIcon mode={m.key} size={16} />{m.label}</span>
              <span className="bar-track"><span className="bar" style={{ width: `${(n / modeMax) * 100}%` }} /></span>
              <span className="bar-value">{num(n)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Usage today</h2>
        <dl className="usage">
          <dt>Journey searches</dt><dd>{num(s.counters.journeys)}</dd>
          <dt>· answered live</dt><dd>{num(s.counters.journeysLive)}</dd>
          <dt>· answered from timetable</dt><dd>{num(s.counters.journeysLocal)}</dd>
          <dt>Tracking requests</dt><dd>{num(s.counters.tracks)}</dd>
          <dt>Address searches</dt><dd>{num(s.counters.placeSearches)}</dd>
          <dt>Notifications switched on</dt><dd>{num(s.counters.pushWatches ?? 0)}</dd>
          {s.push && <><dt>· journeys followed now</dt><dd>{num(s.push.watching)}</dd>
          <dt>· notifications sent / failed</dt><dd>{num(s.push.sent)} / {num(s.push.failed)}</dd></>}
        </dl>
      </section>

      <section className="card wide">
        <h2>API <span className="muted">· since start{errors5xx ? ` · ${errors5xx} server errors` : ""}</span></h2>
        {s.routes.length === 0 ? <p className="muted small">No requests yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Endpoint</th><th>Requests</th><th>Errors</th><th>Avg</th><th>Slowest</th></tr></thead>
              <tbody>
                {s.routes.map(r => (
                  <tr key={r.route}>
                    <td><code>{r.route}</code></td>
                    <td>{num(r.count)}</td>
                    <td className={r.errors ? "bad-text" : ""}>{num(r.errors)}</td>
                    <td>{num(r.avgMs)} ms</td>
                    <td>{num(r.maxMs)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card wide">
        <h2>Recent warnings and errors</h2>
        {s.logs.length === 0 ? <p className="muted small">Nothing so far.</p> : (
          <ul className="logs">
            {s.logs.map((l, k) => (
              <li key={k} className={l.level}>
                <span className="lvl">{l.level === "error" ? "✕ Error" : "! Warning"}</span>
                <time>{time.format(l.t)}</time>
                <span className="msg">{l.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

const STATUS = { ok: ["✓", "Working"], warn: ["!", "Partly working"], bad: ["✕", "Down"], off: ["–", "Off"] } as const;
function SourceRow({ name, sub, status, text }: { name: string; sub: string; status: keyof typeof STATUS; text: string }) {
  return (
    <div className="source">
      <span className={`status ${status}`}><span aria-hidden>{STATUS[status][0]}</span> {STATUS[status][1]}</span>
      <div>
        <div className="source-name">{name} <span className="muted">· {sub}</span></div>
        <div className="source-text">{text}</div>
      </div>
    </div>
  );
}
