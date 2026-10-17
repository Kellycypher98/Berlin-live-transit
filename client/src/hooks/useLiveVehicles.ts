import { useEffect, useState } from "react";
import type { ConnectionState, Snapshot } from "../lib/types";

/** wss://<backend>/live when the server runs elsewhere (Netlify), else the same host the app came from. */
function liveUrl() {
  if (__BACKEND_URL__) return __BACKEND_URL__.replace(/^http/, "ws") + "/live";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/live`;
}

/** Subscribes to the server's /live WebSocket and reconnects with backoff. */
export function useLiveVehicles() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [state, setState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let delay = 1000;
    let stopped = false;

    const connect = () => {
      ws = new WebSocket(liveUrl());
      setState("connecting");
      ws.onopen = () => { setState("open"); delay = 1000; };
      ws.onmessage = e => {
        const msg = JSON.parse(e.data) as Snapshot;
        if (msg.type === "snapshot") setSnapshot(msg);
      };
      ws.onclose = () => {
        if (stopped) return;
        setState("closed");
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
    };
    connect();

    return () => { stopped = true; clearTimeout(retry); ws?.close(); };
  }, []);

  return { snapshot, state };
}
