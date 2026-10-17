import { useSyncExternalStore } from "react";

// "Add to Home Screen": Chrome/Edge/Android fire `beforeinstallprompt`, which we keep so a button can
// open the real install dialog. iPhone/iPad have no such API: users add it via Share → Add to Home Screen.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPromptEvent | null = null;
let installed = typeof window !== "undefined" && (
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true
);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e as InstallPromptEvent; emit(); });
window.addEventListener("appinstalled", () => { installed = true; deferred = null; emit(); });

const ua = navigator.userAgent;
/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

let snapshot = { canPrompt: false, installed };
const getSnapshot = () => {
  if (snapshot.canPrompt !== !!deferred || snapshot.installed !== installed) snapshot = { canPrompt: !!deferred, installed };
  return snapshot;
};
const subscribe = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };

export function useInstall() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  const prompt = async () => {
    if (!deferred) return false;
    const e = deferred;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null; emit();
    return outcome === "accepted";
  };
  return { ...s, isIOS, prompt };
}
