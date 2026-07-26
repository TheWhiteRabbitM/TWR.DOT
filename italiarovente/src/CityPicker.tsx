import { useMemo, useState } from 'react';
import { CITIES, cityName, type City } from './lib/climate';

/**
 * Custom city picker — a button opening a searchable overlay list. Replaces the
 * native <select>, which does not open inside the Polkadot shell's sandboxed
 * iframe (platform-wide dropdown failure).
 */
export function CityPicker({
  selected,
  onSelect,
}: {
  selected: City;
  onSelect: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return CITIES;
    return CITIES.filter(
      (c) =>
        cityName(c).toLowerCase().includes(needle) ||
        c.name.toLowerCase().includes(needle) ||
        c.region.toLowerCase().includes(needle),
    );
  }, [q]);

  return (
    <>
      <button type="button" className="citybtn" onClick={() => setOpen(true)}>
        {cityName(selected)}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div className="pick-overlay" onClick={() => setOpen(false)}>
          <div className="pick-panel" onClick={(e) => e.stopPropagation()}>
            <input
              className="pick-search"
              type="search"
              placeholder="Search 107 cities…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <div className="pick-list">
              {list.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  className={`pick-item${c.slug === selected.slug ? ' on' : ''}`}
                  onClick={() => {
                    onSelect(c.slug);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <span>{cityName(c)}</span>
                  <small>{c.region}</small>
                </button>
              ))}
              {list.length === 0 && <div className="pick-none">No city matches “{q}”.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
