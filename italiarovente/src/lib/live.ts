/**
 * Today's temperature, fetched live from the open Open-Meteo forecast API
 * (free, no key) — the same source as the deep history, just the current day.
 *
 * The production app pulled "today" from its server; this Bulletin-native build
 * has no server, so it reads Open-Meteo directly from the browser (exactly like
 * the map search does). If the host blocks the call, the page keeps working from
 * the historical record and simply omits the live line.
 */
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

export interface Today {
  current: number;
  max: number;
  min: number;
  time: string;
}

export async function fetchToday(lat: number, lon: number, signal?: AbortSignal): Promise<Today> {
  const url =
    `${FORECAST}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m&daily=temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const j = (await res.json()) as {
    current?: { temperature_2m?: number; time?: string };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };
  const current = j.current?.temperature_2m;
  const max = j.daily?.temperature_2m_max?.[0];
  const min = j.daily?.temperature_2m_min?.[0];
  if (typeof current !== 'number' || typeof max !== 'number' || typeof min !== 'number') {
    throw new Error('unexpected forecast shape');
  }
  return { current, max, min, time: j.current?.time ?? '' };
}
