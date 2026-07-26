// Costruisce il nostro archivio giornaliero della temperatura del mare
// (src/data/sea-history.json). Eseguito al BUILD, come fetch-history.mjs.
//
// Fonte: Open-Meteo Marine API. A differenza dell'aria (ERA5, dal 1940), la
// serie marina inizia il 2022-11-24: prima di quella data l'API restituisce
// null per tutti i punti (verificato). Sono ~3 anni: abbastanza per record,
// confronti anno su anno e stagionalità, MAI abbastanza per una tendenza
// climatica — vedi la nota in src/lib/seahistory.ts.
//
// Storage: per ogni mare, la data di inizio e tre array paralleli (media, max,
// min) indicizzati per giorni trascorsi da `start`. Nessuna data ripetuta 1300
// volte, e i buchi restano espliciti (null) invece di sparire.
//
// Incrementale: a ogni esecuzione scarica solo i giorni mancanti, più una
// finestra di riverifica sugli ultimi giorni (l'analisi marina più recente può
// essere rivista, come ERA5T per l'aria).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "src", "data", "sea-history.json");
const SEAS_FILE = join(__dirname, "..", "src", "data", "seas.json");

const SEAS = JSON.parse(readFileSync(SEAS_FILE, "utf8"));

const MARINE_API = "https://marine-api.open-meteo.com/v1/marine";

// Primo giorno con dati reali su TUTTI i punti (verificato: 2022-11-01..23
// restituisce null ovunque, il 24 arriva il primo valore su tutti e sei).
export const SEA_START = "2022-11-24";

// Gli ultimi giorni dell'analisi possono essere rivisti: li riscarichiamo ogni
// volta invece di fidarci del valore già salvato.
const REVISION_WINDOW_DAYS = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000,
  );
}

// Ieri: l'ultimo giorno per cui il dato è analisi e non previsione. Il valore
// di oggi resta quello live mostrato in home (getSeaTemps), non entra
// nell'archivio.
function yesterdayISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function fetchRange(sea, start, end) {
  const params = new URLSearchParams({
    latitude: String(sea.lat),
    longitude: String(sea.lon),
    daily: "sea_surface_temperature_mean,sea_surface_temperature_max,sea_surface_temperature_min",
    start_date: start,
    end_date: end,
    timezone: "Europe/Rome",
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${MARINE_API}?${params}`);
      if (res.ok) return res.json();
      if (res.status === 429 || res.status >= 500) {
        await sleep(Math.min(8000, 1200 * 2 ** attempt));
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

// Scrive i valori di `payload` dentro le serie, allungandole con null dove
// serve. Sovrascrive i giorni già presenti (finestra di revisione).
export function mergeRange(series, payload) {
  const { time, mean, max, min } = payload;
  for (let i = 0; i < time.length; i++) {
    const idx = daysBetween(series.start, time[i]);
    if (idx < 0) continue; // prima dell'inizio della serie: ignora
    while (series.mean.length < idx) {
      series.mean.push(null);
      series.max.push(null);
      series.min.push(null);
    }
    series.mean[idx] = mean[i] ?? null;
    series.max[idx] = max[i] ?? null;
    series.min[idx] = min[i] ?? null;
  }
  return series;
}

function lastDateOf(series) {
  return series.mean.length ? addDays(series.start, series.mean.length - 1) : null;
}

export async function run() {
  mkdirSync(dirname(OUT), { recursive: true });
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    /* nessuno snapshot precedente */
  }

  const end = yesterdayISO();
  const out = {};
  let fetched = 0;
  let kept = 0;

  for (const sea of SEAS) {
    const prev = existing[sea.slug];
    const series =
      prev && prev.start === SEA_START
        ? { start: prev.start, mean: [...prev.mean], max: [...prev.max], min: [...prev.min] }
        : { start: SEA_START, mean: [], max: [], min: [] };

    const last = lastDateOf(series);
    // Riparti dalla finestra di revisione, non dal giorno dopo l'ultimo salvato.
    const start = last ? addDays(last, -REVISION_WINDOW_DAYS + 1) : SEA_START;

    if (daysBetween(start, end) < 0) {
      out[sea.slug] = series;
      kept++;
      console.log(`• ${sea.slug}: già aggiornato a ${last}`);
      continue;
    }

    try {
      const j = await fetchRange(sea, start, end);
      mergeRange(series, {
        time: j.daily.time,
        mean: j.daily.sea_surface_temperature_mean,
        max: j.daily.sea_surface_temperature_max,
        min: j.daily.sea_surface_temperature_min,
      });
      out[sea.slug] = series;
      fetched++;
      const valid = series.mean.filter((v) => v != null).length;
      console.log(`✓ ${sea.slug} (${series.start}→${lastDateOf(series)}, ${valid} giorni con dato)`);
    } catch (e) {
      if (prev) {
        out[sea.slug] = prev;
        kept++;
        console.log(`• ${sea.slug}: ${e.message} -> uso snapshot esistente`);
      } else {
        console.log(`✗ ${sea.slug}: ${e.message} -> nessun dato`);
      }
    }
    await sleep(1200);
  }

  // Stessa impronta di integrità di history.json: chiunque riesegua lo script
  // sugli stessi giorni può verificare che il file pubblicato sia questo.
  const h = createHash("sha256");
  for (const slug of Object.keys(out).sort()) {
    h.update(slug);
    h.update(JSON.stringify(out[slug]));
  }

  out._meta = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: "Open-Meteo Marine API (sea surface temperature)",
    seriesStart: SEA_START,
    lastDate: end,
    commit: process.env.VERCEL_GIT_COMMIT_SHA
      ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
      : null,
    sha256: h.digest("hex"),
    note:
      "Serie troppo corta (inizio 2022-11-24) per una tendenza climatica: usare solo per record, stagionalità e confronti anno su anno.",
  };

  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Mari: ${fetched} aggiornati, ${kept} mantenuti. -> ${OUT}`);
}

// Solo se eseguito direttamente (non quando importato dal build o dai test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
