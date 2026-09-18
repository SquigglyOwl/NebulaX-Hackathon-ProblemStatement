// Offline checks for alternates.ts, rideTimes.ts and the commit-point logic —
// run: npm run check:alternates
//
// Stubs global fetch with OneMap-shaped responses, so this verifies OUR logic
// (query construction, caching, fallback, sanity guard, commit point) but not
// that the real API's response matches the shape we assumed. Do that once with
// real credentials: set ONEMAP_EMAIL/ONEMAP_PASSWORD in .env and hit /api/status.
import assert from "node:assert/strict";
import { getAlternateMinutes, getAlternates, getBusHopMinutes, parseItineraryMinutes, resetAlternatesMemo } from "../src/lib/alternates";
import { computeCommitPoint } from "../src/lib/engine";
import { nextWeekdaySgt } from "../src/lib/onemap";
import { RACHEL_JOURNEY } from "../src/lib/rachel";
import { getRideTimes, parseEwlRideSeconds, resetRideTimesMemo } from "../src/lib/rideTimes";
import { deleteKey } from "../src/lib/store";

const realFetch = globalThis.fetch;
const calls: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// A plausible bus itinerary between any two points: ~12 km/h plus 10 min of waiting/walking/transfers
// (live OneMap gave 48 min for the ~8 km Kembangan -> Raffles Place bus trip, so real buses are slow).
function busSecondsFor(url: URL): number {
  const [lat1, lng1] = url.searchParams.get("start")!.split(",").map(Number);
  const [lat2, lng2] = url.searchParams.get("end")!.split(",").map(Number);
  const km = Math.hypot((lat1 - lat2) * 111, (lng1 - lng2) * 111 * Math.cos(1.3 * (Math.PI / 180)));
  return (km / 12) * 3600 + 10 * 60;
}
function busBody(url: URL): Response {
  return json({ plan: { itineraries: [{ duration: busSecondsFor(url) }] } });
}

function stubOneMap(routeBody: (url: URL) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/auth/post/getToken")) {
      return json({ access_token: "tok", expiry_timestamp: String(Math.floor(Date.now() / 1000) + 3 * 86400) });
    }
    assert.equal((init?.headers as Record<string, string>)?.Authorization, "tok", "route call must send the token");
    return routeBody(url);
  }) as typeof fetch;
}

async function reset() {
  calls.length = 0;
  resetAlternatesMemo();
  resetRideTimesMemo();
  await deleteKey("alternates:v1");
  await deleteKey("rideTimes:v1");
  await deleteKey("onemap:token:v1");
  // Per-pair bus-hop cache (keys are per (from, to), so clear every pair).
  for (const a of RACHEL_JOURNEY.stations) {
    for (const b of RACHEL_JOURNEY.stations) await deleteKey(`busHop:v1:${a.code}:${b.code}`);
  }
}

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await reset();
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

async function main() {
  delete process.env.UPSTASH_REDIS_REST_URL; // force the in-memory store
  delete process.env.ONEMAP_TOKEN; // a real token in the shell would bypass the auth-call checks
  process.env.ONEMAP_RETRY_BASE_MS = "1"; // 429 backoff without real waiting

  await check("pure: nextWeekdaySgt skips the weekend and formats MM-DD-YYYY", async () => {
    // Fri 2026-09-18 12:00 SGT -> next weekday is Mon 2026-09-21
    assert.equal(nextWeekdaySgt(new Date("2026-09-18T04:00:00Z")).date, "09-21-2026");
    // Late Thu UTC that is already Fri in SGT -> Mon
    assert.equal(nextWeekdaySgt(new Date("2026-09-17T17:00:00Z")).date, "09-21-2026");
    assert.equal(nextWeekdaySgt(new Date("2026-09-14T04:00:00Z")).date, "09-15-2026");
  });

  await check("pure: parseItineraryMinutes", async () => {
    assert.equal(parseItineraryMinutes({ plan: { itineraries: [{ duration: 3000 }, { duration: 2400 }] } }), 40);
    assert.equal(parseItineraryMinutes({ plan: { itineraries: [] } }), null);
    assert.equal(parseItineraryMinutes({ error: { msg: "PATH_NOT_FOUND" } }), null);
    assert.throws(() => parseItineraryMinutes({ something: "else" }));
  });

  await check("no credentials -> placeholder table, reported as fallback, zero network calls", async () => {
    delete process.env.ONEMAP_EMAIL;
    delete process.env.ONEMAP_PASSWORD;
    stubOneMap(() => assert.fail("must not hit the network without credentials"));
    const alt = await getAlternates();
    assert.equal(alt.source, "fallback");
    assert.match(alt.error ?? "", /not set/);
    assert.equal(await getAlternateMinutes("EW2"), 60);
    assert.equal(calls.length, 0);
  });

  await check("destination station never has an alternate (was a latent bug)", async () => {
    assert.equal(await getAlternateMinutes("EW14"), Infinity);
  });

  await check("with credentials -> one auth + 12 bus-mode route calls, then served from cache", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    let last: URL | null = null;
    stubOneMap((url) => {
      last = url;
      return busBody(url);
    });
    const alt = await getAlternates();
    assert.equal(alt.source, "onemap");
    assert.equal(alt.error, null);
    assert.equal(calls.filter((c) => c.includes("getToken")).length, 1);
    assert.equal(calls.filter((c) => c.includes("routingsvc/route")).length, 12); // 13 stations minus destination
    const p = last!.searchParams;
    assert.equal(p.get("mode"), "BUS");
    assert.equal(p.get("routeType"), "pt");
    assert.match(p.get("date")!, /^\d{2}-\d{2}-\d{4}$/);
    assert.match(p.get("time")!, /^\d{2}:\d{2}:00$/);
    // Farther from the destination should not be quicker than nearer.
    assert.ok((alt.minutes.EW2 as number) > (alt.minutes.EW13 as number));

    const before = calls.length;
    resetAlternatesMemo(); // force a re-resolve: must come from the store, not the network
    await getAlternates();
    assert.equal(calls.length, before, "second resolve must be a cache hit");
  });

  await check("network/HTTP failure -> falls back and reports the error", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    stubOneMap(() => json({ message: "boom" }, 500));
    const alt = await getAlternates();
    assert.equal(alt.source, "fallback");
    assert.match(alt.error ?? "", /OneMap route/);
    assert.equal(await getAlternateMinutes("EW5"), 52);
  });

  await check("implausible duration (wrong-unit guard) -> falls back, not confident nonsense", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    stubOneMap(() => json({ plan: { itineraries: [{ duration: 40 }] } })); // "40 minutes" misread as 40 seconds
    const alt = await getAlternates();
    assert.equal(alt.source, "fallback");
    assert.match(alt.error ?? "", /implausible/);
  });

  await check("OneMap finds no bus route for a station -> null -> treated as no alternate", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    stubOneMap((url) =>
      url.searchParams.get("start")!.startsWith("1.3432") // Simei
        ? json({ error: "PATH_NOT_FOUND" })
        : busBody(url),
    );
    const alt = await getAlternates();
    assert.equal(alt.source, "onemap");
    assert.equal(alt.minutes.EW3, null);
    assert.equal(await getAlternateMinutes("EW3"), Infinity);
  });

  await check("commit point: a long delay yields a station on the route; a short one yields none", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    stubOneMap((url) => busBody(url));
    const long = await computeCommitPoint(RACHEL_JOURNEY, 60);
    assert.ok(long, "a 60-min delay should leave at least one station where rerouting wins");
    assert.ok(RACHEL_JOURNEY.stations.some((s) => s.code === long.code));
    assert.notEqual(long.code, "EW14");
    assert.equal(await computeCommitPoint(RACHEL_JOURNEY, 0), null);
    console.log(`       (60-min delay -> commit by ${long.name})`);
  });

  await check("commit point never lands past the disrupted segment (regression: 'switch by City Hall')", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    stubOneMap((url) => busBody(url));
    const codes = RACHEL_JOURNEY.stations.map((s) => s.code);
    const commit = await computeCommitPoint(RACHEL_JOURNEY, 30, ["EW8", "EW9", "EW10"]);
    assert.ok(commit, "a 30-min delay ahead should leave a station to switch at");
    assert.ok(
      codes.indexOf(commit.code) < codes.indexOf("EW10"),
      `commit ${commit.code} is at/after the end of the disruption (EW10)`,
    );
    // Same delay with no segment info keeps the old behaviour (delay applies everywhere).
    const legacy = await computeCommitPoint(RACHEL_JOURNEY, 30);
    assert.ok(legacy && codes.indexOf(legacy.code) > codes.indexOf(commit.code));
  });

  // --- rideTimes.ts ---------------------------------------------------------

  // OneMap-shaped Tampines -> <station> itinerary with a single EW SUBWAY leg.
  // Duration grows with station index (130 s per stop ≈ 36-48 km/h, plausible).
  function ewlLeg(url: URL, over: { route?: string; secondsPerStop?: number; seconds?: Record<number, number> } = {}) {
    const [lat, lng] = url.searchParams.get("end")!.split(",").map(Number);
    const idx = RACHEL_JOURNEY.stations.findIndex((s) => s.lat === lat && s.lng === lng);
    const st = RACHEL_JOURNEY.stations[idx];
    return json({
      plan: {
        itineraries: [
          {
            duration: 999,
            legs: [
              {
                mode: "SUBWAY",
                route: over.route ?? "EW",
                duration: over.seconds?.[idx] ?? idx * (over.secondsPerStop ?? 130),
                from: { name: "TAMPINES MRT STATION" },
                to: { name: `${st.name.toUpperCase()} MRT STATION` },
              },
              { mode: "WALK", route: "", duration: 30, from: { name: "x" }, to: { name: "Destination" } },
            ],
          },
        ],
      },
    });
  }

  await check("pure: parseEwlRideSeconds picks the EW leg between the right stations", async () => {
    const body = {
      plan: {
        itineraries: [
          { legs: [{ mode: "SUBWAY", route: "DT", duration: 900, from: { name: "TAMPINES MRT STATION" }, to: { name: "BUGIS MRT STATION" } }] },
          { legs: [{ mode: "SUBWAY", route: "EW", duration: 1451, from: { name: "TAMPINES MRT STATION" }, to: { name: "BUGIS MRT STATION" } }] },
        ],
      },
    };
    assert.equal(parseEwlRideSeconds(body, "Tampines", "Bugis"), 1451); // ignores the DTL itinerary
    assert.equal(parseEwlRideSeconds(body, "Tampines", "City Hall"), null);
    assert.equal(parseEwlRideSeconds({ error: "PATH_NOT_FOUND" }, "Tampines", "Bugis"), null);
    assert.throws(() => parseEwlRideSeconds({ nope: 1 }, "Tampines", "Bugis"));
  });

  await check("ride times: no credentials -> hand-picked table, reported as fallback, no network", async () => {
    delete process.env.ONEMAP_EMAIL;
    delete process.env.ONEMAP_PASSWORD;
    stubOneMap(() => assert.fail("must not hit the network without credentials"));
    const r = await getRideTimes();
    assert.equal(r.source, "fallback");
    assert.equal(r.cumMinutes.EW14, RACHEL_JOURNEY.stations[12].cumMinutes);
    assert.equal(calls.length, 0);
  });

  await check("ride times: with credentials -> 12 TRANSIT queries from Tampines, measured minutes, cached", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    let last: URL | null = null;
    stubOneMap((url) => {
      last = url;
      return ewlLeg(url);
    });
    const r = await getRideTimes();
    assert.equal(r.source, "onemap");
    assert.equal(r.error, null);
    assert.equal(calls.filter((c) => c.includes("routingsvc/route")).length, 12);
    assert.equal(last!.searchParams.get("mode"), "TRANSIT");
    assert.equal(last!.searchParams.get("start"), `${RACHEL_JOURNEY.stations[0].lat},${RACHEL_JOURNEY.stations[0].lng}`);
    assert.equal(r.cumMinutes.EW2, 0);
    assert.equal(r.cumMinutes.EW3, Math.round(130 / 60)); // 2
    assert.equal(r.cumMinutes.EW14, Math.round((12 * 130) / 60)); // 26

    const before = calls.length;
    resetRideTimesMemo();
    await getRideTimes();
    assert.equal(calls.length, before, "second resolve must be a cache hit");
  });

  await check("ride times: OneMap picks a different line -> falls back, says why", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    stubOneMap((url) => ewlLeg(url, { route: "DT" }));
    const r = await getRideTimes();
    assert.equal(r.source, "fallback");
    assert.match(r.error ?? "", /no EW-line leg/);
  });

  await check("ride times: implausible speed (unit mix-up) -> falls back", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    stubOneMap((url) => ewlLeg(url, { secondsPerStop: 4 })); // ~1000+ km/h
    const r = await getRideTimes();
    assert.equal(r.source, "fallback");
    assert.match(r.error ?? "", /implausible/);
  });

  await check("ride times: out of order along the line -> falls back (each speed plausible on its own)", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    // Tanah Merah (idx 2) reported quicker than Simei (idx 1): 300 s vs 280 s, both a plausible speed.
    stubOneMap((url) => ewlLeg(url, { seconds: { 1: 300, 2: 280 } }));
    const r = await getRideTimes();
    assert.equal(r.source, "fallback");
    assert.match(r.error ?? "", /not increasing/);
  });

  // --- bus hops + bypass reroute -------------------------------------------

  await check("bus hop: one OneMap call per pair, cached; unconfigured or failing -> Infinity, never throws", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    let last: URL | null = null;
    stubOneMap((url) => {
      last = url;
      return busBody(url);
    });
    const first = await getBusHopMinutes("EW6", "EW7");
    assert.ok(Number.isFinite(first) && first >= 10, `expected a finite hop >= 10 min, got ${first}`);
    assert.equal(last!.searchParams.get("mode"), "BUS");
    const before = calls.length;
    assert.equal(await getBusHopMinutes("EW6", "EW7"), first);
    assert.equal(calls.length, before, "second lookup must be a cache hit");
    assert.equal(await getBusHopMinutes("EW6", "EW6"), Infinity);
    assert.equal(await getBusHopMinutes("EW6", "NOPE"), Infinity);

    stubOneMap(() => json({ message: "boom" }, 500));
    assert.equal(await getBusHopMinutes("EW5", "EW7"), Infinity); // uncached pair + failing API

    delete process.env.ONEMAP_EMAIL;
    delete process.env.ONEMAP_PASSWORD;
    calls.length = 0;
    assert.equal(await getBusHopMinutes("EW4", "EW7"), Infinity);
    assert.equal(calls.length, 0);
  });

  await check("bypass: a 30-min delay on Kembangan-Eunos -> switch at Kembangan, bus to Eunos, rejoin", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    stubOneMap(busBody);
    const commit = await computeCommitPoint(RACHEL_JOURNEY, 30, ["EW6", "EW7"]);
    assert.equal(commit?.code, "EW6");
    assert.equal(commit?.rejoin?.code, "EW7");
  });

  await check("bypass: without OneMap the same delay gets no bypass (whole-trip placeholder table only)", async () => {
    delete process.env.ONEMAP_EMAIL;
    delete process.env.ONEMAP_PASSWORD;
    // No OneMap: only the placeholder whole-trip table is available, so no rejoin can be offered.
    const commit = await computeCommitPoint(RACHEL_JOURNEY, 30, ["EW6", "EW7"]);
    assert.equal(commit?.rejoin, undefined);
  });

  await check("bypass: never chosen when the whole-trip bus is faster", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    // Hops are slow (2 h) but the whole-trip bus is quick (10 min): the commit must not claim a rejoin.
    stubOneMap((url) => {
      const [elat] = url.searchParams.get("end")!.split(",").map(Number);
      const dest = RACHEL_JOURNEY.stations[12];
      return json({ plan: { itineraries: [{ duration: elat === dest.lat ? 600 : 7200 }] } });
    });
    const commit = await computeCommitPoint(RACHEL_JOURNEY, 30, ["EW6", "EW7"]);
    assert.ok(commit, "a 10-min whole-trip bus beats a 30-min delay somewhere");
    assert.equal(commit.rejoin, undefined);
  });

  await check("rate limiting: 429s are retried (Retry-After honoured), then succeed; persistent 429 still fails cleanly", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    let attempts = 0;
    stubOneMap((url) => {
      attempts++;
      return attempts <= 2 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : busBody(url);
    });
    const hop = await getBusHopMinutes("EW6", "EW7");
    assert.ok(Number.isFinite(hop), "should succeed after two 429s");
    assert.equal(attempts, 3);

    attempts = 0;
    await reset();
    stubOneMap(() => {
      attempts++;
      return new Response("slow down", { status: 429 });
    });
    assert.equal(await getBusHopMinutes("EW6", "EW7"), Infinity);
    assert.equal(attempts, 4, "1 try + 3 retries, then give up");
  });

  await check("rate limiting: never more than 6 lookups in flight", async () => {
    process.env.ONEMAP_EMAIL = "a@b.c";
    process.env.ONEMAP_PASSWORD = "pw";
    let inFlight = 0;
    let peak = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/getToken")) return json({ access_token: "tok", expiry_timestamp: String(Math.floor(Date.now() / 1000) + 3 * 86400) });
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return busBody(url);
    }) as typeof fetch;
    await getAlternates(); // 12 lookups at once
    assert.equal((await getAlternates()).source, "onemap");
    assert.ok(peak <= 6 && peak >= 2, `peak in flight was ${peak}`);
  });

  globalThis.fetch = realFetch;
  console.log(process.exitCode ? "\nSome checks FAILED" : `\nAll ${passed} checks passed`);
}

main();
