// One place for outgoing HTTP: every request to VBB identifies this app.
// VBB's GTFS-RT feed asks for "an informative User-Agent, ideally with contact information"
// and blocks generic ones (Node's default is just "node"). Set CONTACT to your email or a URL.

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const contact = process.env.CONTACT ? `; ${process.env.CONTACT}` : "";

export const USER_AGENT = `berlin-live-transit/${pkg.version} (live transit map for Berlin${contact})`;

/** fetch() with this app's User-Agent added. */
export function httpFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { "user-agent": USER_AGENT, ...(opts.headers ?? {}) } });
}
