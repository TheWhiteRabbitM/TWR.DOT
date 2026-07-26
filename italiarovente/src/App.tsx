import { useEffect, useMemo, useState } from 'react';
import {
  CITIES,
  cityName,
  historyFor,
  dataAsOf,
  stripeColor,
  anomalySpan,
  fmtTemp,
  type Anomaly,
  type City,
  type Yearly,
} from './lib/climate';
import { fetchToday, type Today } from './lib/live';
import { CityPicker } from './CityPicker';
import { openAppChat } from './lib/host-chat';
import { WarmingStripes } from './WarmingStripes';
import { YearlyMeanChart } from './YearlyMeanChart';
import { Rankings } from './Rankings';
import { ItalyMap } from './ItalyMap';
import { Seas } from './Seas';
import { Lifetime } from './Lifetime';

// ERA5 only carries daily max/min for the main cities; everywhere else the
// source writes these records as null — every field must be guarded.
type HottestDay = { date: string; value: number | null };
type Heatwave = { days: number; start: string; end: string; peak: number | null };

/** One-tap link into the Polkadot app's built-in chat. */
function ChatButton() {
  const [label, setLabel] = useState('💬 Community chat');
  const go = async () => {
    setLabel('Opening…');
    const r = await openAppChat('italiarovente', 'Italia Rovente community');
    if (r === 'outside') setLabel('Chat lives inside the Polkadot app');
    else if (r === 'failed') setLabel('Chat unavailable right now');
    else setLabel('Room added to your Polkadot chat ✓');
    window.setTimeout(() => setLabel('💬 Community chat'), 2600);
  };
  return (
    <button type="button" className="chat-cta" onClick={go}>
      {label}
    </button>
  );
}

/** Live "today" reading from Open-Meteo. Silently hidden if the call is blocked. */
function TodayCard({ city }: { city: City }) {
  const [today, setToday] = useState<Today | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setToday(null);
    setFailed(false);
    fetchToday(city.lat, city.lon, ctrl.signal)
      .then((t) => !cancelled && setToday(t))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [city.lat, city.lon]);

  if (failed) return null;

  return (
    <section className="today">
      <span className="today-label">Right now in {cityName(city)}</span>
      <div className="today-row">
        {today ? (
          <>
            <span className="today-now">{today.current.toFixed(1)}°</span>
            <span className="today-hilo">
              Today {Math.round(today.min)}° / {Math.round(today.max)}°
            </span>
          </>
        ) : (
          <span className="today-now today-load">—</span>
        )}
      </div>
      <span className="today-src">live · Open-Meteo</span>
    </section>
  );
}

const DEFAULT_CITY = CITIES.find((c) => c.slug === 'roma')?.slug ?? CITIES[0].slug;

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function App() {
  const [slug, setSlug] = useState(DEFAULT_CITY);
  const city = CITIES.find((c) => c.slug === slug)!;
  const history = historyFor(slug);

  const span = useMemo(
    () => (history ? anomalySpan(history.anomalies) : 1),
    [history],
  );

  if (!history) {
    return (
      <div className="page">
        <p className="empty">No record for {cityName(city)}.</p>
      </div>
    );
  }

  const { trend, records, anomalies, yearly } = history;
  const hottest = records.hottest as HottestDay | undefined;
  const heatwave = records.longestHeatwave as Heatwave | undefined;
  const warmestYear = records.warmestYear as Yearly | undefined;
  const lastFull = yearly[yearly.length - 1];
  const baselineHd = yearly.slice(0, 30).reduce((s, y) => s + y.hd, 0) / 30;

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <StripeMark anomalies={anomalies} span={span} />
          <div>
            <h1>Italia Rovente</h1>
            <p>How much hotter Italy has become since 1940</p>
          </div>
        </div>
        <CityPicker selected={city} onSelect={setSlug} />
      </header>

      <section className="hero">
        <p className="hero-eyebrow">
          {cityName(city)} · {city.region}
        </p>
        <h2 className="hero-figure">
          <span className="hot">{fmtTemp(trend.totalChange)}</span> warmer
        </h2>
        <p className="hero-lede">
          {cityName(city)}'s yearly average temperature has risen {fmtTemp(trend.totalChange)} since{' '}
          {history.startYear} — about {fmtTemp(trend.perDecade)} every decade. Each stripe below is
          one year, from {history.startYear} on the left to today: blue years were cooler than the
          1961–1990 normal, red years hotter.
        </p>
      </section>

      <TodayCard city={city} />

      <section className="stripes-panel">
        <WarmingStripes anomalies={anomalies} span={span} />
        <div className="stripes-axis">
          <span>{history.startYear}</span>
          <span>cooler ← 1961–1990 normal → hotter</span>
          <span>{new Date(history.lastDate).getUTCFullYear()}</span>
        </div>
      </section>

      <section className="tiles">
        <Tile
          label="Warmest year on record"
          value={warmestYear ? String(warmestYear.year) : '—'}
          sub={warmestYear && warmestYear.mean != null ? `${warmestYear.mean.toFixed(1)}°C average` : ''}
        />
        <Tile
          label="Hottest day ever"
          value={hottest && hottest.value != null ? `${hottest.value.toFixed(1)}°C` : '—'}
          sub={hottest && hottest.value != null ? fmtDate(hottest.date) : ''}
        />
        <Tile
          label="Longest heatwave"
          value={heatwave ? `${heatwave.days} days` : '—'}
          sub={heatwave && heatwave.peak != null ? `peak ${heatwave.peak.toFixed(1)}°C · ${fmtDate(heatwave.start)}` : ''}
        />
        <Tile
          label="Hot days last year"
          value={`${lastFull.hd}`}
          sub={`≥30°C · was ~${Math.round(baselineHd)}/yr in 1940–69`}
          hot={lastFull.hd > baselineHd * 1.5}
        />
      </section>

      <section className="chart-panel">
        <div className="chart-head">
          <h3>Yearly average temperature</h3>
          <span className="chart-note">
            {history.startYear}–{new Date(history.lastDate).getUTCFullYear()} · trend r²{' '}
            {trend.r2.toFixed(2)}
          </span>
        </div>
        <YearlyMeanChart yearly={yearly} />
      </section>

      <Lifetime city={city} />

      <ItalyMap selected={slug} onSelect={setSlug} />

      <Rankings selected={slug} onSelect={setSlug} />

      <Seas />

      <ChatButton />

      <footer className="foot">
        <p>
          Daily temperatures 1940–today from the ERA5 reanalysis via the open{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>{' '}
          archive. Anomalies are against the 1961–1990 average. Data as of {fmtDate(dataAsOf())}.
        </p>
        <p className="foot-dim">
          107 Italian cities · published on Polkadot Bulletin as <code>italiarovente.dot</code>. Not
          a forecast; a record of what has already happened.
        </p>
      </footer>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  hot,
}: {
  label: string;
  value: string;
  sub: string;
  hot?: boolean;
}) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className={`tile-value${hot ? ' is-hot' : ''}`}>{value}</span>
      <span className="tile-sub">{sub}</span>
    </div>
  );
}

/** A tiny stripes glyph for the header, built from the same anomalies. */
function StripeMark({ anomalies, span }: { anomalies: Anomaly[]; span: number }) {
  const recent = anomalies.slice(-14);
  return (
    <span className="mark" aria-hidden="true">
      {recent.map((a) => (
        <i key={a.year} style={{ background: stripeColor(a.anomaly, span) }} />
      ))}
    </span>
  );
}
