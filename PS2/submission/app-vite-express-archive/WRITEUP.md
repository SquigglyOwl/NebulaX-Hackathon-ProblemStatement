# Write-up (draft)

## Persona

Building for **Rachel** — the fixed-schedule commuter (Tampines → Raffles
Place, EWL, leaves 07:40, must be at her desk by 08:45). Chosen because a
fixed origin/destination/deadline makes "does this disruption actually cost
her something" a tractable, demoable calculation, and because her stated need
— "interrupted only when it matters, told what to do in one line" — maps
directly onto a decision layer rather than a status feed.

## Architecture (current scaffold)

- `server/` — Express. Polls `TrainServiceAlerts` every 60s, holds the latest
  feed (or a labelled mock override) in memory, runs the Interruption Budget
  Engine (`engine.ts`) against Rachel's hardcoded door-to-door journey, and
  exposes `GET /api/status` + `POST /api/mock/inject|clear`.
- `web/` — Vite + React. Polls `/api/status` every 15s. The map (Leaflet over
  OSM tiles) is always shown, not just during a disruption — it renders the
  full door-to-door route (walk → EWL → walk); only the card above it and the
  affected-segment/commit-point highlighting change with `decision.interrupt`.

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

**Not yet built:** a fallback classifier (LLM or a fault-type → historical-
duration lookup) for notices where `delayExtractor` returns null, evaluated
against a hand-labelled sample from the SG MRT Telegram archive (t.me/s/sgmrt)
with an accuracy figure reported here once built.

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

See README.md "Known gaps in this scaffold" — LLM classifier, real station
geometry, offline caching, and multi-persona support are not yet implemented.
