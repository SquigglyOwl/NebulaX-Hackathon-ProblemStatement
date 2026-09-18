// Labelled eval set for advice.ts (getAdvice). Ground truth is a *bucket*
// (minor: implies ~1-15 min added travel time / major: implies >15 min),
// not an exact minute figure — we have no way to know the true added
// travel time a historical notice caused, only the qualitative severity
// LTA itself assigned in the text ("Minor delay" vs "Major delay"/"No
// train service"). "Correct" means getAdvice's delayMinutes falls in the
// same bucket as the notice's own stated severity.
//
// Only notices WITHOUT a stated delay figure are useful here — anything
// with a number (e.g. "Additional travelling time of 20 minutes...") is
// handled by delayExtractor.ts's regex before advice.ts is ever called;
// including those would evaluate the wrong code path.
export type Bucket = "minor" | "major";

export interface EvalExample {
  text: string;
  expectedBucket: Bucket;
  isReal: boolean;
  note: string;
}

export const ADVICE_EVAL_DATASET: EvalExample[] = [
  // --- Real (4) — pulled from t.me/s/sgmrt, deduped from ~20 raw reposts
  // down to the distinct message texts across 2 real disruption episodes.
  // See WRITEUP.md for the honest count: this channel is quiet most days,
  // exactly as PS2_README §2.4 warns.
  {
    text: "Minor delay. Train services have resumed between Caldecott and Orchard stations but trains will be travelling slower. Commuters can continue to use the train service or consider free bus services for this sector.",
    expectedBucket: "minor",
    isReal: true,
    note: "TEL, early stage — explicitly labelled 'Minor delay' by LTA",
  },
  {
    text: "Minor Delay. Train services have resumed between Caldecott and Orchard stations but trains will be travelling slower till end of train service. Commuters can continue to use the train service or consider free bus services for this sector.",
    expectedBucket: "minor",
    isReal: true,
    note: "TEL, escalated to 'till end of train service' — still LTA-labelled minor",
  },
  {
    text: "BPLRT - Major delay. No train services between Senja and Bukit Panjang stations (both directions). Consider free bus services at affected stations.",
    expectedBucket: "major",
    isReal: true,
    note: "BPLRT, explicitly labelled 'Major delay', full service suspension",
  },
  {
    text: "Due to a track intrusion, train service between Senja and Petir is affected. Train service is available between Choa Chu Kang and Bukit Panjang. Free bus services between Senja and Petir are available.",
    expectedBucket: "major",
    isReal: true,
    note: "BPLRT, same episode as above — no 'major' word here, but free bus activated + partial suspension",
  },

  // --- Synthetic (12) — written in LTA's real phrasing style (verified
  // patterns from the real examples above and the API guide's Annex C),
  // NOT scraped, for fault-type diversity the quiet real feed doesn't
  // currently offer. Clearly disclosed as synthetic in WRITEUP.md.
  {
    text: "Minor delay. Train services are experiencing slight delays on the North South Line due to a signal fault. Commuters may continue their journey.",
    expectedBucket: "minor",
    isReal: false,
    note: "synthetic — signal fault, explicit 'minor'",
  },
  {
    text: "Trains on the Circle Line are running at a reduced frequency due to a technical fault. We apologise for any inconvenience caused.",
    expectedBucket: "minor",
    isReal: false,
    note: "synthetic — reduced frequency, no severity word at all (hard case)",
  },
  {
    text: "Minor delay. Additional travelling time expected on the Downtown Line due to a train fault. Free bus services are not activated.",
    expectedBucket: "minor",
    isReal: false,
    note: "synthetic — train fault, explicit 'minor', no bus activated",
  },
  {
    text: "Commuters may experience slight delays on the East West Line due to a points fault near Jurong East. Trains are still running.",
    expectedBucket: "minor",
    isReal: false,
    note: "synthetic — points fault, 'still running' implies minor",
  },
  {
    text: "Major delay. No train service between HarbourFront and Outram Park on the Circle Line due to a track fault. Free bus services are available.",
    expectedBucket: "major",
    isReal: false,
    note: "synthetic — track fault, explicit 'major', full suspension",
  },
  {
    text: "Train services on the North East Line have been suspended between Dhoby Ghaut and Little India due to a signalling fault. Free bridging bus services are activated.",
    expectedBucket: "major",
    isReal: false,
    note: "synthetic — 'suspended', no 'major' word, bridging bus activated",
  },
  {
    text: "Major delay. Trains are not stopping at Bishan station due to a cable fault. Consider alternative routes.",
    expectedBucket: "major",
    isReal: false,
    note: "synthetic — cable fault, explicit 'major'",
  },
  {
    text: "No train service on the entire Bukit Panjang LRT line due to a power fault. Free regular bus services are available at all affected stations.",
    expectedBucket: "major",
    isReal: false,
    note: "synthetic — whole-line suspension, no severity word stated",
  },
  {
    text: "Major delay. Significant disruption to services on the Thomson-East Coast Line due to a flooding incident in the tunnel. Free shuttle buses activated.",
    expectedBucket: "major",
    isReal: false,
    note: "synthetic — flooding, explicit 'major'",
  },
  {
    text: "Trains on the Downtown Line are experiencing a major fault resulting in suspended service between Bugis and Chinatown. Please seek alternative transport.",
    expectedBucket: "major",
    isReal: false,
    note: "synthetic — 'major fault' embedded in prose, not a leading label",
  },
  {
    text: "Minor delay. Circle Line trains running slower than usual due to a points fault at Botanic Gardens.",
    expectedBucket: "minor",
    isReal: false,
    note: "synthetic — points fault, explicit 'minor'",
  },
  {
    text: "Minor delay expected due to ongoing maintenance works on the North South Line overnight, affecting early morning services.",
    expectedBucket: "minor",
    isReal: false,
    note: "synthetic — planned maintenance overrun, explicit 'minor'",
  },
];
