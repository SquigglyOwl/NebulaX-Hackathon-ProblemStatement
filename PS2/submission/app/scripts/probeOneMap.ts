// One-off live check of the OneMap assumptions alternates.ts makes — run:
//   npm run probe:onemap
// Needs ONEMAP_EMAIL / ONEMAP_PASSWORD in .env. Prints the response *shape* and
// durations only, never the token.
import { readFileSync } from "fs";
import { resolve } from "path";

function loadDotEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, "../.env"), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // no .env
  }
}

const BASE = "https://www.onemap.gov.sg/api";

// Trim a JSON value to its structure so we can see field names without a wall of text.
function shape(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `(${v.length} items)`] : [];
  if (v && typeof v === "object") {
    if (depth > 3) return "{…}";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v === "string" && v.length > 40 ? v.slice(0, 40) + "…" : v;
}

async function main() {
  loadDotEnv();
  let token = process.env.ONEMAP_TOKEN;
  if (token) {
    console.log("auth: using ONEMAP_TOKEN from .env (skipping login)");
  } else {
    if (!process.env.ONEMAP_EMAIL || !process.env.ONEMAP_PASSWORD) {
      console.error("Set ONEMAP_TOKEN, or ONEMAP_EMAIL and ONEMAP_PASSWORD, in .env first.");
      process.exitCode = 1;
      return;
    }
    const authRes = await fetch(`${BASE}/auth/post/getToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: process.env.ONEMAP_EMAIL, password: process.env.ONEMAP_PASSWORD }),
    });
    const auth = (await authRes.json()) as Record<string, unknown>;
    console.log(`auth: HTTP ${authRes.status}, fields: ${Object.keys(auth).join(", ")}, expiry_timestamp=${auth.expiry_timestamp}`);
    if (!auth.access_token) {
      console.log("no access_token — response was:", JSON.stringify(auth).replace(/"[^"]*token[^"]*":"[^"]*"/gi, '"…":"…"'));
      process.exitCode = 1;
      return;
    }
    token = auth.access_token as string;
  }

  // Next weekday morning, MM-DD-YYYY.
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  const date = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;

  // Bedok station -> Raffles Place station (real centroids from stationCoords.json).
  for (const mode of ["BUS", "TRANSIT"]) {
    const params = new URLSearchParams({
      start: "1.32401,103.93018",
      end: "1.28407,103.85146",
      routeType: "pt",
      mode,
      date,
      time: "08:00:00",
      maxWalkDistance: "1000",
      numItineraries: "3",
    });
    // Try the raw token first (what alternates.ts sends), then "Bearer <token>".
    for (const header of [token, `Bearer ${token}`]) {
      const res = await fetch(`${BASE}/public/routingsvc/route?${params}`, { headers: { Authorization: header } });
      const label = header === token ? "raw token" : "Bearer";
      console.log(`\n[${mode}] ${label}: HTTP ${res.status}`);
      if (!res.ok) {
        console.log((await res.text()).slice(0, 200));
        continue;
      }
      const body = await res.json();
      console.log("shape:", JSON.stringify(shape(body), null, 1));
      const its = body?.plan?.itineraries as { duration?: number; walkTime?: number; legs?: { mode?: string; route?: string; routeShortName?: string; duration?: number }[] }[] | undefined;
      if (its) {
        for (const it of its) {
          console.log(
            `  itinerary duration=${it.duration} (${it.duration ? (it.duration / 60).toFixed(1) : "?"} min if seconds); legs: ${it.legs?.map((l) => `${l.mode}${l.route ?? l.routeShortName ? ":" + (l.route ?? l.routeShortName) : ""}`).join(" > ")}`,
          );
        }
      }
      break; // the first header style that works is enough
    }
  }
}

main();
