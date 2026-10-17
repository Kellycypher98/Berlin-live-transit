export type ModeKey = "subway" | "suburban" | "tram" | "bus" | "regional" | "ferry";

export type Mode = { key: ModeKey; label: string; color: string; defaultOn: boolean };

export const MODES: Mode[] = [
  { key: "subway",   label: "U-Bahn", color: "#115d91", defaultOn: true },
  { key: "suburban", label: "S-Bahn", color: "#008d4f", defaultOn: true },
  { key: "tram",     label: "Tram",   color: "#be1414", defaultOn: true },
  { key: "bus",      label: "Bus",    color: "#a5027d", defaultOn: false },
  { key: "regional", label: "Regio",  color: "#e3000f", defaultOn: false },
  { key: "ferry",    label: "Ferry",  color: "#0080ba", defaultOn: false },
];

/** Map a VBB product name to one of our modes (ICE/IC are grouped with regional). */
export function modeOf(product: string): ModeKey | null {
  if (product === "express") return "regional";
  return MODES.some(m => m.key === product) ? (product as ModeKey) : null;
}

export const colorOf = (product: string) =>
  MODES.find(m => m.key === modeOf(product))?.color ?? "#777777";
