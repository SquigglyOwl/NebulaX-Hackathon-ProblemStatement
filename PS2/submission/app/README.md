# Commuter Companion — Next.js (PS2, Rachel persona)

Same product as the original Express + Vite prototype, rebuilt as a single
Next.js app so it deploys to Vercel as one project instead of two separate
services. See `WRITEUP.md` for the product write-up (persona, mechanics,
known gaps) — this README is setup/deploy only.

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

## Deploying to Vercel

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

Vercel runs Next.js API routes as **serverless functions** — there is no
long-running process, and a different invocation can land on a different
instance with no shared memory. The original Express backend cached
everything (disruption feed, crowding, walking routes, the PV/Train
baseline) in plain module variables refreshed by `setInterval`; neither of
those works on Vercel. Every caching module here
(`src/lib/{crowding,walkRouting,pvTrainBaseline,trainAlerts,mockState}.ts`)
was rewritten around `src/lib/store.ts`, which uses Upstash Redis (a
REST-based client — works over serverless, unlike a normal persistent-TCP
Redis client) when configured, and quietly falls back to an in-memory `Map`
otherwise.

**Without Redis configured on Vercel**, each serverless instance keeps its
own separate in-memory cache — the app still runs, but different requests
can see different cached state (e.g. two different visitors briefly seeing
different disruption data, or the DataMall API getting hit more often than
the intended 60s/10min rate limits, since each cold instance re-fetches on
its own first request). It won't crash, but it's not correct. Get a free
Upstash database (no credit card) before you rely on this for a demo.

## Testing on an iPhone

Same idea as before — you need HTTPS for the app to behave correctly
(service worker, eventually geolocation). Two options:

- **Deployed to Vercel**: you already have a real `https://` URL — just open
  it.
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
- Alternate-route times (`src/lib/alternates.ts`) are still a hand-picked
  placeholder table, not real OneMap routing.
- ~~The fallback severity classifier (for notices with no stated delay
  figure) is still a 2-value heuristic, not an LLM.~~ Implemented
  (`src/lib/advice.ts`, Gemini) and evaluated — see WRITEUP.md "The
  fallback classifier". The 2-value heuristic remains only as the
  last-resort fallback when no `GEMINI_API_KEY` is set or the call fails.
- The Redis code path (`store.ts`'s `@upstash/redis` branch) has not been
  tested against a real Upstash database in this session — only the
  in-memory fallback has been verified end-to-end. Test this before trusting
  it for the actual demo.
