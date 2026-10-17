import { isRail, type Station } from "./api";

/** "S+U Alexanderplatz (Berlin)" -> "alexanderplatz berlin"; umlauts and ß folded. */
export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(s\+u|s|u)\b\s+/g, " ")
    .replace(/str\.?(\s|$)/g, "strasse$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type Indexed = { s: Station; n: string; words: string[] };

export function buildSearchIndex(stations: Station[]): Indexed[] {
  return stations.map(s => { const n = normalize(s.name); return { s, n, words: n.split(" ") }; });
}

/** Ranks stations: whole-name prefix > word prefix > substring; rail stations first on ties. */
export function searchStations(index: Indexed[], query: string, limit = 8): Station[] {
  const q = normalize(query);
  if (!q) return [];
  const qWords = q.split(" ");
  const scored: { s: Station; score: number }[] = [];
  for (const it of index) {
    let score = 0;
    if (it.n.startsWith(q)) score = 100;
    else if (qWords.every(w => it.words.some(x => x.startsWith(w)))) score = 60;
    else if (it.n.includes(q)) score = 30;
    else continue;
    if (isRail(it.s)) score += 15;
    score += Math.min(10, it.s.lines.length); // busier stations first
    score -= it.n.length / 100;
    scored.push({ s: it.s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.s);
}

/** Nearest station to a point, preferring rail stations within a short walk (kept for reference). */
export function nearestStation(stations: Station[], lat: number, lng: number): Station | null {
  let best: Station | null = null, bestScore = Infinity;
  const kx = Math.cos((lat * Math.PI) / 180);
  for (const s of stations) {
    const d = Math.hypot((s.lat - lat) * 111_000, (s.lng - lng) * 111_000 * kx);
    const score = d - (isRail(s) ? 250 : 0);
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}
