// Pulls a stated delay figure straight out of a TrainServiceAlerts notice's
// text, instead of guessing from `Status` alone. LTA's real notices are
// fairly consistent about stating this explicitly — confirmed against the
// official Annex C worked example in LTA_DataMall_API_User_Guide.pdf:
//
//   "1657hrs : NEL - Additional travelling time of 20 minutes between Boon
//   Keng and Dhoby Ghaut stations towards HarbourFront station due to a
//   signal fault."
//
// When a notice doesn't state a number (e.g. a flat "No train service
// between X and Y"), this returns null and the caller falls back to the
// Status-keyed heuristic in engine.ts. Deliberately regex, not an LLM call —
// the number is already in the text; extracting it needs no model, no API
// key, and is easier to defend than an LLM "guessing" at a stated fact. See
// WRITEUP.md.
const PATTERNS: RegExp[] = [
  /additional travelling time of\s*(\d+)\s*minutes?/i,
  /delay(?:ed)? (?:of|by)\s*(\d+)\s*minutes?/i,
  /(\d+)\s*minutes?\s*(?:delay|slower|longer)/i,
];

export interface ExtractedDelay {
  minutes: number;
  matchedText: string;
}

// `messages` is assumed ordered most-recent-first, matching how
// TrainServiceAlerts.Message is published (see Annex C, Step 6) — the
// newest notice is checked, and therefore trusted, first.
export function extractDelayMinutes(
  messages: { Content: string }[],
): ExtractedDelay | null {
  for (const msg of messages) {
    for (const pattern of PATTERNS) {
      const match = msg.Content.match(pattern);
      if (match) {
        const minutes = Number(match[1]);
        if (Number.isFinite(minutes) && minutes > 0) {
          return { minutes, matchedText: match[0] };
        }
      }
    }
  }
  return null;
}
