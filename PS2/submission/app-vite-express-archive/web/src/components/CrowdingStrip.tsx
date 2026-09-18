import type { BaselineLabel, CrowdLevel, Station } from "../types";

const LEVEL_META: Record<CrowdLevel, { letter: string; color: string; word: string }> = {
  l: { letter: "L", color: "#1a7f37", word: "low" },
  m: { letter: "M", color: "#b8860e", word: "moderate" },
  h: { letter: "H", color: "#b8460e", word: "high" },
  NA: { letter: "–", color: "#9aa3af", word: "no data" },
};

const BASELINE_WORD: Record<BaselineLabel, string> = {
  low: "usually quiet at this hour",
  typical: "typical for this hour",
  high: "usually busy at this hour",
  unknown: "no historical baseline",
};

interface Props {
  stations: Station[];
  crowding: Record<string, CrowdLevel>;
  crowdingBaseline: Record<string, BaselineLabel>;
}

// Three-level crowding, readable in one second — a coloured badge plus a
// letter (L/M/H) so it doesn't rely on colour alone (PS2_README §3.2.3
// accessibility note). One row, horizontally scrollable on a phone.
//
// The small dot under a badge flags when live crowding disagrees with the
// PV/Train historical baseline for this hour (e.g. "high" right now at a
// station that's usually quiet then) — real data, not decoration; see
// pvTrainBaseline.ts.
export default function CrowdingStrip({ stations, crowding, crowdingBaseline }: Props) {
  return (
    <div className="crowding-strip" role="list" aria-label="Platform crowding by station">
      {stations.map((s) => {
        const level = crowding[s.code] ?? "NA";
        const meta = LEVEL_META[level];
        const baseline = crowdingBaseline[s.code] ?? "unknown";
        const unusual = level === "h" && baseline === "low";
        return (
          <div
            key={s.code}
            className="crowding-chip"
            role="listitem"
            title={`${s.name}: ${meta.word} now — ${BASELINE_WORD[baseline]}`}
          >
            <span className="crowding-code">{s.code}</span>
            <span className="crowding-badge" style={{ background: meta.color }}>
              {meta.letter}
            </span>
            <span className={`crowding-baseline-dot${unusual ? " unusual" : ""}`} />
          </div>
        );
      })}
    </div>
  );
}
