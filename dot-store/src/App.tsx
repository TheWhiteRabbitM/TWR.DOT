import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CATALOG,
  FEATURED,
  findApp,
  initials,
  search,
  tint,
  type App as CatalogApp,
  type Shot,
} from './lib/catalog';
import { appCount, minStatus } from './lib/chain';
import { APP_REVIEWS, DEMO_ENABLED } from './lib/config';
import { openExternal } from './lib/host-nav';
import { openAppChat } from './lib/host-chat';
import { requestHostPermissions } from './lib/host-permissions';
import { LANGS, getLang, locale, setLang, t, useLang, type Lang } from './lib/i18n';
import { MODES, setMode, useMode } from './lib/theme';
import {
  ChevronLeft,
  CircleHalf,
  Magnifier,
  MoonFill,
  StarFill,
  StarOutline,
  SunFill,
} from './lib/symbols';
import {
  cachedRating,
  invalidate,
  localReviews,
  ratingsFor,
  refreshRating,
  reviewsFor,
  saveLocalReview,
  type AppRating,
  type LocalReview,
  type Review,
} from './lib/reviews';

/**
 * dot-store — the shop window for .dot apps.
 *
 * dotmetrics answers "what exists on this chain, and is it true?". This answers
 * "what can I open, and is it any good?". Same hourly pipeline underneath: the
 * catalog is dotmetrics' verified directory, the screenshots are its weekly
 * capture job. Nothing here invents an app or a number.
 *
 * The layout borrows the App Store's grammar because it solves this exact
 * problem: an editorial rail for the few apps worth leading with, three-row
 * shelves for browsing without scrolling forever, and a product page that puts
 * the facts in one hairline-separated row. What it does NOT borrow is the
 * confidence — where Apple can say "1.2M Ratings", we say how many wallets
 * reviewed, and admit that a wallet is not a person on this devnet.
 */

/* ---------------------------------------------------------------- fragments */

function Stars({ value, size = 12 }: { value: number; size?: number }) {
  const full = Math.round(value);
  return (
    <span className="stars" aria-hidden="true" style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) =>
        n <= full ? (
          <StarFill key={n} className="star on" />
        ) : (
          <StarFill key={n} className="star" />
        ),
      )}
    </span>
  );
}

function fmt(n: number, lang: Lang, digits = 1): string {
  return n.toLocaleString(locale(lang), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** The one-line rating summary used on every card. */
function ratingLine(r: AppRating | undefined, lang: Lang): string {
  if (!r || r.count === 0) return t('rating.none');
  const avg = fmt(r.avg!, lang);
  return r.count === 1 ? t('rating.one', { avg }) : t('rating.n', { avg, n: r.count });
}

/**
 * A rounded-square app mark: the published icon over the app's own monogram.
 *
 * The monogram is always rendered and the icon is layered ON TOP of it, rather
 * than the icon being swapped in on success. An `onError` fallback only helps
 * when the request actually fails — an icon fetched from the IPFS gateway is
 * more often merely SLOW, and for those seconds an <img> with no bytes yet is a
 * blank bordered square. Layering means the worst case is the monogram, which is
 * the correct answer anyway.
 */
function Mark({ app, size }: { app: CatalogApp; size: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className={`mark mark-${size}`}
      style={{ background: tint(app.label) }}
      aria-hidden="true"
    >
      <span className="mark-mono">{initials(app.name)}</span>
      {app.iconUrl && !broken && (
        <img src={app.iconUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

/**
 * Artwork for a card, walking down the app's picture list.
 *
 * The first entry is the owner's own screenshot when they declared one, and a
 * declared CID can stop resolving at any time — Bulletin keeps data for about
 * two weeks. So `onError` advances to the next candidate rather than giving up,
 * and only an exhausted list falls through to the monogram. A card is never a
 * hole.
 */
function Art({ app, className, src }: { app: CatalogApp; className: string; src?: Shot }) {
  const list = src ? [src] : app.shots;
  const [i, setI] = useState(0);
  const shot = list[i] ?? null;
  return (
    <span className={className} style={shot ? undefined : { background: tint(app.label) }}>
      {shot ? (
        <img
          src={shot.file}
          alt=""
          loading="lazy"
          onError={() => setI((n) => n + 1)}
        />
      ) : (
        <span className="art-mono" aria-hidden="true">
          {initials(app.name)}
        </span>
      )}
    </span>
  );
}

/**
 * Open, but only where there is something to open.
 *
 * A tier-2 name is registered and nothing else: no contenthash, so no bundle,
 * so the gateway has nothing to serve. Offering a button that leads to an empty
 * page is the one thing a store must not do — Apple does not put GET on an app
 * that isn't there. The name still gets listed, because it genuinely exists on
 * chain, and the slot says what it is instead.
 */
function OpenButton({ app, size = 'sm' }: { app: CatalogApp; size?: 'sm' | 'lg' }) {
  if (app.tier === 2) {
    return <span className="unavail">{t('tier.2')}</span>;
  }
  // Two treatments, because Apple has two. In a list or a shelf the App Store's
  // GET button is a TINTED capsule with the label in the accent colour; the
  // solid filled capsule with white text is reserved for the product page,
  // where it is the page's single primary action. Using the solid fill in both
  // places — which is what this did — makes a browsing screen shout.
  return (
    <button
      type="button"
      className={size === 'lg' ? 'get get-solid' : 'get get-tinted'}
      aria-label={t('open.aria', { name: app.name })}
      onClick={(e) => {
        e.stopPropagation();
        void openExternal(app.openUrl);
      }}
    >
      {t('open')}
    </button>
  );
}

/** The App Store's subtitle slot: a description if there is one, else the status. */
function subtitleOf(app: CatalogApp): string {
  const d = app.description.trim();
  if (d) return d;
  return t(`tier.${app.tier}` as 'tier.0');
}

/* -------------------------------------------------------------------- cards */

/** The editorial card: kicker, headline, artwork, then the install row. */
function TodayCard({ app, onOpen }: { app: CatalogApp; onOpen: (a: CatalogApp) => void }) {
  const lang = useLang();
  const r = cachedRating(app.key);
  return (
    <article className="today" onClick={() => onOpen(app)}>
      <div className="today-head">
        <span className="kicker">{t('kicker.featured')}</span>
        <h3>{app.name}</h3>
        <p>{subtitleOf(app)}</p>
      </div>
      <Art app={app} className="today-art" />
      <div className="today-foot">
        <Mark app={app} size="md" />
        <span className="row-text">
          <span className="row-name">{app.name}</span>
          <span className="row-sub">{ratingLine(r, lang)}</span>
        </span>
        <OpenButton app={app} />
      </div>
    </article>
  );
}

/** One row of a three-row shelf: rank, mark, name, subtitle, Open. */
function ShelfRow({
  app,
  rank,
  onOpen,
}: {
  app: CatalogApp;
  rank?: number;
  onOpen: (a: CatalogApp) => void;
}) {
  const lang = useLang();
  const r = cachedRating(app.key);
  return (
    <div
      className={rank !== undefined ? 'row ranked' : 'row'}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(app)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(app);
        }
      }}
    >
      {rank !== undefined && <span className="rank">{rank}</span>}
      <Mark app={app} size="md" />
      <span className="row-text">
        <span className="row-name">{app.name}</span>
        <span className="row-sub">{rank !== undefined ? ratingLine(r, lang) : subtitleOf(app)}</span>
      </span>
      <OpenButton app={app} />
    </div>
  );
}

/** The grid card, for the full catalogue: artwork above, install row below. */
function GridCard({ app, onOpen }: { app: CatalogApp; onOpen: (a: CatalogApp) => void }) {
  const lang = useLang();
  const r = cachedRating(app.key);
  return (
    <article
      className="card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(app)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(app);
        }
      }}
    >
      <Art app={app} className="card-art" />
      <div className="card-foot">
        <Mark app={app} size="md" />
        <span className="row-text">
          <span className="row-name">{app.name}</span>
          <span className="row-sub">{ratingLine(r, lang)}</span>
        </span>
        <OpenButton app={app} />
      </div>
    </article>
  );
}

/**
 * A shelf header, the App Store's way round.
 *
 * The separator sits ABOVE the title, spanning the content width — it divides
 * this section from the one before it, rather than underlining the heading. That
 * single inversion is most of why a section reads as native or not.
 */
function Shelf({
  title,
  sub,
  children,
  onSeeAll,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  onSeeAll?: () => void;
}) {
  return (
    <section className="shelf">
      <header className="shelf-head">
        <div className="shelf-title">
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {onSeeAll && (
          <button type="button" className="seeall" onClick={onSeeAll}>
            {t('shelf.seeall')}
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------- detail */

function shortAddr(a: string): string {
  if (!a || !a.startsWith('0x') || a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function MetricsBar({ app, r, lang }: { app: CatalogApp; r: AppRating | undefined; lang: Lang }) {
  const when = app.firstSeenAt
    ? new Date(app.firstSeenAt * 1000).toLocaleDateString(locale(lang), {
        month: 'short',
        year: 'numeric',
      })
    : t('info.none');
  return (
    <div className="metrics">
      <div className="metric">
        <span className="metric-k">{t('meta.ratings')}</span>
        {r && r.count > 0 ? (
          <>
            <span className="metric-v">{fmt(r.avg!, lang)}</span>
            <span className="metric-x">
              <Stars value={r.avg!} size={9} />
            </span>
          </>
        ) : (
          <span className="metric-v metric-word">{t('meta.noratings')}</span>
        )}
      </div>
      <div className="metric">
        <span className="metric-k">{t('meta.status')}</span>
        <span className="metric-v metric-word">{t(`tier.${app.tier}` as 'tier.0')}</span>
      </div>
      <div className="metric">
        <span className="metric-k">{t('meta.registered')}</span>
        <span className="metric-v metric-word">{when}</span>
      </div>
      <div className="metric">
        <span className="metric-k">{t('meta.developer')}</span>
        <span className="metric-v metric-word metric-mono">
          {app.owner ? shortAddr(app.owner) : t('meta.unknown')}
        </span>
      </div>
    </div>
  );
}

/** The App Store's ratings block: the average, then the five-bar histogram. */
function Histogram({ reviews, r, lang }: { reviews: Review[]; r: AppRating | undefined; lang: Lang }) {
  const counts = [0, 0, 0, 0, 0];
  for (const rev of reviews) {
    const i = Math.min(5, Math.max(1, Math.round(rev.rating))) - 1;
    counts[i] += 1;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  if (!r || r.count === 0 || total === 0) return null;
  return (
    <div className="hist">
      <div className="hist-avg">
        <span className="hist-num">{fmt(r.avg!, lang)}</span>
        <span className="hist-outof">{t('reviews.outof')}</span>
        <span className="hist-count">{t('reviews.count', { n: r.count })}</span>
      </div>
      <div className="hist-bars">
        {[5, 4, 3, 2, 1].map((star) => (
          <div className="hist-row" key={star}>
            <span className="hist-stars" aria-hidden="true">
              {Array.from({ length: star }, (_, i) => (
                <StarFill key={i} />
              ))}
            </span>
            <span className="hist-track">
              <span
                className="hist-fill"
                style={{ width: `${total ? (counts[star - 1] / total) * 100 : 0}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewRow({ r, lang }: { r: Review; lang: Lang }) {
  const when = new Date(r.at * 1000).toLocaleDateString(locale(lang), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    <li className="rev">
      <div className="rev-top">
        <Stars value={r.rating} />
        <span className={r.status >= 1 ? 'tag tag-ok' : 'tag'}>
          {r.status >= 1 ? t('reviews.verified') : t('reviews.unverified')}
        </span>
        <span className="rev-when">{when}</span>
      </div>
      {r.body && <p className="rev-body">{r.body}</p>}
    </li>
  );
}

type PostState = 'idle' | 'busy' | 'onchain' | 'local' | 'error';

function WriteReview({
  app,
  onPosted,
}: {
  app: CatalogApp;
  /** `landed` distinguishes a real on-chain post from a device-only save. */
  onPosted: (landed: boolean) => void;
}) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [state, setState] = useState<PostState>('idle');
  const [note, setNote] = useState('');
  const [step, setStep] = useState('');

  const submit = async () => {
    if (!rating) {
      setState('error');
      setNote(t('write.need.rating'));
      return;
    }
    setState('busy');
    setStep('');
    try {
      // The signing stack (polkadot-api + chain metadata) is several megabytes.
      // It is imported HERE, on submit, so browsing 72 apps never pays for it.
      const { postReview } = await import('./lib/write');
      const out = await postReview({
        label: app.label,
        name: app.name,
        rating,
        body: body.trim(),
        onStep: setStep,
      });
      if (out.kind === 'onchain') {
        setState('onchain');
        setNote('');
        onPosted(true);
        return;
      }
      if (out.kind === 'error') {
        // A failed attempt is NOT a local save. Storing it would leave a review
        // on the device that the reader believes went somewhere.
        setState('error');
        setNote(`${out.why} (${out.step})`);
        return;
      }
      // Nothing to sign with — keep the review on this device and say so. We
      // never fabricate a transaction to make the UI look successful.
      saveLocalReview({
        label: app.label,
        rating,
        body: body.trim(),
        at: Math.floor(Date.now() / 1000),
      });
      setState('local');
      setNote(out.why);
      onPosted(false);
    } catch (e) {
      setState('error');
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="write">
      <h3>{t('write.h')}</h3>
      <div className="write-stars" role="group" aria-label={t('write.rating')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={n <= rating ? 'pick on' : 'pick'}
            aria-label={String(n)}
            aria-pressed={n === rating}
            onClick={() => setRating(n)}
          >
            {n <= rating ? <StarFill size={1.1} /> : <StarOutline size={1.1} />}
          </button>
        ))}
      </div>
      <textarea
        className="write-body"
        maxLength={280}
        rows={3}
        placeholder={t('write.ph')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="write-actions">
        <button type="button" className="get get-lg" disabled={state === 'busy'} onClick={submit}>
          {state === 'busy' ? t('write.sending') : t('write.send')}
        </button>
        <span className="write-count">{body.length}/280</span>
      </div>
      {state === 'busy' && step && <p className="note">{t('write.step', { step })}</p>}
      {state === 'onchain' && <p className="note note-ok">{t('write.done')}</p>}
      {/* The translated sentence already says everything a reader needs; the
          internal reason is left out of it, because an English fragment glued
          onto an Italian message reads as a leak, not as detail. */}
      {state === 'local' && <p className="note">{t('write.demo')}</p>}
      {state === 'error' && <p className="note note-warn">{t('write.failed', { why: note })}</p>}
    </section>
  );
}

function Detail({
  app,
  onBack,
  onRated,
}: {
  app: CatalogApp;
  onBack: () => void;
  /** Tells the store a rating changed, so cards elsewhere re-render. */
  onRated: () => void;
}) {
  const lang = useLang();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [mine, setMine] = useState<LocalReview | undefined>(() => localReviews()[app.label]);
  const [expanded, setExpanded] = useState(false);
  const r = cachedRating(app.key);

  const load = useCallback(() => {
    setReviews(null);
    void reviewsFor(app.key).then(setReviews);
  }, [app.key]);

  useEffect(load, [load]);

  const desc = app.description.trim();

  return (
    <div className="detail">
      <button type="button" className="back" onClick={onBack}>
        <ChevronLeft size={0.82} /> {t('back')}
      </button>

      <header className="phead">
        <Mark app={app} size="lg" />
        <div className="phead-text">
          <h1>{app.name}</h1>
          <p className="phead-sub">{subtitleOf(app)}</p>
          <div className="phead-actions">
            <OpenButton app={app} size="lg" />
            <span className="phead-dom">{app.domain}</span>
          </div>
        </div>
      </header>

      <MetricsBar app={app} r={r} lang={lang} />

      <section className="block">
        <h2>{t('gallery.h')}</h2>
        {app.shots.length > 0 ? (
          <>
            <div className="gallery">
              {app.shots.map((s, i) => (
                <Art key={`${s.file}-${i}`} app={app} src={s} className="frame" />
              ))}
            </div>
            {/* Who made the picture. We cannot review what a developer uploads,
                so the reader is told rather than left to assume. */}
            <p className="credit">
              {app.shots.some((s) => s.from === 'owner')
                ? t('shot.owner')
                : t('shot.captured')}
            </p>
          </>
        ) : (
          <p className="dim">{t('gallery.none')}</p>
        )}
      </section>

      {desc && (
        <section className="block">
          <h2>{t('about.h')}</h2>
          <p className={expanded ? 'about' : 'about clamp'}>{desc}</p>
          {!expanded && desc.length > 180 && (
            <button type="button" className="linkish" onClick={() => setExpanded(true)}>
              {t('more')}
            </button>
          )}
        </section>
      )}

      <section className="block">
        <h2>{t('reviews.h')}</h2>
        {reviews && <Histogram reviews={reviews} r={r} lang={lang} />}
        {reviews === null ? (
          <p className="dim">{t('reviews.loading')}</p>
        ) : reviews.length === 0 && !mine ? (
          <p className="dim">{t('reviews.none')}</p>
        ) : (
          <ul className="revs">
            {reviews.map((rev, i) => (
              <ReviewRow key={`${rev.author}-${i}`} r={rev} lang={lang} />
            ))}
            {mine && (
              <li className="rev rev-local">
                <div className="rev-top">
                  <Stars value={mine.rating} />
                  <span className="tag">{t('demo.local')}</span>
                </div>
                {mine.body && <p className="rev-body">{mine.body}</p>}
              </li>
            )}
          </ul>
        )}

        {DEMO_ENABLED && (
          <WriteReview
            app={app}
            onPosted={(landed) => {
              setMine(localReviews()[app.label]);
              // The rating shown beside the app's name comes from a module-level
              // cache filled once on load. Dropping the entry is not enough —
              // nothing refills it — so a successful post used to leave "no
              // reviews yet" sitting above the review it had just written.
              // Re-read it, and tell the page when the new figure has arrived.
              invalidate(app.key);
              if (landed) {
                void refreshRating(app.key).then(onRated);
              }
              load();
            }}
          />
        )}
      </section>

      <section className="block">
        <h2>{t('info.h')}</h2>
        <dl className="info">
          <div>
            <dt>{t('info.domain')}</dt>
            <dd className="mono">{app.domain}</dd>
          </div>
          <div>
            <dt>{t('info.owner')}</dt>
            <dd className="mono">{app.owner || t('info.none')}</dd>
          </div>
          <div>
            <dt>{t('info.registered')}</dt>
            <dd>
              {app.firstSeenAt
                ? new Date(app.firstSeenAt * 1000).toLocaleDateString(locale(lang), {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
                : t('info.none')}
            </dd>
          </div>
          <div>
            <dt>{t('info.contract')}</dt>
            <dd className="mono">{APP_REVIEWS}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- app */

/** Break a list into columns of three, the App Store's shelf shape. */
function inThrees<T>(items: T[]): T[][] {
  const cols: T[][] = [];
  for (let i = 0; i < items.length; i += 3) cols.push(items.slice(i, i + 3));
  return cols;
}

function Segmented() {
  const mode = useMode();
  const glyph = { auto: CircleHalf, light: SunFill, dark: MoonFill };
  return (
    <div className="seg" role="group" aria-label={t('appearance.aria')}>
      {MODES.map((m) => {
        const Glyph = glyph[m];
        const label = t(`appearance.${m}` as 'appearance.auto');
        return (
          <button
            key={m}
            type="button"
            className={m === mode ? 'on' : undefined}
            aria-pressed={m === mode}
            title={label}
            onClick={() => setMode(m)}
          >
            <Glyph size={0.95} title={label} />
          </button>
        );
      })}
    </div>
  );
}

export function App() {
  useLang(); // re-render the whole store when the language changes
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<CatalogApp | null>(null);
  const [reviewed, setReviewed] = useState<number | null>(null);
  const [required, setRequired] = useState<number | null>(null);
  const [chainOff, setChainOff] = useState(false);
  /**
   * Bumped once the rating reads land. The ratings live in a module-level cache
   * rather than state (they are read once per session and shared by every card),
   * so this counter is what tells React the cache has content — and it is the
   * dependency the Top-rated shelf is derived from. Without it that shelf
   * memoised an empty list before the first read returned and never recomputed.
   */
  const [ratingsVersion, setRatingsVersion] = useState(0);
  const allRef = useRef<HTMLDivElement | null>(null);

  // Ask for what the sandbox gates before anything needs it.
  useEffect(() => {
    void requestHostPermissions();
  }, []);

  // The store's own chain facts: how many apps carry reviews, and whether the
  // contract currently demands personhood.
  useEffect(() => {
    void appCount().then((n) => {
      setReviewed(n);
      if (n === null) setChainOff(true);
    });
    void minStatus().then(setRequired);
  }, []);

  // Ratings for the catalogue. Cached per session, so scrolling is free.
  useEffect(() => {
    void ratingsFor(CATALOG.map((a) => a.key)).then(() => setRatingsVersion((n) => n + 1));
  }, []);

  // A shareable link per app, and a back gesture that returns to the store
  // instead of leaving it.
  useEffect(() => {
    const sync = () => {
      const m = /^#\/app\/([a-z0-9-]+)$/i.exec(window.location.hash);
      setOpen(m ? (findApp(m[1]) ?? null) : null);
    };
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const openApp = useCallback((a: CatalogApp) => {
    window.location.hash = `#/app/${a.label}`;
    window.scrollTo(0, 0);
  }, []);

  const back = useCallback(() => {
    if (window.location.hash.startsWith('#/app/')) window.history.back();
    else setOpen(null);
  }, []);

  const results = useMemo(() => search(query), [query]);
  const searching = query.trim().length > 0;

  // "New" is a fact we hold exactly: the registration time from the indexer.
  const newest = useMemo(() => CATALOG.slice(0, 12), []);

  // "Top rated" only exists if something is actually rated: an empty top-list
  // padded out with unrated apps would be a ranking we invented. Recomputed
  // when the rating cache fills, which is what ratingsVersion signals.
  const topRated = useMemo(() => {
    const rated = CATALOG.map((a) => ({ a, r: cachedRating(a.key) })).filter(
      (x) => x.r && x.r.count > 0,
    );
    rated.sort((x, y) => y.r!.avg! - x.r!.avg! || y.r!.count - x.r!.count);
    return rated.slice(0, 9).map((x) => x.a);
  }, [ratingsVersion]);

  return (
    <div className="store">
      <header className="bar">
        <span className="brand">
          dot<b>store</b>
        </span>
        <span className="pill">{t('nav.devnet')}</span>
        <span className="grow" />
        <Segmented />
        <div className="seg" role="group">
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              className={l === getLang() ? 'on' : undefined}
              aria-pressed={l === getLang()}
              onClick={() => setLang(l)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {open ? (
        <Detail app={open} onBack={back} onRated={() => setRatingsVersion((n) => n + 1)} />
      ) : (
        <>
          <h1 className="large">{t('nav.apps')}</h1>
          <p className="tagline">{t('app.tagline')}</p>

          <div className="findwrap">
            <span className="findglyph">
              <Magnifier size={1.05} />
            </span>
            <input
              className="find"
              type="search"
              value={query}
              placeholder={t('search.ph')}
              aria-label={t('search.aria')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {searching ? (
            <Shelf title={t('shelf.all')} sub={t('search.results', { n: results.length })}>
              {results.length === 0 ? (
                <p className="dim">{t('search.empty', { q: query.trim() })}</p>
              ) : (
                <div className="grid">
                  {results.map((a) => (
                    <GridCard key={a.label} app={a} onOpen={openApp} />
                  ))}
                </div>
              )}
            </Shelf>
          ) : (
            <>
              {FEATURED.length > 0 && (
                <Shelf title={t('shelf.featured')} sub={t('shelf.featured.sub')}>
                  <div className="rail">
                    {FEATURED.map((a) => (
                      <TodayCard key={a.label} app={a} onOpen={openApp} />
                    ))}
                  </div>
                </Shelf>
              )}

              <Shelf
                title={t('shelf.new')}
                sub={t('shelf.new.sub')}
                onSeeAll={() => allRef.current?.scrollIntoView({ behavior: 'smooth' })}
              >
                <div className="threes">
                  {inThrees(newest).map((col, i) => (
                    <div className="col" key={i}>
                      {col.map((a) => (
                        <ShelfRow key={a.label} app={a} onOpen={openApp} />
                      ))}
                    </div>
                  ))}
                </div>
              </Shelf>

              {topRated.length > 0 && (
                <Shelf title={t('shelf.top')} sub={t('shelf.top.sub')}>
                  <div className="threes">
                    {inThrees(topRated).map((col, i) => (
                      <div className="col" key={i}>
                        {col.map((a, j) => (
                          <ShelfRow key={a.label} app={a} rank={i * 3 + j + 1} onOpen={openApp} />
                        ))}
                      </div>
                    ))}
                  </div>
                </Shelf>
              )}

              <div ref={allRef}>
                <Shelf title={t('shelf.all')} sub={t('shelf.all.sub', { n: CATALOG.length })}>
                  <div className="grid">
                    {CATALOG.map((a) => (
                      <GridCard key={a.label} app={a} onOpen={openApp} />
                    ))}
                  </div>
                </Shelf>
              </div>
            </>
          )}

          {/* Nobody can use a convention they cannot find. The two text records
              that control a card are documented here, in the store itself. */}
          <section className="devbox">
            <h2>{t('dev.h')}</h2>
            <p>{t('dev.body')}</p>
            <p className="devstep">{t('dev.desc')}</p>
            <pre>
              dotns text set &lt;name&gt;.dot manifest{' '}
              {'\'{"displayName":"Your App","description":"…"}\''} --env devnet
            </pre>
            <p className="devstep">{t('dev.shots')}</p>
            <pre>dotns text set &lt;name&gt;.dot screenshots bafy…,bafy… --env devnet</pre>
            <p className="devnote">{t('dev.note')}</p>
          </section>

          <p className="disclose">
            {chainOff
              ? t('chain.off')
              : `${reviewed !== null ? t('chain.reviewed', { n: reviewed }) + ' · ' : ''}${
                  required === 0 ? t('chain.open') : ''
                }`}
          </p>
        </>
      )}

      <footer className="foot">
        <button
          type="button"
          className="linkish"
          onClick={() => void openExternal('https://dotmetrics.dev-dot.li/?chainBackend=rpc-gateway')}
        >
          {t('foot.metrics')}
        </button>
        <button
          type="button"
          className="linkish"
          onClick={() => void openAppChat('dot-store', 'dot-store community')}
        >
          {t('foot.chat')}
        </button>
        <span className="foot-note">{t('foot.devnet')}</span>
      </footer>
    </div>
  );
}
