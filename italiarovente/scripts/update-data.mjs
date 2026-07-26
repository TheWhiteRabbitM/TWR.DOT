// Genera lo snapshot storico precalcolato (src/data/history.json).
// Eseguito al BUILD: scarica da Open-Meteo (ERA5) la serie giornaliera 1940->oggi
// per ogni città e ne calcola gli aggregati (annuali, mensili, anomalie, decenni,
// record, trend). Lo storico profondo non cambia mai -> calcolato una volta.
// Resiliente: se una città fallisce (es. 429), mantiene il valore già presente
// nel file, così i build locali (rate-limited) riusano i dati committati.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "src", "data", "history.json");
const CITIES_FILE = join(__dirname, "..", "src", "data", "cities.json");

// Fonte unica delle città (condivisa con il sito).
const CITIES = JSON.parse(readFileSync(CITIES_FILE, "utf8"));

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const DATA_START = "1940-01-01";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ERA5 diventa disponibile con ~5 giorni di ritardo, ma quella versione
// iniziale (ERA5T) è preliminare: la versione finale, "ri-analizzata", arriva
// solo dopo alcuni mesi e può differire leggermente. Per non dichiarare un
// record assoluto su un dato che potrebbe ancora essere rivisto, i record
// giornalieri (non le medie annue/mensili) ignorano gli ultimi mesi. Tenuto
// in sync a mano con RECORD_CUTOFF_DAYS in src/lib/weather.ts.
const RECORD_CUTOFF_DAYS = 120;
function recordCutoffISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - RECORD_CUTOFF_DAYS);
  return d.toISOString().slice(0, 10);
}

// Stessa soglia già usata per "ondata di calore" nelle notifiche push
// (src/app/api/refresh/route.ts, HEAT_THRESHOLD) — un solo vocabolario sul
// sito, non due soglie diverse per lo stesso concetto.
const HEATWAVE_STREAK_THRESHOLD = 35;

// Notte di gelo: minima <= 0°C. Soglia meteorologica standard (non 35°/-35°
// simmetrico: l'obiettivo è una sequenza di gelo notturno riconoscibile,
// non un valore arbitrario).
const COLD_SNAP_STREAK_THRESHOLD = 0;

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

// Valori critici della t di Student per un intervallo di confidenza al 95%
// (due code), interpolati linearmente tra i gradi di libertà tabulati. Per
// df >= 120 si usa l'approssimazione alla normale standard (1.96) — con le
// serie di questo sito (n ~ 80-85 anni, df ~ 78-83) lo scarto rispetto a un
// valore tabulato esatto è nell'ordine del millesimo. Duplicata (non importata)
// da src/lib/weather.ts di proposito: build-time e live restano calcoli
// indipendenti, vedi il commento sopra aggregate().
const T_TABLE = [
  [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571],
  [6, 2.447], [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228],
  [15, 2.131], [20, 2.086], [25, 2.060], [30, 2.042], [40, 2.021],
  [50, 2.009], [60, 2.000], [80, 1.990], [100, 1.984], [120, 1.980],
];
function tCrit95(df) {
  if (df <= 0) return NaN;
  if (df >= 120) return 1.96;
  for (let i = 0; i < T_TABLE.length - 1; i++) {
    const [df1, t1] = T_TABLE[i];
    const [df2, t2] = T_TABLE[i + 1];
    if (df >= df1 && df <= df2) return t1 + ((df - df1) / (df2 - df1)) * (t2 - t1);
  }
  return 1.96;
}

export function linreg(pts) {
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: pts[0]?.[1] ?? 0, r2: 0, ciMargin: NaN };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const denom = n * sxx - sx * sx;
  if (!denom) return { slope: 0, intercept: sy / n, r2: 0, ciMargin: NaN };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const rNum = n * sxy - sx * sy;
  const rDen = Math.sqrt(denom * (n * syy - sy * sy));
  const r = rDen ? rNum / rDen : 0;

  // Errore standard della pendenza: s² = varianza residua (SSE / df), Sxx =
  // somma degli scarti al quadrato di x. CI95 = t(df) * SE(slope).
  let sse = 0;
  for (const [x, y] of pts) {
    const resid = y - (intercept + slope * x);
    sse += resid * resid;
  }
  const df = n - 2;
  const sxxDev = sxx - (sx * sx) / n;
  const se = df > 0 && sxxDev > 0 ? Math.sqrt(sse / df / sxxDev) : NaN;
  const ciMargin = Number.isFinite(se) ? tCrit95(df) * se : NaN;

  return { slope, intercept, r2: r * r, ciMargin };
}

async function fetchDaily(city, end) {
  // Città principali: media+max+min (record precisi) + temperatura percepita
  // massima (afa estiva). Altre: solo media (1/3 del peso API -> molte più
  // città entro il rate limit). apparent_temperature include umidità, vento e
  // radiazione: è un modello, meno solido della secca, ma disponibile dal 1940
  // e utile per raccontare l'afa (vedi src/lib/summerfeels.ts).
  const daily = city.main
    ? "temperature_2m_mean,temperature_2m_max,temperature_2m_min,apparent_temperature_max"
    : "temperature_2m_mean";
  const params = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    start_date: DATA_START,
    end_date: end,
    daily,
    timezone: "Europe/Rome",
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${ARCHIVE}?${params}`);
      if (res.ok) return res.json();
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(ra > 0 ? Math.min(12000, ra * 1000) : Math.min(8000, 1200 * 2 ** attempt));
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(Math.min(8000, 1200 * 2 ** attempt));
    }
  }
  throw new Error("rate-limited");
}

export function aggregate(j) {
  const time = j.daily.time;
  const mean = j.daily.temperature_2m_mean;
  const tmax = j.daily.temperature_2m_max ?? [];
  const tmin = j.daily.temperature_2m_min ?? [];
  // Temperatura percepita massima (afa). Presente solo per le città principali;
  // assente (array vuoto) per tutte le altre e per il golden fixture.
  const tapp = j.daily.apparent_temperature_max ?? [];
  const hasApparent = Array.isArray(j.daily.apparent_temperature_max);
  // precise = abbiamo davvero max/min (città principali, fetch a 3 variabili)
  const precise = Array.isArray(j.daily.temperature_2m_max);

  const yearAgg = new Map();
  const monthAgg = new Map();
  const monthYearAgg = new Map(); // media per singolo anno-mese (non l'intera serie)
  // Afa estiva: per anno, somma di percepita-max e secca-max nei soli mesi
  // estivi (giu-ago), con conteggio giorni. Il confronto secca vs percepita
  // mostra quanto l'umidità aggiunge sopra il caldo.
  const summerAgg = new Map();
  const monthEarly = new Map(); // media mensile 1961-1990
  const monthRecent = new Map(); // media mensile 1991-2020
  let baseSum = 0, baseN = 0, recSum = 0, recN = 0;
  let hottest = { date: "", value: -Infinity };
  let coldest = { date: "", value: Infinity };
  const recordCutoff = recordCutoffISO();

  // Ondata di calore più lunga mai registrata: sequenza massima di giorni
  // CONSECUTIVI (nessun buco nella serie) con massima >= soglia. Calcolato
  // qui perché la serie giornaliera è già in memoria per le medie annue —
  // nessun fetch aggiuntivo. Come per i record assoluti, si ferma al cutoff
  // per non dichiarare un record su dati ERA5 ancora provvisori.
  let heatRun = 0, heatPeak = -Infinity, heatStart = "";
  let bestHeatwave = { days: 0, start: "", end: "", peak: -Infinity };
  // Simmetrico alla sequenza di caldo, ma sulle notti di gelo consecutive
  // (minima <= soglia) — stesso calcolo, nessun fetch in più.
  let coldRun = 0, coldLow = Infinity, coldStart = "";
  let bestColdSnap = { days: 0, start: "", end: "", low: Infinity };
  let prevDate = null;

  for (let i = 0; i < time.length; i++) {
    const date = time[i];
    const m = mean[i], mx = tmax[i], mn = tmin[i];
    const y = +date.slice(0, 4);
    const mo = +date.slice(5, 7);

    const consecutive = prevDate !== null && daysBetween(prevDate, date) === 1;
    if (!consecutive) {
      heatRun = 0; heatPeak = -Infinity; heatStart = "";
      coldRun = 0; coldLow = Infinity; coldStart = "";
    }
    if (mx != null && mx >= HEATWAVE_STREAK_THRESHOLD && date <= recordCutoff) {
      if (heatRun === 0) heatStart = date;
      heatRun++;
      if (mx > heatPeak) heatPeak = mx;
      if (heatRun > bestHeatwave.days) {
        bestHeatwave = { days: heatRun, start: heatStart, end: date, peak: heatPeak };
      }
    } else {
      heatRun = 0; heatPeak = -Infinity; heatStart = "";
    }
    if (mn != null && mn <= COLD_SNAP_STREAK_THRESHOLD && date <= recordCutoff) {
      if (coldRun === 0) coldStart = date;
      coldRun++;
      if (mn < coldLow) coldLow = mn;
      if (coldRun > bestColdSnap.days) {
        bestColdSnap = { days: coldRun, start: coldStart, end: date, low: coldLow };
      }
    } else {
      coldRun = 0; coldLow = Infinity; coldStart = "";
    }
    prevDate = date;

    if (m != null) {
      // Contatori separati per max/min: un giorno con la media ma senza la
      // massima NON deve contaminare la media delle massime con la media
      // (prima: `sMax += mx ?? m`). Se una serie non ha mai max/min (città
      // non principali), il fallback alla media resta, ma dichiarato a valle.
      const ya = yearAgg.get(y) ?? { sm: 0, n: 0, sMax: 0, nMax: 0, sMin: 0, nMin: 0, hd: 0, ehd: 0, tn: 0 };
      ya.sm += m; ya.n++;
      if (mx != null) { ya.sMax += mx; ya.nMax++; if (mx >= 30) ya.hd++; if (mx >= 35) ya.ehd++; }
      if (mn != null) { ya.sMin += mn; ya.nMin++; if (mn >= 20) ya.tn++; }
      yearAgg.set(y, ya);
      const ma = monthAgg.get(mo) ?? { sm: 0, n: 0, sMax: 0, nMax: 0, sMin: 0, nMin: 0 };
      ma.sm += m; ma.n++;
      if (mx != null) { ma.sMax += mx; ma.nMax++; }
      if (mn != null) { ma.sMin += mn; ma.nMin++; }
      monthAgg.set(mo, ma);
      const myKey = `${y}-${mo}`;
      const mya = monthYearAgg.get(myKey) ?? { sm: 0, n: 0, year: y, month: mo };
      mya.sm += m; mya.n++;
      monthYearAgg.set(myKey, mya);
      // Afa estiva: mesi 6-8, solo se abbiamo sia la percepita che la secca del
      // giorno (per confrontarle a parità di campione).
      if (hasApparent && mo >= 6 && mo <= 8 && tapp[i] != null && mx != null) {
        const sa = summerAgg.get(y) ?? { feels: 0, dry: 0, n: 0 };
        sa.feels += tapp[i]; sa.dry += mx; sa.n++;
        summerAgg.set(y, sa);
      }
      if (y >= 1961 && y <= 1990) {
        baseSum += m; baseN++;
        const e = monthEarly.get(mo) ?? { s: 0, n: 0 }; e.s += m; e.n++; monthEarly.set(mo, e);
      }
      if (y >= 1991 && y <= 2020) {
        recSum += m; recN++;
        const e = monthRecent.get(mo) ?? { s: 0, n: 0 }; e.s += m; e.n++; monthRecent.set(mo, e);
      }
    }
    if (mx != null && mx > hottest.value && date <= recordCutoff) hottest = { date, value: mx };
    if (mn != null && mn < coldest.value && date <= recordCutoff) coldest = { date, value: mn };
  }

  const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const yearly = [...yearAgg.entries()]
    .map(([year, a]) => ({
      year,
      mean: round(a.sm / a.n),
      // Senza max/min veri (città non principali) il fallback resta la media:
      // stesso comportamento di prima, ma senza mescolare le due somme.
      max: round(a.nMax ? a.sMax / a.nMax : a.sm / a.n),
      min: round(a.nMin ? a.sMin / a.nMin : a.sm / a.n),
      count: a.n,
      hd: a.hd, // giorni con max >= 30
      ehd: a.ehd, // giorni con max >= 35
      tn: a.tn, // notti con min >= 20
    }))
    .sort((a, b) => a.year - b.year);
  const monthly = [...monthAgg.entries()]
    .map(([month, a]) => ({
      month,
      mean: round(a.sm / a.n),
      max: round(a.nMax ? a.sMax / a.nMax : a.sm / a.n),
      min: round(a.nMin ? a.sMin / a.nMin : a.sm / a.n),
    }))
    .sort((a, b) => a.month - b.month);
  const monthlySeries = [...monthYearAgg.values()]
    .map((a) => ({ year: a.year, month: a.month, mean: round(a.sm / a.n), count: a.n }))
    .sort((a, b) => a.year - b.year || a.month - b.month);
  // Afa estiva per anno: solo anni con estate ragionevolmente completa
  // (>= 80 dei 92 giorni giu-ago). undefined per le città senza percepita.
  const summerApparent = hasApparent
    ? [...summerAgg.entries()]
        .filter(([, a]) => a.n >= 80)
        .map(([year, a]) => ({ year, feels: round(a.feels / a.n), dry: round(a.dry / a.n), count: a.n }))
        .sort((a, b) => a.year - b.year)
    : undefined;

  const baselineMean = baseN ? baseSum / baseN : NaN;
  const recentNormal = recN ? recSum / recN : NaN;
  const fullYears = yearly.filter((y) => y.count >= 360);
  const warmestYear = fullYears.reduce((acc, y) => (y.mean > acc.mean ? y : acc), fullYears[0]);
  const coolestYear = fullYears.reduce((acc, y) => (y.mean < acc.mean ? y : acc), fullYears[0]);

  // SOLO anni completi: l'anomalia dell'anno in corso (media gen-oggi contro
  // una baseline ANNUA) è stagionalmente distorta e finirebbe dritta nelle
  // warming stripes — l'ultima striscia, quella che tutti guardano.
  const anomalies = fullYears.map((y) => ({ year: y.year, anomaly: round(y.mean - baselineMean) }));

  const decAgg = new Map();
  for (const y of fullYears) {
    const d = Math.floor(y.year / 10) * 10;
    const e = decAgg.get(d) ?? { s: 0, n: 0 };
    e.s += y.mean; e.n++; decAgg.set(d, e);
  }
  const decades = [...decAgg.entries()]
    .map(([decade, e]) => ({
      decade,
      mean: round(e.s / e.n),
      anomaly: round(e.s / e.n - baselineMean),
      count: e.n,
    }))
    .sort((a, b) => a.decade - b.decade);

  const reg = linreg(fullYears.map((y) => [y.year, y.mean]));
  const firstY = fullYears[0];
  const lastY = fullYears[fullYears.length - 1];

  return {
    precise,
    yearly,
    anomalies,
    decades,
    monthly,
    monthlySeries,
    ...(summerApparent ? { summerApparent } : {}),
    records: {
      hottest: { date: hottest.date, value: round(hottest.value, 1) },
      coldest: { date: coldest.date, value: round(coldest.value, 1) },
      warmestYear,
      coolestYear,
      longestHeatwave:
        bestHeatwave.days > 0
          ? { days: bestHeatwave.days, start: bestHeatwave.start, end: bestHeatwave.end, peak: round(bestHeatwave.peak, 1) }
          : null,
      longestColdSnap:
        bestColdSnap.days > 0
          ? { days: bestColdSnap.days, start: bestColdSnap.start, end: bestColdSnap.end, low: round(bestColdSnap.low, 1) }
          : null,
    },
    trend: {
      perYear: round(reg.slope, 4),
      perDecade: round(reg.slope * 10, 3),
      perDecadeCi95: round(reg.ciMargin * 10, 3),
      totalChange: round(reg.slope * (lastY.year - firstY.year), 2),
      r2: round(reg.r2, 3),
      baselineMean: round(baselineMean),
      recentNormal: round(recentNormal),
      lastFullYearMean: lastY.mean,
      firstYear: firstY.year,
      lastYear: lastY.year,
    },
    startYear: yearly[0]?.year ?? 1940,
    lastDate: time[time.length - 1],
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    /* nessuno snapshot precedente */
  }

  const out = { ...existing };
  const end = todayISO();
  const refreshAll = process.env.REFRESH_ALL === "1";
  // Budget temporale: il build non deve mai bloccarsi a lungo. Ogni esecuzione
  // popola quante più città possibile entro il budget; le altre al run successivo.
  const BUDGET_MS = Number(process.env.FETCH_BUDGET_MS || 210000);
  const start = Date.now();
  let ok = 0, kept = 0, skipped = 0, deferred = 0;
  // Priorità: prima le città principali (così vengono scaricate prima di
  // esaurire il rate limit), poi le altre.
  const order = [...CITIES].sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0));
  for (const city of order) {
    // Di default mantieni le città già presenti (rerun = solo mancanti).
    // Ma ri-scarica le principali se manca il conteggio giorni/notti (hd)
    // o i record di durata (ondata di calore / gelo più lunghi); e QUALSIASI
    // città (non solo le principali: il trend si calcola per tutte) se manca
    // l'intervallo di confidenza sulla pendenza.
    const cached = existing[city.slug];
    const hasHeat = cached?.yearly?.[0]?.hd !== undefined;
    const hasStreak = cached?.records?.longestHeatwave !== undefined;
    const hasColdStreak = cached?.records?.longestColdSnap !== undefined;
    const hasCi = cached?.trend?.perDecadeCi95 !== undefined;
    const hasMonthlySeries = cached?.monthlySeries !== undefined;
    // Afa: solo le principali la scaricano (fetch a 4 variabili). Manca ->
    // vanno ri-scaricate finché non ce l'hanno.
    const hasFeels = !city.main || cached?.summerApparent !== undefined;
    const needsHeat = city.main && (!hasHeat || !hasStreak || !hasColdStreak || !hasFeels);
    if (!refreshAll && cached?.yearly?.length && !needsHeat && hasCi && hasMonthlySeries) {
      skipped++;
      continue;
    }
    if (Date.now() - start > BUDGET_MS) {
      deferred++;
      continue;
    }
    try {
      const j = await fetchDaily(city, end);
      out[city.slug] = aggregate(j);
      ok++;
      console.log(`✓ ${city.slug} (${out[city.slug].startYear}-${out[city.slug].trend.lastYear})`);
    } catch (e) {
      if (existing[city.slug]) {
        out[city.slug] = existing[city.slug];
        kept++;
        console.log(`• ${city.slug}: ${e.message} -> uso snapshot esistente`);
      } else {
        console.log(`✗ ${city.slug}: ${e.message} -> nessun dato`);
      }
    }
    await sleep(2500); // distanzia le richieste per rispettare il rate limit
  }

  // Fingerprint di integrità: hash SHA-256 degli aggregati per-città, con le
  // chiavi ordinate alfabeticamente per un risultato deterministico
  // indipendente dall'ordine con cui le città sono state (ri)scaricate in
  // questa esecuzione. Chiunque riesegua aggregate() sugli stessi dati
  // grezzi può verificare che il risultato pubblicato sia esattamente questo,
  // senza doversi fidare della parola del sito.
  const cityHash = createHash("sha256");
  for (const slug of Object.keys(out).sort()) {
    cityHash.update(slug);
    cityHash.update(JSON.stringify(out[slug]));
  }

  // Metadati di provenienza dello snapshot: quando è stato generato, da quale
  // fonte, con quale commit (disponibile nei build Vercel via
  // VERCEL_GIT_COMMIT_SHA), e l'hash sopra. Permette di riprodurre e
  // verificare esattamente questi numeri.
  out._meta = {
    generatedAt: end,
    source: "Open-Meteo Archive API — ERA5 reanalysis (ECMWF/Copernicus C3S)",
    commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
    sha256: cityHash.digest("hex"),
  };

  writeFileSync(OUT, JSON.stringify(out));
  console.log(
    `Snapshot: ${ok} aggiornate, ${kept} mantenute, ${skipped} saltate, ${deferred} rinviate (budget), ${Object.keys(out).filter((k) => out[k]?.yearly?.length).length}/${CITIES.length} totali. -> ${OUT}`,
  );

  // Il Build Command su Vercel è fissato dal pannello (non legge più
  // package.json "build"), quindi tutto ciò che deve girare al build va
  // agganciato qui, nello script che sappiamo essere sempre eseguito.
  // L'archivio dei mari è incrementale e usa un'API diversa (marine-api, quota
  // separata da quella dell'archivio ERA5): non fallisce insieme alle città.
  const { run: fetchSea } = await import("./fetch-sea.mjs");
  await fetchSea().catch((e) => console.log(`✗ mari: ${e.message}`));

  const { run: generateCaptions } = await import("./generate-captions.mjs");
  await generateCaptions();
}

// Solo se eseguito direttamente (non quando importato, es. dai test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
