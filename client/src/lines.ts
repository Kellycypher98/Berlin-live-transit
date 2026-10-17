import { colorOf } from "./modes";

// Official line colours for Berlin's U-Bahn and S-Bahn; other lines use their mode's colour.
const LINE_COLORS: Record<string, string> = {
  U1: "#7DAD4C", U2: "#DA421E", U3: "#16683D", U4: "#F0D722", U5: "#7E5330",
  U6: "#8C6DAB", U7: "#528DBA", U8: "#224F86", U9: "#F3791D",
  S1: "#DE4DA4", S2: "#005F27", S25: "#005F27", S26: "#005F27", S3: "#0A4C99",
  S41: "#AD5937", S42: "#CB6418", S45: "#CD9C53", S46: "#CD9C53", S47: "#CD9C53",
  S5: "#EB7405", S7: "#816DA6", S75: "#816DA6", S8: "#66AA22", S85: "#66AA22", S9: "#992746",
};
const DARK_TEXT = new Set(["U4", "S45", "S46", "S47"]);

export function lineStyle(line: string | undefined, product?: string) {
  const key = (line ?? "").replace(/\s+/g, "");
  const bg = LINE_COLORS[key] ?? colorOf(product ?? guessProduct(key));
  return { background: bg, color: DARK_TEXT.has(key) ? "#16202b" : "#ffffff" };
}

function guessProduct(line: string) {
  if (/^U\d/.test(line)) return "subway";
  if (/^S\d/.test(line)) return "suburban";
  if (/^(M\d+|1[0-9]|2[0-9]|[3-6][0-9])$/.test(line) && line.startsWith("M")) return "tram";
  if (/^(RE|RB|FEX|IC|ICE)/.test(line)) return "regional";
  return "bus";
}
