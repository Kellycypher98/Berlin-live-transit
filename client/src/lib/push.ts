// Journey notifications while the app is closed (Web Push).
import type { Journey } from "./api";
import { getLang } from "../i18n";
import { isIOS } from "../hooks/useInstall";

export type PushSupport = "ok" | "unsupported" | "install-first" | "denied";

const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  // iPhone/iPad only allow notifications for web apps added to the home screen
  if (isIOS && !standalone()) return "install-first";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

function urlB64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

/** Asks for permission, subscribes this device and tells the server to follow the journey. Returns the watch id. */
export async function startPushWatch(journey: Journey): Promise<string> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "denied" : "dismissed");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await (await fetch("/api/push/key")).json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
  }
  const rides = journey.legs.filter(l => l.mode === "transit" && l.track).map(l => ({
    line: l.line, dir: l.dir, from: l.from.name, to: l.to.name, dep: l.dep, arr: l.arr, track: l.track,
  }));
  const { id } = await postJson("/api/push/watch", { subscription: sub.toJSON(), rides, lang: getLang() });
  return id;
}

export function stopPushWatch(id: string) {
  postJson("/api/push/unwatch", { id }).catch(() => {});
}
