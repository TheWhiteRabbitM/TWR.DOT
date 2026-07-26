import { useMemo, useState } from 'react';
import { historyFor, cityName, fmtTemp, type City } from './lib/climate';

/**
 * "Since you were born" — the original app's most personal widget. Pick a birth
 * year and see how much the selected city has warmed in your own lifetime:
 * anomalies around your birth vs the last five years, plus hot days then vs now.
 */

const THIS_YEAR = new Date().getFullYear();

function meanAround(values: { year: number; v: number }[], year: number, spread: number): number | null {
  const win = values.filter((a) => Math.abs(a.year - year) <= spread);
  if (!win.length) return null;
  return win.reduce((s, a) => s + a.v, 0) / win.length;
}

export function Lifetime({ city }: { city: City }) {
  const [born, setBorn] = useState(1985);
  const h = historyFor(city.slug);

  const calc = useMemo(() => {
    if (!h) return null;
    const anoms = h.anomalies.map((a) => ({ year: a.year, v: a.anomaly }));
    const hds = h.yearly.filter((y) => y.count > 300).map((y) => ({ year: y.year, v: y.hd }));
    const then = meanAround(anoms, born, 2);
    const lastFull = anoms[anoms.length - 1]?.year ?? THIS_YEAR;
    const now = meanAround(anoms, lastFull - 2, 2);
    const hdThen = meanAround(hds, born, 2);
    const hdNow = meanAround(hds, lastFull - 2, 2);
    if (then == null || now == null) return null;
    return {
      warming: now - then,
      hdThen: hdThen != null ? Math.round(hdThen) : null,
      hdNow: hdNow != null ? Math.round(hdNow) : null,
    };
  }, [h, born]);

  if (!h || !calc) return null;

  const minYear = Math.max(h.startYear + 2, 1942);
  const maxYear = THIS_YEAR - 5;

  return (
    <section className="life">
      <div className="life-inner">
        {/* A range slider, not a native select: dropdowns don't open inside
            the Polkadot shell's sandboxed iframe. Sliders do. */}
        <label className="life-pick">
          I was born in <b className="life-year">{born}</b>
          <input
            className="life-range"
            type="range"
            min={minYear}
            max={maxYear}
            step={1}
            value={born}
            onChange={(e) => setBorn(Number(e.target.value))}
            aria-label="Birth year"
          />
        </label>
        <p className="life-line">
          In your lifetime, {cityName(city)} has warmed{' '}
          <b className="life-hot">{fmtTemp(calc.warming)}</b>
          {calc.hdThen != null && calc.hdNow != null && calc.hdNow !== calc.hdThen && (
            <>
              {' '}
              — and 30°C+ days went from <b>~{calc.hdThen}</b> to <b>~{calc.hdNow}</b> a year
            </>
          )}
          .
        </p>
      </div>
    </section>
  );
}
