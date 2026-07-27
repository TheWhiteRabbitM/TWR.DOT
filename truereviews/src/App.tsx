import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Place, PlaceDetail, ReviewsDriver, Review } from './lib/types';
import { createMockDriver } from './lib/mock';
import { Splash } from './Splash';
import { openAppChat } from './lib/host-chat';
import { readContractStatus, readOnChainReviews } from './lib/chain';
import { REVIEW_REGISTRY } from './lib/config';
import { osmLink, mapsLink } from './lib/osm';
import { openExternal, copyText, type OpenResult } from './lib/host-nav';
import { Stars, RatePicker } from './Stars';
import { usePlacePhoto } from './usePlacePhoto';
import {
  pseudonym,
  initials,
  avatarColor,
  timeAgo,
  starWord,
  categoryGradient,
  FAMILIES,
} from './lib/format';

/* ------------------------------------------------------------------ icons */

const I = {
  search: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  back: (
    <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2L2 10l8 8" />
    </svg>
  ),
  chevron: (
    <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1l6 6-6 6" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.2 14.2l-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z" />
    </svg>
  ),
  discover: (on: boolean) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" fill={on ? '#fff' : 'currentColor'} stroke="none" />
    </svg>
  ),
  star: (on: boolean) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.8 6.5 19.7l1.2-6.1-4.5-4.2 6.1-.8z" />
    </svg>
  ),
  info: (on: boolean) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" stroke={on ? '#fff' : 'currentColor'} strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="1.1" fill={on ? '#fff' : 'currentColor'} stroke="none" />
    </svg>
  ),
  pencil: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17z" />
    </svg>
  ),
  map: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
};

/* -------------------------------------------------------------- scroll hook */

function useScrolled(threshold = 40): boolean {
  const [s, setS] = useState(false);
  useEffect(() => {
    const on = () => setS(window.scrollY > threshold);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [threshold]);
  return s;
}

/* ------------------------------------------------------------------ nav bar */

function NavBar({
  title,
  large,
  onBack,
  right,
}: {
  title: string;
  large?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const scrolled = useScrolled();
  return (
    <div className={`nav${scrolled ? ' scrolled' : ''}`}>
      <div className="nav-bar">
        {onBack ? (
          <button className="nav-btn" onClick={onBack} aria-label="Back">
            {I.back}
            <span>Back</span>
          </button>
        ) : (
          <span className="nav-spacer" />
        )}
        <span className="nav-title">{title}</span>
        {right ?? <span className="nav-spacer" />}
      </div>
      {large && <h1 className="large-title">{large}</h1>}
    </div>
  );
}

/* ------------------------------------------------------------- place row */

function PlaceCard({
  place,
  onOpen,
  index,
}: {
  place: Place;
  onOpen: (p: Place) => void;
  index: number;
}) {
  const rated = place.fullCount > 0;
  const { ref: photoRef, photo, onError } = usePlacePhoto(place);
  return (
    <button
      className="pcard"
      style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
      onClick={() => onOpen(place)}
    >
      {/* The glyph panel is always painted; a photo is layered over it. A place
          with no photo — the common case — still looks finished, and a file
          that 404s falls back instead of leaving an empty frame. */}
      <span
        className="pcard-banner"
        ref={photoRef}
        style={{ backgroundImage: categoryGradient(place.category) }}
      >
        <span className="pcard-emoji" aria-hidden="true">
          {place.emoji}
        </span>
        {photo && (
          <img className="pcard-photo" src={photo.url} alt="" loading="lazy" onError={onError} />
        )}
      </span>
      {/* Sibling of the banner, not a child: the banner clips its overflow for
          the emoji, and a child badge straddling the seam got cut in half. */}
      {rated ? (
        <span className="pcard-badge">
          <b>{place.avgFull.toFixed(1)}</b>
          <Stars value={place.avgFull} />
        </span>
      ) : (
        <span className="pcard-badge is-new">Be the first ✨</span>
      )}
      <span className="pcard-body">
        <span className="pcard-name">{place.name}</span>
        <span className="pcard-sub">
          {place.category}
          {place.address ? ` · ${place.address}` : ''}
        </span>
        <span className="pcard-foot">
          {rated ? (
            <>
              <span className="verified">
                {I.check} {place.fullCount} verified
              </span>
              {place.liteCount > 0 && <span className="badge-lite">+{place.liteCount}</span>}
            </>
          ) : (
            <span className="pcard-foot-dim">No verified reviews yet</span>
          )}
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------- review card */

function ReviewCard({ review }: { review: Review }) {
  const name = pseudonym(review.alias);
  return (
    <div className="review">
      <div className="review-top">
        <span className="avatar" style={{ background: avatarColor(review.alias) }}>
          {initials(name)}
        </span>
        <span className="review-who">
          <span className="review-name">
            {name}
            {review.tier >= 2 ? (
              <span className="verified">{I.check} Verified person</span>
            ) : (
              <span className="badge-lite">provisional</span>
            )}
          </span>
          <span className="review-when">{timeAgo(review.at)}</span>
        </span>
      </div>
      <div className="review-stars">
        <Stars value={review.rating} />
      </div>
      {review.body && <p className="review-body">{review.body}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ home */

function Home({ driver, onOpen }: { driver: ReviewsDriver; onOpen: (p: Place) => void }) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<Place[] | null>(null);
  const [results, setResults] = useState<Place[] | null>(null);
  const [fam, setFam] = useState('all');

  useEffect(() => {
    void driver.recent().then(setRecent);
  }, [driver]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    setResults(null); // clear → skeletons show while the new search runs
    const t = window.setTimeout(() => {
      void driver
        .search(q)
        .then((r) => setResults(r))
        .catch(() => setResults([]));
    }, 450);
    return () => window.clearTimeout(t);
  }, [query, driver]);

  const [sort, setSort] = useState<'top' | 'reviewed' | 'new'>('reviewed');

  const showResults = query.trim().length >= 2;
  const rawList = showResults ? results : recent;
  const filtered =
    rawList == null
      ? null
      : fam === 'all'
        ? rawList
        : rawList.filter((p) => matchFamily(p.category, fam));
  const list =
    filtered == null
      ? null
      : [...filtered].sort((a, b) => {
          if (sort === 'top') return b.avgFull - a.avgFull || b.fullCount - a.fullCount;
          if (sort === 'new') return 0; // driver order ~ recency for search results
          return b.fullCount + b.liteCount - (a.fullCount + a.liteCount);
        });
  const featured =
    !showResults && recent
      ? [...recent].filter((p) => p.fullCount > 0).sort((a, b) => b.avgFull - a.avgFull).slice(0, 5)
      : [];

  return (
    <div className="screen">
      <NavBar title="Discover" large="Discover" />
      <div className="searchbar">
        <div className="searchbar-inner">
          {I.search}
          <input
            type="search"
            placeholder="Search a place, café, restaurant…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear">
              ✕
            </button>
          )}
        </div>
      </div>

      {driver.demo && (
        <div className="demo-banner">
          <b>Demo mode.</b> Real OpenStreetMap search, seeded places, post freely. On the live
          network every review is signed by a verified human, one per place.
        </div>
      )}
      <ChainChip />
      <ChatButton roomId="truereviews" name="TrueReviews community" />

      <div className="chips-row">
        <button
          type="button"
          className={`fchip${fam === 'all' ? ' on' : ''}`}
          onClick={() => setFam('all')}
        >
          All
        </button>
        {FAMILIES.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`fchip${fam === f.key ? ' on' : ''}`}
            onClick={() => setFam(fam === f.key ? 'all' : f.key)}
          >
            <span className="fchip-e" aria-hidden="true">
              {f.emoji}
            </span>{' '}
            {f.label}
          </button>
        ))}
      </div>

      {featured.length >= 3 && (
        <>
          <div className="section-hd">Loved by verified humans</div>
          <div className="feat-row">
            {featured.map((p) => (
              <FeaturedCard key={p.key} place={p} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}

      <div className="content">
        <div className="list-head">
          <div className="section-hd">{showResults ? 'Results' : 'All places'}</div>
          <div className="seg" role="tablist" aria-label="Sort">
            {(
              [
                ['reviewed', 'Popular'],
                ['top', 'Top rated'],
                ['new', 'Newest'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={sort === k}
                className={`seg-btn${sort === k ? ' on' : ''}`}
                onClick={() => setSort(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {list == null ? (
          <CardSkeletons />
        ) : list.length ? (
          <div className="cards-list">
            {list.map((p, i) => (
              <PlaceCard key={p.key} place={p} onOpen={onOpen} index={i} />
            ))}
          </div>
        ) : (
          <div className="empty">
            {showResults ? `No places found for “${query}”.` : 'Nothing in this category yet.'}
          </div>
        )}
      </div>
    </div>
  );
}

/** A place in the "loved by verified humans" strip, with its own lazy photo. */
function FeaturedCard({ place, onOpen }: { place: Place; onOpen: (p: Place) => void }) {
  const { ref, photo, onError } = usePlacePhoto(place);
  return (
    <button className="feat-card" onClick={() => onOpen(place)}>
      <span
        className="feat-banner"
        ref={ref}
        style={{ backgroundImage: categoryGradient(place.category) }}
      >
        <span className="feat-emoji" aria-hidden="true">
          {place.emoji}
        </span>
        {photo && (
          <img className="pcard-photo" src={photo.url} alt="" loading="lazy" onError={onError} />
        )}
      </span>
      <span className="feat-body">
        <span className="feat-name">{place.name}</span>
        <span className="feat-meta">
          <b>{place.avgFull.toFixed(1)}</b> <Stars value={place.avgFull} /> · {place.fullCount}
        </span>
      </span>
    </button>
  );
}

/**
 * Shown when a link could not be opened for the user — inside the Polkadot
 * shell that happens when the host channel is wedged or the sandbox blocks
 * popups. The link is never lost: it is readable, copyable, and tappable as a
 * real anchor (a genuine user gesture is the most permissive path a browser
 * offers). The trail line is what turns "it does nothing" into a cause.
 */
function LinkSheet({ result, onClose }: { result: OpenResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    setCopied(await copyText(result.url));
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="ls-backdrop" onClick={onClose} role="presentation">
      <div className="ls-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="ls-title">Open this link</h3>
        <p className="ls-lede">
          The app couldn&apos;t hand this to your browser by itself. Tap it below, or copy it.
        </p>
        <a className="ls-url" href={result.url} target="_blank" rel="noreferrer" onClick={onClose}>
          {result.url}
        </a>
        <div className="ls-actions">
          <button type="button" className="btn filled block" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button type="button" className="btn tonal block" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="ls-trail">couldn&apos;t open automatically · {result.trail}</p>
      </div>
    </div>
  );
}

/** One-tap link into the Polkadot app's built-in chat (community room). */
function ChatButton({ roomId, name }: { roomId: string; name: string }) {
  const [label, setLabel] = useState('💬 Community chat');
  const go = async () => {
    setLabel('Opening…');
    const r = await openAppChat(roomId, name);
    // "registered" is a real outcome, not a failure: the room exists in the
    // user's chat list even when the host refuses to jump there for us.
    if (r.status === 'outside') setLabel('Chat lives inside the Polkadot app');
    else if (r.status === 'failed') setLabel('Chat unavailable right now');
    else if (r.status === 'registered') setLabel('Room added — open the Chat tab');
    else setLabel('Opened in chat ✓');
    window.setTimeout(() => setLabel('💬 Community chat'), 3200);
  };
  return (
    <button type="button" className="chat-cta" onClick={go}>
      {label}
    </button>
  );
}

/**
 * Live status of the deployed ReviewRegistry, read on every load. This is the
 * app's own smart contract answering a real eth_call — not decoration.
 */
function ChainChip() {
  const [state, setState] = useState<'checking' | 'off' | number>('checking');
  useEffect(() => {
    let cancelled = false;
    readContractStatus()
      .then((s) => !cancelled && setState(s.places))
      .catch(() => !cancelled && setState('off'));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className={`chain-chip${state === 'off' ? ' is-off' : ''}`} title={REVIEW_REGISTRY}>
      <span className="chain-dot" />
      {state === 'checking'
        ? 'Reaching ReviewRegistry on Asset Hub…'
        : state === 'off'
          ? 'Contract unreachable right now — demo data only'
          : `ReviewRegistry live on-chain · ${state} place${state === 1 ? '' : 's'} reviewed on the contract`}
    </div>
  );
}

function matchFamily(category: string, famKey: string): boolean {
  const f = FAMILIES.find((x) => x.key === famKey);
  return f ? f.match.test(category) : true;
}

function CardSkeletons() {
  return (
    <div className="cards-list">
      {[0, 1, 2].map((i) => (
        <div className="pcard" key={i} style={{ pointerEvents: 'none' }}>
          <span className="pcard-banner skel" style={{ borderRadius: 0 }} />
          <span className="pcard-body">
            <span className="skel" style={{ display: 'block', height: 18, width: '60%' }} />
            <span className="skel" style={{ display: 'block', height: 13, width: '40%', marginTop: 8 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="group">
      {[0, 1, 2].map((i) => (
        <div className="row" key={i}>
          <span className="pin skel" />
          <span className="row-main">
            <span className="skel" style={{ display: 'block', height: 15, width: '55%' }} />
            <span className="skel" style={{ display: 'block', height: 12, width: '35%', marginTop: 6 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- place view */

function PlaceView({
  driver,
  place,
  onBack,
  onWrite,
  onLink,
  detail,
}: {
  driver: ReviewsDriver;
  place: Place;
  onBack: () => void;
  onWrite: (p: Place) => void;
  onLink: (url: string) => void;
  detail: PlaceDetail | null;
}) {
  const [onChain, setOnChain] = useState<number | null>(null);
  const [revSort, setRevSort] = useState<'new' | 'high' | 'low'>('new');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readOnChainReviews(place.osmRef).then((n) => !cancelled && setOnChain(n));
    return () => {
      cancelled = true;
    };
  }, [place.osmRef]);
  const d = detail;

  const sortedReviews = useMemo(() => {
    const list = d ? [...d.reviews] : [];
    if (revSort === 'high') list.sort((a, b) => b.rating - a.rating || b.at - a.at);
    else if (revSort === 'low') list.sort((a, b) => a.rating - b.rating || b.at - a.at);
    return list;
  }, [d, revSort]);

  const share = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}#/p/${place.osmRef}`;
    const doCopy = () =>
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      });
    if (navigator.share) {
      navigator.share({ title: place.name, text: `${place.name} on TrueReviews`, url }).catch(() => doCopy());
    } else {
      void doCopy();
    }
  }, [place]);
  const total = d ? d.place.fullCount + d.place.liteCount : 0;
  const maxBar = d ? Math.max(1, ...d.histogram) : 1;

  return (
    <div className="screen enter">
      <NavBar title={place.name} onBack={onBack} />
      <div className="hero">
        <div className="hero-name">{place.name}</div>
        <div className="hero-meta">
          {place.emoji} {place.category}
          {place.address ? ` · ${place.address}` : ''}
        </div>

        {d && d.place.fullCount > 0 ? (
          <div className="hero-score">
            <span className="score-num">{d.place.avgFull.toFixed(1)}</span>
            <span className="score-side">
              <Stars value={d.place.avgFull} size="lg" />
              <span className="score-count">
                {d.place.fullCount} verified
                {d.place.liteCount ? ` · ${d.place.liteCount} provisional` : ''}
              </span>
            </span>
          </div>
        ) : (
          <div className="hero-score">
            <Stars value={0} size="lg" />
            <span className="score-count">No verified reviews yet</span>
          </div>
        )}
      </div>

      <MapCard place={place} onLink={onLink} />

      {d && total > 0 && (
        <div className="dist">
          {[5, 4, 3, 2, 1].map((star) => (
            <div className="dist-row" key={star}>
              <span>{star}</span>
              <span className="dist-track">
                <span
                  className="dist-fill"
                  style={{ width: `${(d.histogram[star - 1] / maxBar) * 100}%` }}
                />
              </span>
              <span style={{ textAlign: 'right' }}>{d.histogram[star - 1]}</span>
            </div>
          ))}
        </div>
      )}

      <div className="cta">
        {d && d.yourRating > 0 ? (
          <button className="btn tonal block" onClick={() => onWrite(place)}>
            {I.pencil} You rated {d.yourRating}★ — edit
          </button>
        ) : (
          <button className="btn filled block" onClick={() => onWrite(place)}>
            {I.pencil} Write a review
          </button>
        )}
      </div>

      <div className="linkchips">
        <a
          className="chip"
          href={osmLink(place)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.preventDefault();
            onLink(osmLink(place));
          }}
        >
          {I.map} OpenStreetMap
        </a>
        <a
          className="chip"
          href={mapsLink(place)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.preventDefault();
            onLink(mapsLink(place));
          }}
        >
          {I.map} Google Maps
        </a>
        <button className="chip" onClick={share}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M8 7l4-4 4 4" />
            <path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
          </svg>
          {copied ? 'Copied!' : 'Share'}
        </button>
      </div>

      {onChain != null && (
        <div className="chain-chip" style={{ margin: '10px 16px 0' }} title={REVIEW_REGISTRY}>
          <span className="chain-dot" />
          {onChain === 0
            ? 'On the contract: no on-chain review here yet — the first verified human writes history'
            : `On the contract: ${onChain} on-chain review${onChain === 1 ? '' : 's'} for this place`}
        </div>
      )}

      <div className="list-head">
        <div className="section-hd">
          {total > 0 ? `${total} review${total === 1 ? '' : 's'}` : 'Reviews'}
        </div>
        {total > 1 && (
          <div className="seg" role="tablist" aria-label="Sort reviews">
            {(
              [
                ['new', 'Newest'],
                ['high', 'Highest'],
                ['low', 'Lowest'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={revSort === k}
                className={`seg-btn${revSort === k ? ' on' : ''}`}
                onClick={() => setRevSort(k)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!d ? (
        <SkeletonList />
      ) : sortedReviews.length ? (
        <div className="reviews">
          {sortedReviews.map((r, i) => (
            <ReviewCard key={`${r.alias}-${i}`} review={r} />
          ))}
        </div>
      ) : (
        <div className="empty">No reviews yet. Be the first verified voice here.</div>
      )}
      <div style={{ height: 8 }} />
      <PlatformNote demo={driver.demo} />
    </div>
  );
}

/**
 * Map of the place from raw OSM PNG tiles — plain <img> elements, no iframe.
 * The previous version embedded openstreetmap.org in a nested iframe, which
 * the host shell's sandbox blocks and which could take the whole app down.
 * Tiles are just images: if they fail to load the card hides itself, never
 * crashing anything. Standard slippy-map math places the pin.
 */
const TILE_Z = 16;
const TILE = 256;
const GRID_W = 3;
const GRID_H = 2;

function MapCard({ place, onLink }: { place: Place; onLink: (url: string) => void }) {
  const [broken, setBroken] = useState(false);
  if (!place.lat || !place.lon || broken) return null;

  const n = 2 ** TILE_Z;
  const xt = ((place.lon + 180) / 360) * n;
  const latRad = (place.lat * Math.PI) / 180;
  const yt = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  // Grid positioned so the pin lands centrally.
  const x0 = Math.floor(xt) - 1;
  const y0 = Math.floor(yt);
  const pinX = ((xt - x0) / GRID_W) * 100;
  const pinY = ((yt - y0) / GRID_H) * 100;

  const tiles: { x: number; y: number }[] = [];
  for (let dy = 0; dy < GRID_H; dy += 1)
    for (let dx = 0; dx < GRID_W; dx += 1) tiles.push({ x: x0 + dx, y: y0 + dy });

  return (
    <a
      className="map-card"
      href={mapsLink(place)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Map of ${place.name}`}
      onClick={(e) => {
        // Sandboxed anchors never leave the shell — route through the host,
        // which opens https:// in the system browser (Google Maps).
        e.preventDefault();
        onLink(mapsLink(place));
      }}
    >
      <span
        className="tile-grid"
        style={{ aspectRatio: `${GRID_W * TILE} / ${GRID_H * TILE}` }}
      >
        {tiles.map((t) => (
          <img
            key={`${t.x}/${t.y}`}
            src={`https://tile.openstreetmap.org/${TILE_Z}/${t.x}/${t.y}.png`}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ))}
        <span className="tile-pin" style={{ left: `${pinX}%`, top: `${pinY}%` }} aria-hidden="true">
          📍
        </span>
      </span>
      <span className="map-open">{I.map} Open map</span>
      <span className="map-credit">© OpenStreetMap</span>
    </a>
  );
}

function PlatformNote({ demo }: { demo: boolean }) {
  return (
    <div className="demo-banner">
      {demo
        ? 'Reviews here are anchored to this exact place on OpenStreetMap. On the live network each one is one-per-verified-human — no bought or bot reviews.'
        : 'Each review is signed by a distinct verified human, one per place, on Polkadot.'}
    </div>
  );
}

/* -------------------------------------------------------------- review sheet */

function ReviewSheet({
  place,
  driver,
  initial,
  onClose,
  onDone,
}: {
  place: Place;
  driver: ReviewsDriver;
  initial: number;
  onClose: () => void;
  onDone: (d: PlaceDetail, edited: boolean) => void;
}) {
  const [rating, setRating] = useState(initial);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 280);
  }, [onClose]);

  const submit = async () => {
    if (rating < 1 || busy) return;
    setBusy(true);
    try {
      const d = await driver.review(place, rating, body.trim());
      onDone(d, initial > 0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="backdrop" onClick={close} />
      <div className={`sheet${closing ? ' closing' : ''}`} role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-hd">
          <button className="nav-btn" onClick={close}>
            Cancel
          </button>
          <h2>{initial > 0 ? 'Edit review' : 'Write a review'}</h2>
          <button className="nav-btn right" onClick={submit} disabled={rating < 1 || busy}>
            {busy ? 'Posting…' : initial > 0 ? 'Update' : 'Post'}
          </button>
        </div>
        <div className="sheet-body">
          <div className="sheet-place">
            {place.emoji} {place.name}
          </div>
          <RatePicker value={rating} onChange={setRating} />
          <div className="rate-label">{starWord(rating)}</div>
          <textarea
            className="field"
            placeholder="Share what stood out — honest and specific helps most."
            maxLength={600}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="field-foot">{body.length}/600</div>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- my reviews */

function MyReviews({
  driver,
  onOpen,
}: {
  driver: ReviewsDriver;
  onOpen: (p: Place) => void;
}) {
  const [mine, setMine] = useState<{ place: Place; review: Review }[] | null>(null);

  useEffect(() => {
    void driver.mine().then(setMine);
  }, [driver]);

  return (
    <div className="screen">
      <NavBar title="My reviews" large="My reviews" />
      <div className="content">
        {mine == null ? (
          <CardSkeletons />
        ) : mine.length === 0 ? (
          <div className="empty">
            You haven't reviewed anywhere yet.
            <br />
            Find a place in Discover and be its first verified voice.
          </div>
        ) : (
          <div className="reviews" style={{ marginTop: 8 }}>
            {mine.map(({ place, review }) => (
              <button
                key={place.key}
                className="review"
                style={{ textAlign: 'left', border: 'none', width: '100%', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
                onClick={() => onOpen(place)}
              >
                <div className="review-top">
                  <span className="pin" style={{ width: 38, height: 38, fontSize: 19 }}>
                    {place.emoji}
                  </span>
                  <span className="review-who">
                    <span className="review-name">{place.name}</span>
                    <span className="review-when">{timeAgo(review.at)}</span>
                  </span>
                  <Stars value={review.rating} />
                </div>
                {review.body && <p className="review-body">{review.body}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- how it works */

function HowItWorks() {
  return (
    <div className="screen">
      <NavBar title="How it works" large="How it works" />
      <div className="content">
        <div className="section-hd">The idea</div>
        <div className="group">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span className="pin">🧍</span>
            <span className="row-main">
              <span className="row-title">One human, one review</span>
              <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                Every review is signed by a distinct verified person — proof of personhood, not an
                email. No bought reviews, no bot swarms, no second account.
              </span>
            </span>
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span className="pin">📍</span>
            <span className="row-main">
              <span className="row-title">Anchored to real places</span>
              <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                Each place is tied to its OpenStreetMap identifier, so everyone reviews the same
                real business — and it links back to the map.
              </span>
            </span>
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span className="pin">🔓</span>
            <span className="row-main">
              <span className="row-title">Public and verifiable</span>
              <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                Reviews live on Polkadot; the text on Bulletin. Anyone can read and check the count.
                Nobody can quietly delete a bad review.
              </span>
            </span>
          </div>
        </div>
        <div className="demo-banner">
          Verified vs provisional: full personhood counts as a verified review and drives the score;
          a lighter tier is shown separately as provisional, never mixed in.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ app */

export function App() {
  const driverRef = useRef<ReviewsDriver>(createMockDriver());
  const driver = driverRef.current;

  const [tab, setTab] = useState<'discover' | 'mine' | 'how'>('discover');
  // Launch splash: shown over the app while the first data loads underneath.
  const [splash, setSplash] = useState(true);
  const [place, setPlace] = useState<Place | null>(null);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [sheet, setSheet] = useState<{ place: Place; initial: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [linkSheet, setLinkSheet] = useState<OpenResult | null>(null);
  const [nudge, setNudge] = useState<OpenResult | null>(null);

  // The "didn't open?" offer is short-lived: if the link did open, the user is
  // in another app and will never see it expire.
  useEffect(() => {
    if (!nudge) return;
    const t = window.setTimeout(() => setNudge(null), 6000);
    return () => window.clearTimeout(t);
  }, [nudge]);

  const openPlace = useCallback(
    (p: Place) => {
      setPlace(p);
      setDetail(null);
      window.scrollTo(0, 0);
      // Deep-linkable: #/p/<osmRef> — a shared link opens straight on the place.
      window.location.hash = `#/p/${p.osmRef}`;
      void driver.detail(p.key).then(setDetail);
    },
    [driver],
  );

  // Unwind the history entry rather than pushing a new one, so the in-app back
  // button and the shell's back gesture leave the stack in the same state.
  const back = useCallback(() => {
    if (window.location.hash.startsWith('#/p/')) window.history.back();
    else {
      setPlace(null);
      setDetail(null);
    }
  }, []);

  /**
   * Follow the address bar, don't just write to it.
   *
   * Opening a place pushes a history entry, but nothing here listened for it
   * being popped: a back gesture rewound the hash while the view stayed put, so
   * it read as "nothing happened" — and the next swipe, with our entry already
   * gone, closed the whole app instead of going back.
   */
  useEffect(() => {
    const sync = () => {
      const m = /^#\/p\/(.+)$/.exec(window.location.hash);
      if (!m) {
        setPlace(null);
        setDetail(null);
        return;
      }
      const ref = decodeURIComponent(m[1]);
      setPlace((cur) => {
        if (cur && cur.osmRef === ref) return cur;
        void driver.detail(ref).then((d) => {
          if (d.place.name !== 'Place') {
            setPlace(d.place);
            setDetail(d);
          }
        });
        return cur;
      });
    };
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, [driver]);

  // Open a place directly when arriving on a #/p/<osmRef> share link.
  useEffect(() => {
    const m = /^#\/p\/(.+)$/.exec(window.location.hash);
    if (!m) return;
    const ref = decodeURIComponent(m[1]);
    void driver.detail(ref).then((d) => {
      if (d.place.name !== 'Place') {
        setPlace(d.place);
        setDetail(d);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  }, []);

  const openSheet = useCallback(
    (p: Place) => setSheet({ place: p, initial: detail?.yourRating ?? 0 }),
    [detail],
  );

  /**
   * Leave the app for a map. Inside the shell this hands the URL to the host;
   * if the host is wedged, refuses, or the popup is blocked, the link sheet
   * opens so the user always ends up with a usable link instead of a dead tap.
   */
  const openLink = useCallback(
    (url: string) => {
      void openExternal(url, {
        onFallback: (r) => setLinkSheet(r),
        onLate: () => setLinkSheet(null),
      }).then((r) => {
        if (r.via === 'host') showToast('Opened in your browser');
        // "It says it opened" is not the same as "it opened": some shells hand
        // back a window that never appears. The confirmation is tappable, so
        // the link is one touch away instead of gone.
        else if (r.via === 'popup') setNudge({ ...r, via: 'manual' });
      });
    },
    [showToast],
  );

  return (
    <div className="app">
      {splash && <Splash onDone={() => setSplash(false)} />}
      {place ? (
        <PlaceView
          driver={driver}
          place={place}
          detail={detail}
          onBack={back}
          onWrite={openSheet}
          onLink={openLink}
        />
      ) : tab === 'discover' ? (
        <Home driver={driver} onOpen={openPlace} />
      ) : tab === 'mine' ? (
        <MyReviews driver={driver} onOpen={openPlace} />
      ) : (
        <HowItWorks />
      )}

      {sheet && (
        <ReviewSheet
          place={sheet.place}
          driver={driver}
          initial={sheet.initial}
          onClose={() => setSheet(null)}
          onDone={(d, edited) => {
            setSheet(null);
            setDetail(d);
            if (place?.key === d.place.key) setPlace(d.place);
            showToast(edited ? 'Review updated' : 'Thanks — your review is live');
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      {nudge && (
        <button
          type="button"
          className="toast toast-action"
          onClick={() => {
            setLinkSheet(nudge);
            setNudge(null);
          }}
        >
          Opened in a new tab · <b>not there? tap for the link</b>
        </button>
      )}
      {linkSheet && <LinkSheet result={linkSheet} onClose={() => setLinkSheet(null)} />}

      {!place && (
        <nav className="tabbar">
          <button className={`tab${tab === 'discover' ? ' on' : ''}`} onClick={() => setTab('discover')}>
            {I.discover(tab === 'discover')}
            Discover
          </button>
          <button className={`tab${tab === 'mine' ? ' on' : ''}`} onClick={() => setTab('mine')}>
            {I.star(tab === 'mine')}
            My reviews
          </button>
          <button className={`tab${tab === 'how' ? ' on' : ''}`} onClick={() => setTab('how')}>
            {I.info(tab === 'how')}
            How it works
          </button>
        </nav>
      )}
    </div>
  );
}
