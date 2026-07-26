import { useMemo, useState } from 'react';
import geo from './data/italy.geo.json';
import { nationalRanking, cityName, fmtTemp } from './lib/climate';

/**
 * The map of Italy — the original app's signature view. Every city is a dot
 * coloured by how much it has warmed since 1940 (amber → deep red), sized up
 * for the main cities. Clicking a dot selects that city everywhere else on the
 * page. The coastline comes from the same italy.geo.json the original ships.
 */

const W = 620;
const H = 700;
const PAD = 26;

interface Ring {
  d: string;
}

function useProjection() {
  return useMemo(() => {
    const g = geo as unknown as {
      features: { geometry: { type: string; coordinates: number[][][][] | number[][][] } }[];
    };
    // Collect every ring of every (Multi)Polygon.
    const rings: number[][][] = [];
    for (const f of g.features) {
      const geom = f.geometry;
      if (geom.type === 'Polygon') for (const r of geom.coordinates as number[][][]) rings.push(r);
      else for (const poly of geom.coordinates as number[][][][]) for (const r of poly) rings.push(r);
    }
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const r of rings)
      for (const [lon, lat] of r) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const kx = Math.cos(midLat);
    // Fit the (lon·cos, lat) rectangle into the viewbox.
    const spanX = (maxLon - minLon) * kx;
    const spanY = maxLat - minLat;
    const s = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
    const px = (lon: number) => PAD + (lon - minLon) * kx * s;
    const py = (lat: number) => PAD + (maxLat - lat) * s;
    const paths: Ring[] = rings.map((r) => ({
      d: r.map(([lon, lat], i) => `${i === 0 ? 'M' : 'L'}${px(lon).toFixed(1)},${py(lat).toFixed(1)}`).join(' ') + ' Z',
    }));
    return { paths, px, py };
  }, []);
}

/** Amber → deep red across the warming range. */
function heat(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const from = [244, 180, 76];
  const to = [178, 24, 43];
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * x));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function ItalyMap({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (slug: string) => void;
}) {
  const { paths, px, py } = useProjection();
  const ranked = useMemo(() => nationalRanking(), []);
  const [hover, setHover] = useState<string | null>(null);

  const min = ranked[ranked.length - 1]?.totalChange ?? 0;
  const max = ranked[0]?.totalChange ?? 1;
  const span = max - min || 1;

  const hovered = hover ? ranked.find((r) => r.city.slug === hover) : null;
  const sel = ranked.find((r) => r.city.slug === selected);

  return (
    <section className="mapwrap">
      <div className="map-head">
        <h3>The map</h3>
        <span className="map-note">every dot a city · darker red = warmed more · tap to select</span>
      </div>
      <div className="map-frame-it">
        <svg viewBox={`0 0 ${W} ${H}`} className="map-svg" role="img" aria-label="Map of Italy with cities coloured by warming">
          {paths.map((p, i) => (
            <path key={i} d={p.d} className="map-land" />
          ))}
          {ranked.map((r) => {
            const isSel = r.city.slug === selected;
            return (
              <circle
                key={r.city.slug}
                cx={px(r.city.lon)}
                cy={py(r.city.lat)}
                r={isSel ? 11 : r.city.main ? 7.5 : 5}
                fill={heat((r.totalChange - min) / span)}
                className={`map-dot${isSel ? ' is-sel' : ''}`}
                onClick={() => onSelect(r.city.slug)}
                onPointerEnter={() => setHover(r.city.slug)}
                onPointerLeave={() => setHover(null)}
              >
                <title>{`${cityName(r.city)} ${fmtTemp(r.totalChange)}`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="map-badge">
          {hovered ? (
            <>
              <b>{cityName(hovered.city)}</b> {fmtTemp(hovered.totalChange)} since 1940
            </>
          ) : sel ? (
            <>
              <b>{cityName(sel.city)}</b> {fmtTemp(sel.totalChange)} since 1940
            </>
          ) : (
            'Tap a city'
          )}
        </div>
        <div className="map-scale" aria-hidden="true">
          <span>{fmtTemp(min)}</span>
          <span className="map-grad" />
          <span>{fmtTemp(max)}</span>
        </div>
      </div>
    </section>
  );
}
