# Italia Rovente (.dot)

The **Bulletin-native** build of [italiarovente.app](https://italiarovente.app) — the
same climate record, English-only, as a static site published to Polkadot Bulletin.
Live as `italiarovente.dot`.

This is a **separate app** from the production Next.js one (in `Downloads/RISCALDAMENTO`),
which is left untouched. Design, English city names and the data pipeline are **reused
from the original**, not reinvented.

## What it shows

For each of 107 Italian cities, from the ERA5 reanalysis 1940→today:

- **Warming stripes** — one coloured bar per year (Ed Hawkins' visualisation), blue = cooler
  than the 1961–1990 normal, red = hotter.
- **Headline warming** — how much the yearly average has risen since 1940.
- **Records** — warmest year, hottest day, longest heatwave, hot days vs the mid-century baseline.
- **Yearly average** temperature chart with the trend.
- **The national picture** — every city ranked by how much it has warmed (the Alps lead).

## Why it fits Bulletin

The whole point of the original's `history.json` (2.2 MB, computed once from deep history)
is that it is **static content**. That is exactly what Bulletin hosts: publishing the site
with `pad` puts the data on Bulletin, content-addressed. No server, no API, no database — the
incompatible server parts of the original (AI chat, votes, push, Redis) are simply left out.

## Self-updating (like the original)

The original refreshes its data at build time from the open [Open-Meteo](https://open-meteo.com/)
ERA5 archive. The **same pipeline** is reused here, verbatim:

```bash
npm run update-data   # refresh src/data/history.json from Open-Meteo (all cities)
npm run update-sea    # refresh sea-surface temperatures
npm run build         # typecheck + bundle (CSS + favicon inlined)
# then republish with pad — Bulletin only re-uploads the changed chunks
```

Run on a schedule (cron / CI) → the numbers stay current on their own, and Bulletin's
incremental publish means each refresh only ships what actually changed.

## Design

Material 3 Expressive, the original's palette (red-hot primary `#d23a22` on cream/charcoal),
light and dark. English exonyms for the cities that have a common one (Rome, Milan, Florence,
Turin, Venice, Naples, Genoa, Padua); every other city keeps its Italian name, matching the
original's `/en` pages.

## Development

```bash
npm install
npm run dev     # http://localhost:5178
```

Not a forecast — a record of what has already happened.
