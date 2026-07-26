import citiesRaw from '../data/cities.json';
import historyRaw from '../data/history.json';

/** One place with a temperature record. */
export interface City {
  slug: string;
  name: string;
  region: string;
  zone: string;
  lat: number;
  lon: number;
  main?: boolean;
}

export interface Anomaly {
  year: number;
  /** Yearly mean minus the 1961–1990 baseline, °C. */
  anomaly: number;
}

export interface Yearly {
  year: number;
  mean: number;
  max: number;
  min: number;
  count: number;
  /** Hot days (≥30°C). */
  hd: number;
  /** Extreme hot days (≥35°C). */
  ehd: number;
  /** Tropical nights (min ≥20°C). */
  tn: number;
}

export interface Decade {
  decade: number;
  mean: number;
  anomaly: number;
  count: number;
}

export interface Trend {
  perYear: number;
  perDecade: number;
  perDecadeCi95?: number;
  /** Warming from the start of the record to now, °C. */
  totalChange: number;
  r2: number;
  baselineMean: number;
  recentNormal: number;
  lastFullYearMean: number;
}

export interface CityHistory {
  startYear: number;
  lastDate: string;
  anomalies: Anomaly[];
  yearly: Yearly[];
  decades: Decade[];
  records: Record<string, unknown>;
  trend: Trend;
}

/**
 * Well-known English exonyms — the same short list the original app uses (only
 * cities with a genuinely common English name; everything else keeps its
 * Italian name, e.g. "Bergamo" stays "Bergamo"). Reused, not reinvented.
 */
const CITY_NAME_EN: Record<string, string> = {
  roma: 'Rome',
  napoli: 'Naples',
  firenze: 'Florence',
  torino: 'Turin',
  venezia: 'Venice',
  milano: 'Milan',
  genova: 'Genoa',
  padova: 'Padua',
};

/** A city's English display name. */
export function cityName(city: City): string {
  return CITY_NAME_EN[city.slug] ?? city.name;
}

export const CITIES = (citiesRaw as City[])
  .slice()
  .sort((a, b) => cityName(a).localeCompare(cityName(b)));
const HISTORY = historyRaw as unknown as Record<string, CityHistory>;

export function historyFor(slug: string): CityHistory | undefined {
  return HISTORY[slug];
}

/** Latest ERA5 date across the dataset — how fresh the numbers are. */
export function dataAsOf(): string {
  let latest = '';
  for (const h of Object.values(HISTORY)) if (h.lastDate > latest) latest = h.lastDate;
  return latest;
}

/**
 * Warming-stripes colour for a yearly anomaly. The canonical Ed Hawkins scale:
 * cold years blue, warm years red, deepening with magnitude. `span` is the
 * absolute anomaly that saturates the ends, so every city is coloured on its
 * own spread rather than a global one.
 */
const BLUES = ['#08306b', '#08519c', '#2171b5', '#4292c6', '#6baed6', '#9ecae1', '#c6dbef'];
const REDS = ['#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#99000d'];

export function stripeColor(anomaly: number, span: number): string {
  const t = Math.max(-1, Math.min(1, anomaly / (span || 1)));
  if (t >= 0) {
    const i = Math.min(REDS.length - 1, Math.floor(t * REDS.length));
    return REDS[i];
  }
  const i = Math.min(BLUES.length - 1, Math.floor(-t * BLUES.length));
  return BLUES[BLUES.length - 1 - i];
}

/** A robust saturation span for a city's stripes: the 95th percentile of |anomaly|. */
export function anomalySpan(anomalies: Anomaly[]): number {
  const abs = anomalies.map((a) => Math.abs(a.anomaly)).sort((x, y) => x - y);
  if (abs.length === 0) return 1;
  const p95 = abs[Math.floor(abs.length * 0.95)] ?? abs[abs.length - 1];
  return Math.max(0.5, p95);
}

export function fmtTemp(n: number, digits = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}°C`;
}

export interface Ranked {
  city: City;
  totalChange: number;
  lastMean: number;
  recentAnomaly: number;
}

/** Every city ranked by how much it has warmed since the start of its record. */
export function nationalRanking(): Ranked[] {
  const out: Ranked[] = [];
  for (const city of CITIES) {
    const h = HISTORY[city.slug];
    if (!h) continue;
    const recent = h.anomalies.slice(-1)[0]?.anomaly ?? 0;
    out.push({
      city,
      totalChange: h.trend.totalChange,
      lastMean: h.trend.lastFullYearMean,
      recentAnomaly: recent,
    });
  }
  return out.sort((a, b) => b.totalChange - a.totalChange);
}

/** Italy-wide average warming across all cities in the record. */
export function nationalWarming(): number {
  const r = nationalRanking();
  if (r.length === 0) return 0;
  return r.reduce((s, x) => s + x.totalChange, 0) / r.length;
}
