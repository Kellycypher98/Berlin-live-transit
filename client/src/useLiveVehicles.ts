import { useEffect, useState } from "react";
import type { ConnectionState, Snapshot } from "./types";

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
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/live`);
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
