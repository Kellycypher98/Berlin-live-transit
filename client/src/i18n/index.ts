// Tiny translation layer. Texts are written in English in the code; other languages map the
// English text to their own (see de.ts). Anything without a translation falls back to English.
//   t("Leave now")                       -> "Jetzt los"
//   t("in {n} min", { n: 5 })            -> "in 5 Min."
// Messages from the server go through t() too, so they're translated the same way.
import { useSyncExternalStore } from "react";
import { de } from "./de";

export type Lang = "en" | "de";
export const LANGS: { key: Lang; label: string; short: string }[] = [
  { key: "en", label: "English", short: "EN" },
  { key: "de", label: "Deutsch", short: "DE" },
];
const DICTS: Record<Lang, Record<string, string> | null> = { en: null, de };
const STORE_KEY = "blt-lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === "en" || saved === "de") return saved;
  } catch { /* storage blocked */ }
  return (navigator.languages ?? [navigator.language]).some(l => l?.toLowerCase().startsWith("de")) ? "de" : "en";
}

let lang: Lang = initial();
document.documentElement.lang = lang;
const listeners = new Set<() => void>();
const missing = new Set<string>();

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = text;
  const dict = DICTS[lang];
  if (dict) {
    if (dict[text] !== undefined) out = dict[text];
    else if (import.meta.env.DEV && !missing.has(text)) { missing.add(text); console.debug(`[i18n] no ${lang} text for: ${text}`); }
  }
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

export const getLang = () => lang;
/** Locale for dates and numbers. */
export const locale = () => (lang === "de" ? "de-DE" : "en-GB");

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  document.documentElement.lang = next;
  try { localStorage.setItem(STORE_KEY, next); } catch { /* storage blocked */ }
  listeners.forEach(f => f());
}

const subscribe = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };

/** Re-renders the component when the language changes. */
export function useLang() {
  const current = useSyncExternalStore(subscribe, getLang);
  return { lang: current, t, setLang };
}
