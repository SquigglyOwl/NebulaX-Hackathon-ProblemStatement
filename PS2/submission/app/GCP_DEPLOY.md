# Deploying to Cloud Run (required for NebulaX judging)

NebulaX requires the judged submission to run on GCP, using the credits
provided to participants — the Vercel URL (`app-steel-ten-64.vercel.app`)
does not count. This app deploys to **Cloud Run**: it's a Next.js app with
SSR pages and API routes (not a static site), so Cloud Run — a real Node
server, not just static hosting — is the natural fit, same shape as the
Vercel deployment it's replacing for judging purposes.

No local Docker install is needed. `gcloud run deploy --source .` builds
the image remotely via Cloud Build using the `Dockerfile` in this
directory — you only need the `gcloud` CLI, authenticated, with the
NebulaX GCP credits applied to your project. This was written and the
Dockerfile validated as far as possible without a local Docker daemon
(none is installed on this machine) — the standalone server's PORT/
HOSTNAME handling was checked directly against the real generated
`.next/standalone/server.js`, not assumed. **The actual `gcloud run
deploy` has not been run yet** — do that once, watch the build log for
errors, and treat the first run as the real test.

## One-time setup

```sh
# Install: https://cloud.google.com/sdk/docs/install
gcloud auth login
gcloud config set project YOUR_PROJECT_ID   # the NebulaX-credits project
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
```

## Deploy

Run from `submission/app/` (this directory — the one with `Dockerfile`):

```sh
gcloud run deploy ps2-commuter-companion \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars="DATAMALL_ACCOUNT_KEY=your_key,GEMINI_API_KEY=your_key,UPSTASH_REDIS_REST_URL=your_url,UPSTASH_REDIS_REST_TOKEN=your_token"
```

`--region asia-southeast1` (Singapore) is the sensible default given the
app is about Singapore's MRT — change it if your team's GCP credits are
scoped to a different region.

**If any secret value itself contains a comma**, `--set-env-vars` needs a
different delimiter (`gcloud`'s docs cover `^##^KEY=val` syntax) — none of
this app's current values do, so the plain comma-separated form above is
fine as written.

`GEMINI_MODEL` is optional (defaults to `gemini-3.5-flash-lite` in code —
see `src/lib/advice.ts`); only add it to `--set-env-vars` if you need to
override the model.

**Prefer Secret Manager over `--set-env-vars` if you have time**: plain
env vars are visible to anyone with read access to the Cloud Run service
config. For a hackathon demo this is a reasonable tradeoff for speed, but
if you want it done properly:

```sh
echo -n "your_key" | gcloud secrets create gemini-api-key --data-file=-
# repeat per secret, then:
gcloud run deploy ps2-commuter-companion \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest,DATAMALL_ACCOUNT_KEY=datamall-account-key:latest,..."
```

## Redis — stronger requirement on Cloud Run than it was on Vercel

`store.ts` falls back to an in-memory `Map` when `UPSTASH_REDIS_REST_URL`/
`UPSTASH_REDIS_REST_TOKEN` aren't set — fine for local `next dev`, **not**
fine here. This was already a known-untested gap on Vercel (see
WRITEUP.md); on Cloud Run it's a firmer requirement, not just a nice-to-
have, because Cloud Run can run multiple concurrent container instances
under load (same class of problem the original `setInterval`/module-cache
rewrite in `state.ts` was already built to solve, just now also true of
the in-memory fallback itself) — each instance would poll DataMall/
crowding independently and cache separately, multiplying real API calls
and potentially showing different commuters different data. Set the two
`UPSTASH_REDIS_REST_*` vars for the judged deployment; free tier at
upstash.com is enough for this app's call volume.

## Client-side map tiles (optional, has a working fallback)

`NEXT_PUBLIC_TILE_URL`/`NEXT_PUBLIC_TILE_ATTRIBUTION` are inlined into the
client JS **at build time** (Next.js's own behavior for `NEXT_PUBLIC_*`
vars — see `node_modules/next/dist/docs/*/self-hosting.md`), not read at
container runtime. Left unset, `MapView.tsx` falls back to Stadia Maps,
which auto-authenticates `localhost` but needs the deployed Cloud Run
domain allow-listed in the Stadia dashboard (free) to serve tiles there —
same requirement this already had on Vercel. `Dockerfile` accepts these as
build args if you want a keyed provider instead, but `gcloud run deploy
--source .`'s auto-generated build doesn't have a direct `--build-arg`
passthrough flag; wiring that up needs a custom `cloudbuild.yaml` with
`--substitutions`, not attempted here since the Stadia fallback already
works — the same tradeoff already accepted for the Vercel deployment.

## After deploying

Verify the same way the DataMall-error-banner fix was verified locally:

```sh
curl https://YOUR-SERVICE-URL/api/status
```

Check `liveFeed.lastPollError` is `null` (confirms the real DataMall key
is wired correctly) and `crowding`/`crowdingFeed` look populated, not
empty.
