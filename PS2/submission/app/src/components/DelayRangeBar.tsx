interface Props {
  low: number;
  high: number;
  point: number;
}

// The visual answer to PS2_README §3.2.1's "uncertainty made visible rather
// than hidden behind a single confident number" — a band, not a bare figure.
export default function DelayRangeBar({ low, high, point }: Props) {
  const trackMax = Math.max(high * 1.15, point * 1.15, 10);
  const pct = (n: number) => Math.min(100, Math.max(0, (n / trackMax) * 100));

  return (
    <div className="delay-range" aria-label={`Delay likely between ${low} and ${high} minutes`}>
      <div className="delay-range-track">
        <div
          className="delay-range-band"
          style={{ left: `${pct(low)}%`, width: `${Math.max(2, pct(high) - pct(low))}%` }}
        />
        <div className="delay-range-point" style={{ left: `${pct(point)}%` }} />
      </div>
      <div className="delay-range-labels">
        <span>{low} min</span>
        <span className="delay-range-mid">~{point} min likely</span>
        <span>{high} min</span>
      </div>
    </div>
  );
}
