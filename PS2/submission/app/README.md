# Commuter Companion — Next.js (PS2, Rachel persona)

Same product as the original Express + Vite prototype, rebuilt as a single
Next.js app so it deploys as one project instead of two separate services.
See `WRITEUP.md` for the product write-up (persona, mechanics, known gaps)
— this README is setup/deploy only.

**Judging requires the GCP deployment, not Vercel.** NebulaX requires
submissions to run on GCP using the credits provided to participants — see
`GCP_DEPLOY.md` for the Cloud Run deploy. The Vercel instructions below are
still useful for a quick local-equivalent preview (e.g. sharing a link with
a teammate before the GCP one is up), but the Vercel URL itself does not
count for judging.

## Prerequisites

- Node.js 20+ and npm
- A free LTA DataMall AccountKey — register at https://datamall.lta.gov.sg
- (For production deploys only) A free Upstash Redis database —
  https://upstash.com — see "Why Upstash" below.

## Install and run locally

```bash
npm install
cp .env.example .env   # paste your DATAMALL_ACCOUNT_KEY in
npm run dev             # http://localhost:3000
```

Leave `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` blank locally — the
app falls back to an in-memory cache, which is correct for a single `next
dev` process. Open `http://localhost:3000` in a browser to check it works
before deploying.

## Deploying to Cloud Run (GCP — the judged deployment)

See `GCP_DEPLOY.md` for the full walkthrough (env vars, secrets, region
choice, the standalone-output Docker build). Short version, from this
directory:

```bash
gcloud run deploy ps2-commuter-companion --source . --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars="DATAMALL_ACCOUNT_KEY=...,GEMINI_API_KEY=...,UPSTASH_REDIS_REST_URL=...,UPSTASH_REDIS_REST_TOKEN=..."
```

No local Docker install needed — Cloud Build builds the image remotely
from the `Dockerfile` in this directory. You do need the `gcloud` CLI,
authenticated against the GCP project your NebulaX credits are applied to.

## Deploying to Vercel (optional preview only — not judged)

```bash
npx vercel
```

Then, in the Vercel dashboard for the project, add environment variables:

- `DATAMALL_ACCOUNT_KEY` — required
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — required for
  *correct* production behaviour (see below); the app will still boot
  without them, but its caching will be subtly wrong

Redeploy after adding them (`npx vercel --prod`).

### Why Upstash Redis is required in production, not just recommended

Both Vercel and Cloud Run can run multiple concurrent instances of this
app with no shared memory between them — Vercel because Next.js API
routes run as serverless functions per-invocation, Cloud Run because it
can scale a service to several container instances under load. Either
way, there's no single long-running process. The original Express backend
cached
everything (disruption feed, crowding, walking routes, the PV/Train
baseline) in plain module variables refreshed by `setInterval`; neither of
those works on Vercel. Every caching module here
(`src/lib/{crowding,walkRouting,pvTrainBaseline,trainAlerts,mockState}.ts`)
was rewritten around `src/lib/store.ts`, which uses Upstash Redis (a
REST-based client — works over serverless, unlike a normal persistent-TCP
Redis client) when configured, and quietly falls back to an in-memory `Map`
otherwise.

**Without Redis configured**, each instance (serverless invocation on
Vercel, container instance on Cloud Run) keeps its own separate in-memory
cache — the app still runs, but different requests can see different
cached state (e.g. two different visitors briefly seeing different
disruption data, or the DataMall API getting hit more often than the
intended 60s/10min rate limits, since each cold instance re-fetches on its
own first request). It won't crash, but it's not correct. Get a free
Upstash database (no credit card) before you rely on this for a demo.

## Testing on an iPhone

Same idea as before — you need HTTPS for the app to behave correctly
(service worker, eventually geolocation). Two options:

- **Deployed to Cloud Run (or Vercel)**: you already have a real `https://`
  URL — just open it.
- **Local testing before deploying**: use a tunnel (Cloudflare Tunnel,
  `cloudflared tunnel --url http://localhost:3000`) the same way the
  original prototype did.

## What to click

Same demo flow as the original prototype:

1. Calm screen by default — "no action needed," with the reason why stated
   on-screen, a live crowding strip, and the door-to-door map (real OSRM
   walking routes + MRT line).
2. **Inject minor delay** — stays calm (inside her buffer).
3. **Inject major disruption** — alert screen: delay range, commit-point
   station highlighted on the map, crowding-baseline divergence dots.
4. **Simulate signal loss** — offline fallback banner, using the last cached
   journey from `localStorage`.
5. **Clear** — back to live data.

## Architecture changes from the Express + Vite version

| Old (Express + Vite) | New (Next.js) |
|---|---|
| Two services (`server/`, `web/`) | One Next.js app |
| `setInterval` polling, module-level cache | On-demand fetch-if-stale, `src/lib/store.ts` (Redis/in-memory) |
| Manual Vite proxy config for `/api` | Next.js API routes (`src/app/api/*/route.ts`) — same origin natively |
| `cloudflared`/LAN IP for phone testing | `npx vercel` — a real, permanent `https://` URL |

Everything else — the Interruption Budget Engine, the commit-point detector,
the delay-range/regex extractor, the crowding baseline, the offline
localStorage fallback — is the same logic, ported with minimal changes (see
each file's comments for what, if anything, changed and why).

## Known gaps (carried over, still true here)

- MRT segment geometry is still a straight line between stations (no real
  rail alignment).
- Alternate-route times (`src/lib/alternates.ts`) use OneMap bus-only routing
  when `ONEMAP_TOKEN` (or `ONEMAP_EMAIL` / `ONEMAP_PASSWORD`) is set, and
  otherwise fall back to a hand-picked placeholder table (`/api/status`
  reports which via `alternatesFeed.source`). Covered by offline tests
  (`npm run check:alternates`, stubbed `fetch`) and **verified against the
  live API** (`npm run probe:onemap`, plus a direct `getAlternates()` run):
  `source: "onemap"`, no error, real bus-only minutes for all 12 stations,
  monotonically decreasing toward the destination (EW2=72min … EW13=18min),
  destination station correctly `Infinity`.
- Station coordinates come from the provided MP2014 rail-station GeoJSON
  (footprint centroids, `npm run build:stations`), not station *exits* —
  DataMall's `TrainStationExit` layer would be more accurate for door-to-door
  walking legs.
- Per-station ride times (`cumMinutes`, `src/lib/rideTimes.ts`) use real
  OneMap-measured in-vehicle times when `ONEMAP_TOKEN` (or `ONEMAP_EMAIL` /
  `ONEMAP_PASSWORD`) is set, falling back to `rachel.ts`'s hand-picked table
  otherwise (`/api/status` reports which via `rideTimesFeed.source`).
  **Verified against the live API**: `source: "onemap"`, no error, real
  in-vehicle times strictly increasing along the line and meaningfully
  shorter than the old hand-picked estimates (e.g. Tampines → Raffles Place:
  28 min real vs. 38 min hand-picked).
- ~~The fallback severity classifier (for notices with no stated delay
  figure) is still a 2-value heuristic, not an LLM.~~ Implemented
  (`src/lib/advice.ts`, Gemini) and evaluated — see WRITEUP.md "The
  fallback classifier". The 2-value heuristic remains only as the
  last-resort fallback when no `GEMINI_API_KEY` is set or the call fails.
- The Redis code path (`store.ts`'s `@upstash/redis` branch) has not been
  tested against a real Upstash database in this session — only the
  in-memory fallback has been verified end-to-end. Test this before trusting
  it for the actual demo.
