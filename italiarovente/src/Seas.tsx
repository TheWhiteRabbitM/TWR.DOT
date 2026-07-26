import { useMemo } from 'react';
import seasRaw from './data/seas.json';
import seaHistoryRaw from './data/sea-history.json';

/**
 * Sea surface temperatures around Italy — daily satellite SST since late 2022.
 * The series is deliberately NOT shown as a climate trend (its own metadata
 * warns it is too short); what it is good for, honestly, is *now vs the same
 * day in previous summers* and the all-time record of the short record.
 */

interface Sea {
  slug: string;
  name: string;
  nameEn: string;
  lat: number;
  lon: number;
}

interface Series {
  start: string;
  mean: (number | null)[];
  max: (number | null)[];
  min: (number | null)[];
}

const SEAS = seasRaw as Sea[];
const HIST = seaHistoryRaw as unknown as Record<string, Series>;

function dayIndex(start: string, iso: string): number {
  return Math.round((Date.parse(iso) - Date.parse(start)) / 86_400_000);
}

interface SeaNow {
  sea: Sea;
  today: number;
  date: string;
  vsLastYears: number | null;
  recordMax: number;
}

function computeSeas(): SeaNow[] {
  const out: SeaNow[] = [];
  for (const sea of SEAS) {
    const s = HIST[sea.slug];
    if (!s || !Array.isArray(s.mean)) continue;
    // last non-null reading
    let li = s.mean.length - 1;
    while (li >= 0 && s.mean[li] == null) li -= 1;
    if (li < 0) continue;
    const today = s.mean[li]!;
    const dateISO = new Date(Date.parse(s.start) + li * 86_400_000).toISOString().slice(0, 10);
    // same calendar day in previous years of the record
    const prev: number[] = [];
    for (let back = 1; back <= 3; back += 1) {
      const d = new Date(dateISO + 'T00:00:00Z');
      d.setUTCFullYear(d.getUTCFullYear() - back);
      const idx = dayIndex(s.start, d.toISOString().slice(0, 10));
      const v = idx >= 0 && idx < s.mean.length ? s.mean[idx] : null;
      if (typeof v === 'number') prev.push(v);
    }
    const vs = prev.length ? today - prev.reduce((a, b) => a + b, 0) / prev.length : null;
    let recordMax = -Infinity;
    for (const v of s.max) if (typeof v === 'number' && v > recordMax) recordMax = v;
    out.push({ sea, today, date: dateISO, vsLastYears: vs, recordMax });
  }
  return out.sort((a, b) => b.today - a.today);
}

export function Seas() {
  const rows = useMemo(computeSeas, []);
  if (!rows.length) return null;
  const asOf = rows[0].date;
  return (
    <section className="seas">
      <div className="nat-head">
        <div>
          <h3>The seas</h3>
          <span className="nat-note">satellite surface temperature · {asOf}</span>
        </div>
      </div>
      <div className="sea-grid">
        {rows.map((r) => (
          <div className="sea-card" key={r.sea.slug}>
            <span className="sea-name">🌊 {r.sea.nameEn}</span>
            <span className="sea-temp">{r.today.toFixed(1)}°</span>
            <span className={`sea-delta${r.vsLastYears != null && r.vsLastYears > 0 ? ' is-hot' : ''}`}>
              {r.vsLastYears == null
                ? '—'
                : `${r.vsLastYears >= 0 ? '+' : ''}${r.vsLastYears.toFixed(1)}° vs same day '23–'25`}
            </span>
            <span className="sea-rec">record {r.recordMax.toFixed(1)}°</span>
          </div>
        ))}
      </div>
      <p className="sea-foot">
        Daily readings since Nov 2022 (Open-Meteo Marine) — a record this short says nothing
        about climate trends, so it is shown only as today vs the same day in previous years.
      </p>
    </section>
  );
}
