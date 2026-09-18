// Runs advice.ts's getAdvice() against the labelled dataset and reports
// accuracy — the actual number that belongs in WRITEUP.md's AI section,
// not a claimed-but-unmeasured figure. Run with: npm run eval:advice
// (needs GEMINI_API_KEY in .env — see .env.example).
import { readFileSync } from "fs";
import { resolve } from "path";
import { getAdvice } from "../src/lib/advice";
import { ADVICE_EVAL_DATASET, type Bucket } from "../src/lib/adviceEvalDataset";

// Standalone script — Next.js loads .env for its own runtime automatically,
// but this script runs outside that, so load it manually rather than add a
// dotenv dependency for one file.
function loadDotEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, "../.env"), "utf-8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  } catch {
    // no .env — fine if GEMINI_API_KEY is set some other way
  }
}

function bucketOf(delayMinutes: number): Bucket {
  return delayMinutes > 15 ? "major" : "minor";
}

async function main() {
  loadDotEnv();

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set — nothing to evaluate. See .env.example.");
    process.exit(1);
  }

  let correct = 0;
  let realCorrect = 0;
  let realTotal = 0;
  const rows: string[] = [];

  // The real binding constraint turned out to be per-model, per-DAY quota
  // (confirmed via a real 429 body naming
  // GenerateRequestsPerDayPerProjectPerModel-FreeTier, limit 20), not a
  // per-minute rate — gemini-3.6-flash's daily cap was exhausted by a
  // handful of dev-testing calls alone, well before this script's own 16
  // calls ran. advice.ts's default model was switched to
  // gemini-3.5-flash-lite (separate quota bucket) to get unblocked. 20s
  // spacing is kept as courteous pacing against per-minute bursts, but it
  // does NOT protect against exhausting a small daily cap — if this starts
  // failing uniformly again, check for RESOURCE_EXHAUSTED / "PerDay" in the
  // error body before assuming pacing is the problem.
  const PACING_MS = 20_000;

  for (let i = 0; i < ADVICE_EVAL_DATASET.length; i++) {
    const example = ADVICE_EVAL_DATASET[i];
    if (i > 0) await new Promise((r) => setTimeout(r, PACING_MS));
    const advice = await getAdvice(example.text);
    let row: string;
    if (!advice) {
      row = `FAIL (no response) — ${example.note}`;
    } else {
      const gotBucket = bucketOf(advice.delayMinutes);
      const isCorrect = gotBucket === example.expectedBucket;
      if (isCorrect) correct++;
      if (example.isReal) {
        realTotal++;
        if (isCorrect) realCorrect++;
      }
      row = `${isCorrect ? "✓" : "✗"} [${example.isReal ? "real" : "synth"}] expected=${example.expectedBucket} got=${gotBucket} (${advice.delayMinutes}min) — ${example.note}`;
    }
    rows.push(row);
    console.log(`(${i + 1}/${ADVICE_EVAL_DATASET.length}) ${row}`);
  }

  console.log("");
  console.log("=== Full results ===");
  console.log(rows.join("\n"));
  console.log("");
  console.log(`Overall: ${correct}/${ADVICE_EVAL_DATASET.length} (${Math.round((correct / ADVICE_EVAL_DATASET.length) * 100)}%)`);
  console.log(`Real-only: ${realCorrect}/${realTotal} (${realTotal ? Math.round((realCorrect / realTotal) * 100) : 0}%)`);
}

main();
