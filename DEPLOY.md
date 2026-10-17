# Deploying: app on Netlify, server on AWS Lightsail

| Part | Where | What |
|------|-------|------|
| React app | **Netlify** | the map, search, `/admin` page |
| Node server | **AWS Lightsail**, 1 GB or more | live data, journeys, tracking, WebSocket |

The server uses about 600 MB of memory while it builds the VBB timetable and about 400 MB afterwards,
so the 1 GB plan is enough (the setup also adds 2 GB of swap as a safety margin). Netlify forwards `/api/*` to the server; the live WebSocket connects to it directly.

## 1. Push the code

```bash
git add -A && git commit -m "Lightsail deploy" && git push
```

The setup below downloads the code from GitHub, so the repo has to be public
(GitHub → repo → Settings → General → Danger Zone → Change visibility).

## 2. Create the server (Lightsail console, lightsail.aws.amazon.com)

1. **Create instance** → region **Frankfurt (eu-central-1)** → **Linux/Unix** → **OS Only** → **Ubuntu 24.04 LTS**.
2. Plan: **1 GB memory** or larger. Name it `berlin-live-api` → **Create instance**.
3. Open the instance → **Networking**:
   - **Attach static IP** (create one; free while attached). The server's address is built from it.
   - **IPv4 Firewall → Add rule → HTTPS** (port 443). HTTP (80) is already open; keep it, it's needed for the certificate.

## 3. Install and start

Instance → **Connect using SSH** (opens a terminal in the browser), then paste, with your email:

```bash
curl -fsSL https://raw.githubusercontent.com/Kellycypher98/Berlin-live-transit/main/deploy/setup.sh | bash -s -- you@example.com
```

It installs Docker, adds swap, downloads the code, creates `deploy/.env` with a new admin token, and starts
the server behind Caddy (HTTPS with a free certificate). At the end it prints:

- the API address, e.g. `https://3-121-45-67.sslip.io` (built from your static IP, no domain needed)
- your **admin token** (also saved in `~/berlin-live/deploy/.env` on the server)

The first start takes a few minutes: building the image, downloading the timetable (~80 MB) and indexing it.
Check `https://<that address>/health`, or watch: `cd ~/berlin-live/deploy && sudo docker compose logs -f api`.

### Or on EC2 instead of Lightsail

Same script, different console steps (EC2 → **Launch instance**, region Frankfurt):
1. **Ubuntu Server 24.04**, instance type **t3.micro** (1 GB) or larger.
2. Key pair: **create one** (downloads a `.pem` file). Storage: 20 GB gp3.
3. Security group: allow **SSH** (from My IP), **HTTP** (80) and **HTTPS** (443) from anywhere → **Launch**.
4. **Elastic IPs → Allocate → Associate** with the instance (so the address never changes).
5. From your Mac: `chmod 400 ~/Downloads/<key>.pem && ssh -i ~/Downloads/<key>.pem ubuntu@<elastic-ip>`,
   then paste the `curl … setup.sh` command from step 3 above. (Browser-based EC2 Instance Connect
   needs SSH open to AWS's address range, not just your IP.)

## 4. Point Netlify at it

Netlify → **Site configuration → Environment variables** → `BACKEND_URL` = `https://3-121-45-67.sslip.io`
(your address, no trailing slash) → **Deploys → Trigger deploy**.

Then open your Netlify site; `/admin` takes the admin token from step 3.

## Updating

After pushing to GitHub, in the instance's SSH:

```bash
cd ~/berlin-live/deploy && ./update.sh
```

The timetable is kept in a Docker volume, so restarts take seconds instead of minutes.

## Your own domain (later)

- App: Netlify → **Domain management → Add a domain**; it shows the DNS records and sets up HTTPS.
- API (optional): add an `A` record `api.yourdomain.de` → the static IP, set `DOMAIN=api.yourdomain.de` in
  `~/berlin-live/deploy/.env`, run `./update.sh`, and change `BACKEND_URL` on Netlify.

## Before real traffic

- Map tiles: move from openstreetmap.org tiles to a keyed provider (MapTiler, Stadia).
- Lightsail → instance → **Snapshots**: turn on automatic snapshots.
