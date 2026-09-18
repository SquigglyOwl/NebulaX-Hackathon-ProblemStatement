# Commuter Companion — prototype (PS2, Rachel persona)

A minimal end-to-end slice of the Interruption Budget Engine: polls LTA's
`TrainServiceAlerts`, decides whether a disruption costs Rachel her 08:45
deadline on her **door-to-door** journey (home → Tampines → EWL → Raffles
Place → office), and either stays silent or shows a one-line recommendation
with the affected segment on an OpenStreetMap map. When it does interrupt
her, it also runs the **commit-point detector** — the last station along her
route at which switching to an alternate route still beats riding out the
delay — and marks that station on the map.

This is a working scaffold, not the full submission — see `WRITEUP.md` for
what's stubbed vs real.

## Prerequisites

- Node.js 20+ and npm
- A free LTA DataMall AccountKey — register at https://datamall.lta.gov.sg

## Install and run

Two processes, in two terminals, from this `app/` directory:

```bash
# 1. Backend — polls DataMall, runs the decision engine
cd server
cp .env.example .env   # then paste your DATAMALL_ACCOUNT_KEY into .env
npm install
npm run dev             # listens on :4000

# 2. Frontend — mobile-first UI, proxies /api to :4000
cd web
npm install
npm run dev              # listens on :5173
```

Open `http://localhost:5173` in a desktop browser to sanity-check it first.

## Testing on an iPhone

The frontend needs a secure (`https://`) origin for the app to behave like it
will in production (geolocation, service workers). Easiest path — a Cloudflare
Tunnel pointed at the Vite dev server (which already proxies `/api` to the
backend, so one tunnel covers both):

```bash
# after both npm run dev processes above are running
cloudflared tunnel --url http://localhost:5173
```

`cloudflared` isn't installed by default — see the "Installing cloudflared"
note below. The command prints an `https://<random>.trycloudflare.com` URL;
open that on the iPhone (Safari or Chrome, any network — WiFi or cellular).

### Installing cloudflared

- Windows: `winget install --id Cloudflare.cloudflared`
- macOS: `brew install cloudflared`

No account or login needed for a quick tunnel.

## What to click

1. On load, the app shows the calm "Good morning, Rachel — no action needed"
   screen, a live crowding strip (one badge per station, real
   `PCDRealTime` data — L/M/H, not colour alone), and the map underneath
   showing her full door-to-door route: a dashed walking leg from home
   (green "H") to Tampines, the EWL ride, and a dashed walking leg from
   Raffles Place to her office (purple "W"). Staying calm is deliberate:
   `TrainServiceAlerts.AffectedSegments` is empty on an ordinary day, and the
   whole point of the Interruption Budget Engine is staying quiet until a
   disruption actually costs her the deadline — but the planned route and
   current crowding are always visible, not just when something's wrong.
2. Tap **Inject minor delay** — a 5-minute delay is inside Rachel's buffer, so
   the app stays on the calm screen (message updates to say why).
3. Tap **Inject major disruption** — this crosses her slack threshold: the app
   switches to the alert screen, shows the one-line recommendation as a
   *range* (not a single confident number — "+15–39 min expected…"), a
   yellow band visualizing that range, the commit-point station ("Switch by
   Paya Lebar…"), and the map highlights the affected EWL segment plus the
   commit-point station in blue.
4. Tap **Clear** to return to live-feed mode.
5. Tap **Simulate signal loss** — the app stops polling the server and falls
   back to the last cached journey, with a banner: "Signal lost — showing
   your update from N min ago." Tap **Restore signal** to return to live
   data. This is the app's answer to §2.6's "no signal underground"
   requirement — see `WRITEUP.md` "Offline handling."

The injected disruptions are clearly labelled `Simulated disruption — demo
only` in the UI — see PS2_README §2.6, which permits labelled replay/injected
data since the real feed is quiet most days.

## Known gaps in this scaffold

- Delay-minutes is now read directly out of the notice text
  (`delayExtractor.ts`, regex against LTA's "Additional travelling time of N
  minutes" phrasing — verified against the official API guide's Annex C).
  The two-value `Status`-keyed lookup in `engine.ts` is now only a fallback
  for notices that don't state a duration; there's no classifier yet for
  that fallback case (still a placeholder, see `WRITEUP.md`).
- Station coordinates and MRT per-segment travel times in `rachel.ts` are
  still hand-placed approximations, not sourced from
  `AmendmenttoMP2014RailStation.geojson`, a real timetable, or OneMap — the
  train portion of the route is still a straight line between stations.
- Alternate-route travel times in `alternates.ts` are a hand-picked fallback
  table, not real OneMap routing results — `warmAlternatesCache()` is where
  that integration slots in.
- The two walking legs (home↔Tampines, Raffles Place↔office) **are now real
  OSM pedestrian routes** — `walkRouting.ts` fetches actual footpath geometry
  and duration from a public foot-profile OSRM instance at startup, and the
  door-to-door time/slack calculation uses the real duration, not a guess.
  See `WRITEUP.md` "Real OSM routing for the walking legs" for how this was
  verified (and a wrong first attempt caught before it shipped).
- The commit-point detector has no live position signal (no MRT GPS feed
  exists, and none would work underground anyway) — it doesn't yet estimate
  which station Rachel is actually at, only which station is the commit point
  if a disruption starts now.
- No offline/tunnel caching implemented yet (§2.6 "no signal underground").
- Single hardcoded persona (Rachel) and single hardcoded route.
