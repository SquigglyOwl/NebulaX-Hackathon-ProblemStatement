# Write-up (draft)

## Persona

Building for **Rachel** — the fixed-schedule commuter (Tampines → Raffles
Place, EWL, leaves 07:40, must be at her desk by 08:45). Chosen because a
fixed origin/destination/deadline makes "does this disruption actually cost
her something" a tractable, demoable calculation, and because her stated need
— "interrupted only when it matters, told what to do in one line" — maps
directly onto a decision layer rather than a status feed.

## Architecture

Rebuilt from an earlier Express + Vite prototype into a single Next.js app,
specifically to get one-command Vercel deployment instead of running two
separate services. See "Migrating to Next.js" below for what that actually
required.

- `src/app/api/*/route.ts` — Next.js Route Handlers (`GET /api/status`,
  `POST /api/mock/inject|clear`), same shape as the old Express endpoints.
- `src/lib/state.ts` — orchestrates one `/api/status` response: reads (or
  fetches, if stale) the disruption feed, crowding, walking routes and the
  PV/Train baseline, runs the Interruption Budget Engine, returns the full
  status object.
- `src/lib/store.ts` — the piece that actually needed rearchitecting, not
  just moving. Serverless functions share no memory between invocations, so
  the old `setInterval` + module-variable caching silently breaks on Vercel.
  This wraps Upstash Redis (falling back to an in-memory `Map` when no
  credentials are set, so local `next dev` needs no extra setup) behind a
  small get/set API every caching module now goes through.
- `src/app/page.tsx` — the UI, polling `/api/status` every 15s. The map
  (Leaflet over OSM tiles) is always shown, not just during a disruption —
  it renders the full door-to-door route (walk → EWL → walk); only the card
  above it and the affected-segment/commit-point highlighting change with
  `decision.interrupt`.

## Migrating to Next.js

The motivation was deployment, not the frontend framework itself — Vite was
working fine. The actual problem was that judges following the README had to
run two separate processes (`server/`, `web/`) plus, for phone testing, a
`cloudflared` tunnel that turned out to be unreliable on some networks (see
the archived `app-vite-express-archive/`'s session history — the tunnel port got blocked mid-build by
something on the network, with no fix available from this end). One Next.js
app deploying to Vercel with `npx vercel` removes all of that.

**What changed, honestly:** every backend module that cached something
across requests needed rewriting, not just moving into a new folder.
`setInterval`-based polling assumes a long-running process; serverless
functions don't have one. Each caching module
(`crowding.ts`/`walkRouting.ts`/`pvTrainBaseline.ts`/`trainAlerts.ts`) was
converted from "warm on server startup, poll on an interval" to "check
staleness on each request, fetch fresh only if needed" — which, worth
noting, is arguably a *better* pattern than what it replaced, not just a
serverless workaround.

**What was ported unchanged:** `engine.ts` (Interruption Budget Engine,
commit-point detector — pure functions, no I/O), `delayExtractor.ts`
(regex-based), `rachel.ts` (the hardcoded journey), `datamall.ts` (the raw
API calls) — none of these touch caching, so none of them needed to change.

**A real bug caught during the migration, not after:** the first draft of
the new `state.ts` "simplified" a field-remapping step from the old code
(`WalkRoute`'s own field names — `coordinates`/`source` — don't match what
the frontend expects — `route`/`routeSource`) into a blind object spread.
It type-checked fine and looked like a reasonable simplification. It broke
silently — the frontend would have received `undefined` for `walk.home.route`
and crashed trying to render the map. Caught by actually `curl`-ing
`/api/status` and checking the real JSON shape after writing the code,
not by trusting that a clean `tsc --noEmit` meant it worked — same
discipline as the OSRM and PV/Train mistakes documented below.

## Real OSM routing for the walking legs

The two walking legs are now real pedestrian routes, not straight lines —
`walkRouting.ts` calls a public foot-profile OSRM instance
(`routing.openstreetmap.de/routed-foot`) at server startup, gets back real
street-following geometry plus a duration, and `state.ts` uses both: the
geometry is what `MapView.tsx` draws, and the duration feeds
`normalJourneyMinutes`/slack directly, replacing the earlier hand-picked
7/6-minute guesses.

**A real mistake worth recording, not hiding:** the first attempt used
`router.project-osrm.org`'s public demo with `/route/v1/foot/...` in the
URL. It returned 200 OK and looked like real foot routing — but checking the
actual numbers (997.9m in 105.1s, ≈34 km/h) showed it was silently serving
its driving profile regardless of the URL. Using that data would have quietly
corrupted every downstream number (slack, interrupt threshold, commit point)
with car-speed timings labelled as walking times. Fixed by verifying a
second candidate instance against a sanity check (distance/duration ⇒ speed)
*before* trusting it — 719.4m in 577.5s (≈4.5 km/h) confirmed it's genuinely
foot-profile. The home/office coordinates were also recalibrated against real
routed distances rather than a straight-line guess, since real footpaths
turned out to run ~2x longer than the beeline distance in this area — an
uncalibrated guess had pushed Rachel's slack negative (i.e. the app would
have thought she's always late, even with zero disruption).

**What's still placeholder:** the MRT segment itself (Tampines → Raffles
Place) is still the straight-line, hand-picked-`cumMinutes` polyline from
before — only the two walking legs use real OSM routing so far. A real rail
alignment would mean pulling the EWL's actual track geometry via the
Overpass API, not yet attempted.

## Door-to-door routing

Rachel's journey is now home → Tampines (walk) → EWL → Raffles Place → office
(walk), not station-to-station — see PS2_README §3.2.1: *"a route that starts
at a station and ends at a station is not a commuter's journey."*
`normalJourneyMinutes` (51) and `slackMinutes` (9) both now include the two
walking legs, so the Interruption Budget Engine's threshold reflects her real
door-to-door margin, not just the MRT portion.

**What's real vs. placeholder:** the two walking legs (`rachel.ts`'s
`walk.home`/`walk.office`) are straight lines with a hand-picked minutes
estimate, not real OSM/OneMap pedestrian routing (footways, crossings,
stairs, covered walkways). The mandatory door-to-door *requirement* is met
structurally; the walking *routes themselves* are not yet real — OneMap's
routing API (walk mode) is where that slots in next.

## The Interruption Budget Engine

```
slack = (deadline - departure) - normal_journey_time - buffer
interrupt = predicted_delay > slack
```

`predicted_delay` now reads the delay directly out of the notice text where
it's stated (`delayExtractor.ts`), instead of guessing from `Status` alone.
This is grounded in the official `LTA_DataMall_API_User_Guide.pdf` Annex C
worked example, which shows LTA's real notices consistently stating the
figure: *"Additional travelling time of 20 minutes between Boon Keng and
Dhoby Ghaut stations towards HarbourFront station due to a signal fault."*
A regex over that pattern (plus a couple of generic "delay of N minutes"
variants) extracts the number; `decision.delaySource` in the API response
(and shown in the UI) reports whether the figure came from the text
(`"message-text"`) or the `Status`-keyed fallback (`"status-fallback"`, for
notices that don't state a duration — e.g. a flat "No train service between
X and Y").

**Why regex instead of an LLM here:** the number is already in the text: an
LLM call would be guessing at something the notice states outright, which is
both unnecessary and harder to defend to a judge than "we read the number
LTA already published." This is the "well-argued decision not to use a
model" case the brief credits (§3.3.1). An LLM still earns its place for
notices that *don't* state a number — see "Not yet built" below.

**The fallback classifier, for notices with no stated number:** `advice.ts`
calls Gemini with a JSON schema (`delayMinutes`, `oneLineAction`) when
`delayExtractor` returns null — e.g. a flat "No train service between X and
Y" with no duration stated. Only reached on that harder path; `decide()`
still tries the regex first unconditionally (see above). Falls back to
`DELAY_MINUTES_BY_STATUS` (the original 2-value heuristic) if there's no
`GEMINI_API_KEY`, or the call fails for any reason — an LLM outage should
never take the whole app down.

**Eval — the actual number, not a claimed one:** `scripts/evalAdvice.ts`
(`npm run eval:advice`) runs `getAdvice()` against
`adviceEvalDataset.ts`, a 16-example labelled set: 4 real notices pulled
from `t.me/s/sgmrt` (deduped from ~20 raw reposts across 2 real disruption
episodes — the channel is quiet most days, exactly as PS2_README §2.4
warns) plus 12 synthetic examples written in LTA's real phrasing style for
fault-type diversity the quiet real feed doesn't currently offer, clearly
disclosed as synthetic in the dataset file itself. Ground truth is a
*bucket* (minor ≤15 min / major >15 min implied), not an exact minute
figure — there's no way to know the true added travel time a historical
notice caused, only the qualitative severity LTA's own text implies.
Result: **16/16 (100%) overall, 4/4 (100%) on the real-only subset.**
Read this as "correctly separates minor from major on the notice styles
we could evaluate," not as a general accuracy claim — 4 real examples
from 2 episodes is a small, honest sample, not a statistically powerful
one, and severity classification is an easier task than exact-minutes
estimation.

**A real mistake worth recording, same discipline as the OSRM and
PV/Train ones below:** the eval's first run came back 16/16 *failures*
("no response"), not passes. The obvious suspects — bad prompt, broken
JSON schema — were wrong. The actual cause, found by calling the API
directly outside the app and reading the 429 body instead of guessing:
free-tier `gemini-3.6-flash` (the model in place at the time) is capped
at **20 requests/day** (`quotaId:
GenerateRequestsPerDayPerProjectPerModel-FreeTier`), not the 5/minute the
code had assumed — a handful of calls made during earlier development
had already exhausted the day's quota before the eval script's own 16
calls ran, so every one hit 429 uniformly. Confirmed the quota is
per-model, not per-key (a 429 on one model doesn't block another), by
calling a second model directly and getting a real response back. Fixed
by switching `advice.ts`'s default (`GEMINI_MODEL`) to
`gemini-3.5-flash-lite` — a separate quota bucket — rather than just
waiting out the daily cap or pacing harder, which wouldn't have helped
against a per-day (not per-minute) limit. Re-ran clean: 16/16. This is
also why `.env.example` now says explicitly that a 429 means "try a
different model," not "the key is dead."

## The commit-point detector

The core mechanic isn't just "suppress unless it matters" — when the engine
does interrupt Rachel, it also finds the last station along her route at
which switching to an alternate route still beats riding out the delay:

```
for each station S, walking Tampines -> Raffles Place:
  remaining        = destination.cumMinutes - S.cumMinutes
  stay_time(S)      = predicted_delay + remaining
  reroute_time(S)   = alternate_route_minutes(S)     # OneMap, cached at boot
  if reroute_time(S) < stay_time(S): commit_point = S  # keep overwriting
```

The loop keeps overwriting `commit_point` as long as switching is still
worthwhile, so after the loop it holds the *last* station where that was
true — the moment past which staying put is strictly faster. This is
deliberately arithmetic, not a model: the only place ML belongs in this
pipeline is estimating `predicted_delay`, and doing the commit-point math as
plain arithmetic over cached numbers keeps it explainable to both Rachel and
a judge (no black box between "here's a disruption" and "switch by Paya
Lebar").

**What's real vs. placeholder right now:** `alternates.ts`'s per-station
alternate-route minutes are hand-picked, not fetched from OneMap — chosen so
a major disruption's commit point lands at a plausible mid-route station for
the demo. `rachel.ts`'s per-station `cumMinutes` are similarly hand-picked,
not a measured EWL timetable. Both are cheap to replace once real data is
wired in (`warmAlternatesCache()` and the station table respectively) without
touching the commit-point logic itself.

**No live position signal.** MRT trains have no public real-time position
feed (unlike buses via `v3/BusArrival`'s `Load`/ETA data), and GPS doesn't
work underground regardless — so rather than trying to track Rachel live,
the plan is to estimate her position from elapsed time against the published
segment schedule once that's real. Not yet implemented; today the detector
only answers "if a disruption starts now, what's the commit point," not
"where is Rachel relative to it."

## Offline handling ("no signal underground")

PS2_README §2.6 asks for an explicit choice here, not a caveat. This does
two things together:

1. **Service worker** (`web/public/sw.js`) — cache-first for OSM map tiles
   (so a map segment she's already scrolled through stays visible), and
   network-first-with-cache-fallback for the app shell itself (so reloading
   the page while offline doesn't hit a blank browser error). `/api/*` is
   deliberately never cached by the service worker — that would let stale
   live data masquerade as fresh.
2. **App-level cache + explicit staleness label** (`App.tsx`) — every
   successful `/api/status` response is saved to `localStorage`. When a
   fetch fails, the app falls back to that cached journey instead of going
   blank, and shows a banner: *"Signal lost — showing your update from N min
   ago."* This is the "cache the current journey" and "say plainly that it
   is stale" options from §2.6, done together rather than choosing one.

A **"Simulate signal loss" demo button** forces this path without needing to
physically kill the phone's network mid-demo — labelled the same way the
mock disruption injectors are, so it's clearly a test control, not something
a real commuter sees.

**Known limitation:** there's no speculative "precompute next decision point
at every upcoming station" logic (the original pitch's idea) — what's cached
is only the last real server response, not a forward-looking decision tree.
That's a meaningfully bigger feature; this is the simpler, honest version of
"don't go blank when the signal drops."

## Uncertainty visualization

`predictedDelayMinutes` was a single confident number — exactly what
PS2_README §3.2.1 warns against ("realistic timing, with the uncertainty
made visible rather than hidden behind a single confident number"). It's now
a range (`decision.predictedDelayRange`, `engine.ts::delayRange()`), shown
both in the message text ("+15–39 min expected") and as a visual band
(`DelayRangeBar.tsx`) — a track with a coloured band for the low–high range
and a marked point for the "most likely" figure, not just prose.

The bounds are a deliberately simple heuristic, not a model: `message-text`
delays (a number LTA stated) get a range skewed toward resolving faster than
stated (0.5×–1.3× the stated figure) — grounded in the same Annex C worked
example used for the delay extractor, where a stated "40 min" resolved in
meaningfully less real elapsed time. `status-fallback` delays (no number
stated at all) get a much wider band (0.3×–2×), reflecting genuinely lower
confidence in a guess with no textual basis. **Known simplification:** the
interrupt decision and commit-point detector still use the point estimate,
not the range — only the display layer is range-aware so far.

## Crowding

`PCDRealTime` is polled per-line every 10 minutes (matching its published
refresh rate) and cached server-side (`crowding.ts`); `/api/status` returns
one `l`/`m`/`h`/`NA` level per station on Rachel's route. The UI renders it
as a one-row strip of coloured badges with a letter in each (not colour
alone — see PS2_README §3.2.3's accessibility note), always visible above
the map on both the calm and alert screens. This satisfies §3.2.3's mandatory
"crowding rendered in a way that is readable in one second" requirement,
which was previously unimplemented — DataMall's crowd data had never been
touched before this. `PCDForecast` (30-min-interval forecast, published
daily) is not wired in yet — only the real-time endpoint.

### Historical baseline (PV/Train)

Raw L/M/H has no context — a judge (or Rachel) can't tell whether "high" at
a given station is normal for that hour or genuinely unusual. `PV/Train`
(§2.4's "historical baseline" data) is fetched monthly, unzipped and parsed
(`pvTrainBaseline.ts`), and each station's own 24 weekday hours are split
into thirds (low/typical/high) — comparing a station only against its own
day, never against another station, since raw tap volume isn't comparable
across a small station and a major interchange. `/api/status` returns this
alongside live crowding; the UI shows a small dot under a station's badge
when live crowding is "high" at an hour that's normally quiet there — real
divergence from real data, not decoration.

**A real mistake worth recording, like the OSRM one:** this was built for a
public dataset (originally floated as a stand-in for personal routine
learning — see "Method B" discussion, which doesn't work since `PV/Train`
is aggregate, not per-rider). Two more mistakes surfaced building it,
neither caught by just trusting the API guide:

- The guide's own Annex A sample writes merged interchange codes with a
  hyphen ("EW14-NS26"). The real data uses a slash ("EW14/NS26") — and the
  component order isn't consistent ("NS25/EW13" but "EW14/NS26").
- More surprising: **Tampines (EW2) and Paya Lebar (EW8) are also merged
  interchange codes** in this dataset ("EW2/DT32", "EW8/CC9") — not
  something the API guide hints at anywhere, and not something either of us
  knew going in. A hardcoded interchange list would have silently shown "no
  data" for two ordinary, busy stations.

Fixed by not hardcoding a mapping at all: every row's `PT_CODE` is split on
`/` and matched by component against Rachel's station codes
(`pvCodeComponents()`), so it's correct regardless of which stations turn
out to be merged. Verified by dumping the real CSV's unique codes and
checking by hand before trusting the result — same discipline as the OSRM
walking-route fix.

## Regular-day value and persona preference (response to the NebulaX PS2 FAQ)

The published FAQ for this problem statement clarified something the
original build had gotten wrong: *"this problem statement is about a
generic travel companion app... why would it want to download your app on
a regular day?"* — and separately, *"explore how your app might cater to
different persona and think through how you would know what persona type
your user is."* Everything above this section was built around a single
answer to "why open the app" — a disruption breaking Rachel's buffer. On
an ordinary day (the overwhelming majority of days), the app had nothing
to say beyond "Good morning, Rachel" and a passive crowding strip. That's
a real gap, not a matter of framing.

**The fix, scoped to what's buildable without inventing new route
topology:** `src/lib/comfort.ts` promotes a signal that already
existed only as a small decorative dot (`CrowdingStrip.tsx`'s "unusual"
marker — live crowding reading `high` at a station whose real PV/Train
baseline says it's normally quiet at this hour) into an actual
suggestion, using data and functions already built for the disruption
path rather than modelling a second route from scratch:
`alternates.ts`'s per-station alternate-route minutes (built for the
commit-point detector) doubles as "here's what the quieter option costs
you in time" — `+N min, avoids the crowd` — computed and shown even when
`decision.interrupt` is `false`. This is the direct answer to "least
crowded route even if longer": a real number, not a vague nudge, reusing
data the app already had rather than adding a second unverified data
source under time pressure.

**The persona mechanism:** rather than hardcoding a second named
character (unconvincing without real user research to back it, and a
larger build than the time available allowed), the app asks directly —
a **Speed / Comfort** toggle, always visible in the header, persisted
per-device. This is the literal answer to "how would you know what
persona type your user is": ask once, act on it, rather than infer it
from behaviour the app has no way to observe reliably anyway. Speed
(the default, matching Rachel's own stated priority) shows the comfort
suggestion as a small secondary note; Comfort promotes it to the
headline, replacing "Good morning, Rachel" with the actionable
suggestion on days when one is available. Same underlying data either
way — the toggle changes what's foregrounded, not what's computed.

**Demand/supply matching, honestly scoped:** the FAQ also asks how the
app "helps incentivise matching of demand for public transport service
with supply." This feature is a first, narrow answer — nudging
comfort-preferring commuters off an unusually crowded segment onto an
alternate route redistributes load rather than just reporting it — but
it's a single-user nudge, not a system that reasons about aggregate
demand. A real answer to that question (e.g. time-of-departure nudges
informed by crowding forecasts, not just current-station-crowding) is a
larger build than fit in the time available; flagged here rather than
overclaimed.

**Demoable on request:** since a genuinely "high crowding at a normally-
quiet hour" moment isn't guaranteed to be happening live, `POST
/api/mock/crowding` (paired with the "Simulate unusually busy station"
demo button, same pattern as the disruption injectors) forces the tip
directly rather than trying to fake both the live reading and hope the
real PV/Train baseline cooperates — same reasoning PS2_README §2.6
already gives for the disruption mocks.

## Assumptions

- Station coordinates and walking-leg coordinates/times are hand-placed
  approximations (see README "Known gaps"), not yet sourced from the
  provided GeoJSON or OneMap.
- "Normal journey time" (51 min = 7 walk + 38 MRT + 6 walk) is an estimate,
  not measured from `PV/*` historical data or a real timetable yet.
- Single line (EWL), single direction, single persona — deliberate scope cut,
  not an oversight.

## Labelled synthetic data

The demo's "Inject minor/major disruption" buttons construct a
`TrainServiceAlerts`-shaped payload in `server/src/state.ts::injectMock`. The
UI tags any response built from this path as `Simulated disruption — demo
only` (`source: "mock"` in the API response) — see PS2_README §2.6, which
permits this because the real feed's `AffectedSegments` is empty most days.

## Known limitations

See README.md "Known gaps in this scaffold" — real station geometry,
richer offline caching, and multi-persona support are not yet implemented.
The LLM fallback classifier (see "The fallback classifier" above) is
implemented and evaluated (16/16 on the labelled set, 4/4 real-only) —
its main limitation is the real-notice sample size (4, from 2 episodes),
not accuracy on what could be measured.
