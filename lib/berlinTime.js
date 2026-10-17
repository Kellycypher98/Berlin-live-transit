// GTFS times are relative to the service day in the agency's time zone (Europe/Berlin),
// regardless of where the server runs (e.g. AWS in UTC).

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** { date: "YYYYMMDD", seconds: seconds since Berlin midnight, weekday: 0=Sun..6=Sat } */
export function berlinNow(ms = Date.now()) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const date = `${p.year}${p.month}${p.day}`;
  const seconds = +p.hour * 3600 + +p.minute * 60 + +p.second;
  return { date, seconds, weekday: weekdayOf(date) };
}

export function weekdayOf(yyyymmdd) {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(yyyymmdd, n) {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10).replaceAll("-", "");
}

/** "25:13:00" -> 90780 */
export function parseGtfsTime(s) {
  if (!s) return NaN;
  const [h, m, sec] = s.split(":");
  return +h * 3600 + +m * 60 + +(sec ?? 0);
}
