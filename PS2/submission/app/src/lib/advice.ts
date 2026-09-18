// LLM fallback classifier — only used when delayExtractor.ts's regex finds
// no stated delay figure in the notice text (e.g. a flat "No train service
// between X and Y due to a signal fault", vs. "...additional travelling
// time of 20 minutes..."). The regex path is preferred and unconditionally
// tried first (engine.ts) — this exists for the harder case regex can't
// handle: turning free text into a number and a one-line action when
// nothing is stated outright.
//
// Endpoint verified directly against Google's own API reference
// (ai.google.dev/api/generate-content) before writing this, not assumed
// from training data — model names in this space go stale fast, so it's
// read from GEMINI_MODEL with a fallback rather than hardcoded once.
// gemini-2.0-flash (an earlier default here) turned out to be already
// retired — caught via a real 404 from the API itself, which named
// gemini-3.6-flash as the replacement.
//
// gemini-3.6-flash itself was then dropped as the default after hitting a
// real 429 whose body named the actual binding limit: free-tier
// gemini-3.6-flash is capped at 20 requests/DAY (quotaId
// GenerateRequestsPerDayPerProjectPerModel-FreeTier), not the 5/minute this
// file previously assumed — a couple dev calls per day exhausts it, and the
// quota is per-model (a 429 on one model doesn't block another), which is
// exactly what makes switching the default the fix rather than pacing
// harder. gemini-3.5-flash-lite verified working with quota headroom left
// after 3.6-flash's daily cap was already hit — used as the new default.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface Advice {
  delayMinutes: number;
  oneLineAction: string;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    delayMinutes: {
      type: "integer",
      description: "Best-estimate extra travel time in minutes this notice implies, even if not stated explicitly. Use domain knowledge: 'no train service' implies a longer delay than 'trains running slower'.",
    },
    oneLineAction: {
      type: "string",
      description: "One short, concrete sentence telling a commuter what to do — not a summary of the notice.",
    },
  },
  required: ["delayMinutes", "oneLineAction"],
};

const SYSTEM_PROMPT = `You are reading an official LTA/SMRT train service notice for Singapore's MRT. The notice does NOT state a delay duration explicitly (if it did, a simpler regex step would have already handled it — you only see the hard cases). Estimate a reasonable delayMinutes figure from context (fault type, whether service is fully suspended vs. slowed, whether shuttle buses were activated) and give one concrete oneLineAction a commuter should take. Respond only via the provided JSON schema.`;

export async function getAdvice(noticeText: string): Promise<Advice | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    // One retry on a transient overload (verified this happens in practice —
    // hit a real 503 "high demand" mid-development) before giving up and
    // falling back to the heuristic. Not retried for other error codes
    // (e.g. 400/401 would just fail the same way again).
    let res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nNotice: "${noticeText}"` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nNotice: "${noticeText}"` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      });
    }
    if (!res.ok) throw new Error(`Gemini ${res.status} ${res.statusText}`);

    const body = await res.json();
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(text);
    if (typeof parsed.delayMinutes !== "number" || typeof parsed.oneLineAction !== "string") return null;
    return { delayMinutes: Math.max(1, Math.round(parsed.delayMinutes)), oneLineAction: parsed.oneLineAction };
  } catch {
    // Network/parse/quota failure — caller falls back to the status-keyed
    // heuristic. An LLM outage should never take the whole app down.
    return null;
  }
}
