import { useMemo } from 'react';
import { nationalRanking, nationalWarming, cityName, fmtTemp } from './lib/climate';

/**
 * The national picture: average warming across every city, and the leaderboard
 * of where it has warmed most. Each row is selectable so a reader can jump from
 * "who's worst" straight to that city's stripes.
 */
export function Rankings({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (slug: string) => void;
}) {
  const ranked = useMemo(() => nationalRanking(), []);
  const avg = useMemo(() => nationalWarming(), []);
  const max = ranked[0]?.totalChange || 1;
  const myRank = ranked.findIndex((r) => r.city.slug === selected) + 1;

  return (
    <section className="nat">
      <div className="nat-head">
        <div>
          <h3>The national picture</h3>
          <span className="nat-note">
            {ranked.length} cities · avg {fmtTemp(avg)} since 1940
          </span>
        </div>
        {myRank > 0 && (
          <span className="nat-rank">
            current city ranks <strong>#{myRank}</strong> of {ranked.length}
          </span>
        )}
      </div>

      <ol className="board">
        {ranked.slice(0, 10).map((r, i) => (
          <li key={r.city.slug}>
            <button
              type="button"
              className={`board-row${r.city.slug === selected ? ' is-active' : ''}`}
              onClick={() => onSelect(r.city.slug)}
            >
              <span className="board-rank">{i + 1}</span>
              <span className="board-name">
                {cityName(r.city)}
                <span className="board-region">{r.city.region}</span>
              </span>
              <span className="board-bar" aria-hidden="true">
                <span
                  className="board-fill"
                  style={{ width: `${(r.totalChange / max) * 100}%` }}
                />
              </span>
              <span className="board-val">{fmtTemp(r.totalChange)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
