import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadIndex,
  loadFullIndex,
  loadArchiveThread,
  liveTopicsInCategory,
  liveTopicsAll,
  liveThread,
  categoryKeyOf,
  pfpForMask,
  pfpOfMask,
  type ForumIndex,
  type ArchiveCategory,
  type ArchiveTopicRow,
  type ArchiveThread,
  type LivePost,
} from './chain';
import { getSigner, type Signer } from './forum';
import {
  getFilters,
  onFiltersChanged,
  hiddenReason,
  muteWord,
  unmuteWord,
  muteMask,
  unmuteMask,
  clearFilters,
  exportFilters,
  importFilters,
} from './filters';
import { Composer } from './Composer';
import { Thread } from './Thread';
import { fmtWhen, avatarUrl, initials } from './ui';

/**
 * The Polkadot Forum, on chain — laid out like the Discourse forum people know:
 * a left category/tag sidebar, a two-column home (Categories | Latest), and the
 * same topic/thread chrome. The substance underneath: the whole archive
 * read-only (original authors credited), live topics written by mask holders,
 * immutable, no moderator. Hash routing (served from an IPFS gateway).
 */

export type Route =
  | { name: 'home' }
  | { name: 'category'; slug: string }
  | { name: 'thread'; kind: 'a' | 'l'; id: number }
  | { name: 'new'; slug?: string }
  | { name: 'search'; q: string }
  | { name: 'filters' };

function parseHash(h: string): Route {
  const p = h.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'c' && p[1]) return { name: 'category', slug: p[1] };
  if (p[0] === 't' && (p[1] === 'a' || p[1] === 'l') && p[2]) return { name: 'thread', kind: p[1], id: Number(p[2]) };
  if (p[0] === 'new') return { name: 'new', slug: p[1] };
  if (p[0] === 'filters') return { name: 'filters' };
  if (p[0] === 'search' && p[1]) return { name: 'search', q: decodeURIComponent(p.slice(1).join('/')) };
  return { name: 'home' };
}
export const hrefHome = '#/';
export const hrefFilters = '#/filters';
export const hrefCategory = (slug: string) => `#/c/${slug}`;
export const hrefThread = (kind: 'a' | 'l', id: number) => `#/t/${kind}/${id}`;
export const hrefNew = (slug?: string) => (slug ? `#/new/${slug}` : '#/new');

function useRoute(): Route {
  const [r, setR] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      setR(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

/** One shape for a topic row, whether imported or live. */
export interface Row {
  kind: 'a' | 'l';
  id: number;
  /** Author mask (live rows only) — what a personal mute matches on. */
  mask?: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  categoryColor: string;
  authorName: string;
  authorAvatar: string | null;
  posts: number;
  likes: number;
  views: number | null;
  when: string | null;
  tags: string[];
  pinned: boolean;
  closed: boolean;
  live: boolean;
}

export function App() {
  const route = useRoute();
  const [index, setIndex] = useState<ForumIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let gotFull = false;
    // Full list in the background — upgrades category browsing + search once it
    // arrives, without holding up the first paint.
    loadFullIndex()
      .then((f) => {
        gotFull = true;
        setIndex(f);
      })
      .catch(() => {
        /* keep the slim index */
      });
    // Slim index first for a fast paint; don't let it clobber the full one.
    loadIndex()
      .then((s) => {
        if (!gotFull) setIndex(s);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="app">
      <Header index={index} />
      <div className="layout">
        {index ? <Sidebar index={index} route={route} /> : <aside className="sidebar" />}
        <main className="main">
          {err ? (
            <div className="panel err">The archive index did not load: {err}</div>
          ) : !index ? (
            <div className="loading">loading the forum…</div>
          ) : route.name === 'home' ? (
            <Home index={index} />
          ) : route.name === 'category' ? (
            <CategoryView index={index} slug={route.slug} />
          ) : route.name === 'thread' ? (
            <ThreadView index={index} kind={route.kind} id={route.id} />
          ) : route.name === 'filters' ? (
            <FiltersPanel />
          ) : route.name === 'search' ? (
            <SearchView index={index} q={route.q} />
          ) : (
            <Composer index={index} slug={route.slug} />
          )}
        </main>
      </div>
      <footer className="foot">
        <p>
          This is the Polkadot forum, kept on chain. I pulled the whole archive from
          forum.polkadot.network and left it as it was, read-only, with the original names still on
          every post. New topics and replies are written by people who hold a Peoplebook mask. Once
          something is posted it stays. There is no admin here and no one who can take it down.
          Built with Claude Fable 5. Check the data yourself before you trust it.
        </p>
        <p className="disclaimer-indie">
          None of my projects are paid for, funded or endorsed by Parity, W3F, PCF, PBA or anyone
          around them. I do all of it on my own. Nobody hands me instructions, nobody helps out, and
          I don&apos;t borrow the ideas. It is for the community, and they have earned the respect.
        </p>
        <p className="espresso">
          Like the work? Buy me an espresso ☕{' '}
          <code
            className="dono"
            title="click to copy"
            onClick={(e) => {
              const a = e.currentTarget.textContent ?? '';
              navigator.clipboard?.writeText(a);
              const el = e.currentTarget;
              const prev = el.textContent;
              el.textContent = 'copied ✓';
              setTimeout(() => {
                el.textContent = prev;
              }, 1200);
            }}
          >
            13pgGkebYEYGLhA7eR6sBM1boEvq86V9adonjswtYe1iDK2K
          </code>
        </p>
      </footer>
    </div>
  );
}

/** Re-render this view whenever the reader edits their filters. */
function useFilterTick() {
  const [, bump] = useState(0);
  useEffect(() => onFiltersChanged(() => bump((n) => n + 1)), []);
}
/** Drop the rows this reader has muted. The posts stay on chain untouched. */
const visibleRows = (rows: Row[]) => rows.filter((r) => !hiddenReason({ mask: r.mask, title: r.title }));

/* ------------------------------------------------------------- filters ---- */
/**
 * Moderation without a moderator: you decide what reaches your own eyes. Muting
 * collapses a post for you only — it stays on chain, readable by everyone else,
 * one click from being shown again. Nothing here deletes anything.
 */
function FiltersPanel() {
  const [, bump] = useState(0);
  const [word, setWord] = useState('');
  const [maskId, setMaskId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => onFiltersChanged(() => bump((n) => n + 1)), []);
  const f = getFilters();

  async function copyList() {
    try {
      await navigator.clipboard.writeText(exportFilters());
      setMsg('list copied — hand it to anyone who trusts your judgement');
    } catch {
      setMsg(exportFilters());
    }
  }
  function pasteList() {
    const text = prompt('Paste a filter list:');
    if (!text) return;
    try {
      const added = importFilters(text);
      setMsg(`added ${added.masks} masks and ${added.words} words`);
    } catch {
      setMsg('that did not look like a filter list');
    }
  }

  return (
    <div className="composer">
      <div className="crumb">
        <a href={hrefHome}>Home</a> <span>›</span> My filters
      </div>
      <h1>My filters</h1>
      <p className="na">
        Nobody moderates this forum, so you do it for yourself. Muted posts are collapsed for you and stay on chain for
        everyone else. You can undo any of it at any time.
      </p>

      <label className="field">
        <span>Mute a word</span>
        <div className="filter-row">
          <input
            type="text"
            value={word}
            placeholder="a word or phrase"
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                muteWord(word);
                setWord('');
              }
            }}
          />
          <button
            className="primary"
            onClick={() => {
              muteWord(word);
              setWord('');
            }}
          >
            Mute
          </button>
        </div>
      </label>
      <div className="chips">
        {f.words.length ? (
          f.words.map((w) => (
            <button key={w} className="chip" onClick={() => unmuteWord(w)} title="click to unmute">
              {w} ✕
            </button>
          ))
        ) : (
          <span className="na">no muted words</span>
        )}
      </div>

      <label className="field">
        <span>Mute a mask</span>
        <div className="filter-row">
          <input
            type="text"
            value={maskId}
            placeholder="mask number, e.g. 42"
            onChange={(e) => setMaskId(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && maskId) {
                muteMask(maskId);
                setMaskId('');
              }
            }}
          />
          <button
            className="primary"
            disabled={!maskId}
            onClick={() => {
              muteMask(maskId);
              setMaskId('');
            }}
          >
            Mute
          </button>
        </div>
      </label>
      <div className="chips">
        {f.masks.length ? (
          f.masks.map((m) => (
            <button key={m} className="chip" onClick={() => unmuteMask(m)} title="click to unmute">
              mask #{m} ✕
            </button>
          ))
        ) : (
          <span className="na">no muted masks</span>
        )}
      </div>

      <div className="composer-foot">
        <span className="na">Your lists stay in this browser. Share one and it travels as plain text.</span>
        <span className="filter-actions">
          <button onClick={copyList}>Copy my list</button>
          <button onClick={pasteList}>Add someone&apos;s list</button>
          {f.masks.length || f.words.length ? (
            <button
              onClick={() => {
                clearFilters();
                setMsg('filters cleared');
              }}
            >
              Clear all
            </button>
          ) : null}
        </span>
      </div>
      {msg ? <p className="na">{msg}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------- avatar ---- */
/** A mask's avatar: the on-chain PFP (chirp/peoplebook system) when it resolves,
 *  otherwise Morpheus's SVG for his mask, otherwise the 🎭 glyph. The PFP loads
 *  async (host preimage), so it upgrades in once it arrives. */
export function MaskAvatar({
  mask,
  imgClass,
  glyphClass = 'ini mask',
}: {
  mask: bigint;
  imgClass?: string;
  glyphClass?: string;
}) {
  const [src, setSrc] = useState<string | null>(() => pfpForMask(mask));
  useEffect(() => {
    let alive = true;
    setSrc(pfpForMask(mask));
    pfpOfMask(mask)
      .then((u) => {
        if (alive && u) setSrc(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mask]);
  return src ? (
    <img className={imgClass} src={src} alt="" />
  ) : (
    <span className={glyphClass} title={`mask #${mask}`}>
      🎭
    </span>
  );
}

/* ------------------------------------------------------------ identity ---- */
type ConnState = Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout' | 'checking';

/**
 * Who you are to the forum, always visible in the top bar. Login here is not a
 * password — your account lives in the Polkadot app and the forum only reads
 * which mask it holds. This chip makes that state legible (and, when the wallet
 * bridge stalls, gives you a Retry instead of a silent spinner).
 */
function IdentityChip() {
  const [s, setS] = useState<ConnState>('checking');
  const load = useCallback(() => {
    // Interactive: this is the login click — run the SignerManager path that
    // raises the host permission sheet.
    setS('checking');
    getSigner(true)
      .then(setS)
      .catch(() => setS('timeout'));
  }, []);
  useEffect(() => {
    let alive = true;
    setS('checking');
    getSigner()
      .then((v) => alive && setS(v))
      .catch(() => alive && setS('timeout'));
    return () => {
      alive = false;
    };
  }, []);

  if (typeof s === 'object') {
    return (
      <div className="idchip on" title={`Posting as ${s.displayName}`}>
        <MaskAvatar mask={s.mask} glyphClass="idglyph" />
        <span className="idname">{s.displayName}</span>
        {s.verified ? <span className="idok">{s.verified}.dot ✓</span> : null}
      </div>
    );
  }
  if (s === 'checking') return <span className="idchip muted">connecting…</span>;
  if (s === 'timeout')
    return (
      <button className="idchip warn" onClick={load} title="the wallet did not answer in time">
        Wallet didn’t answer · Retry
      </button>
    );
  if (s === 'nomask')
    return (
      <a className="idchip warn" href="https://peoplebook.dot.li" target="_blank" rel="noreferrer" title="claim a free Peoplebook mask, then Retry">
        No mask · claim one to post
      </a>
    );
  if (s === 'nowallet')
    return (
      <button className="idchip warn" onClick={load} title="connect your Polkadot account to post">
        Log in to post
      </button>
    );
  return (
    <span className="idchip muted" title="open this in the Polkadot app to post — reading works anywhere">
      Reading · open in the Polkadot app to post
    </span>
  );
}

/* --------------------------------------------------------------- header --- */
function Header({ index }: { index: ForumIndex | null }) {
  const [q, setQ] = useState('');
  const go = () => {
    const t = q.trim();
    if (t) location.hash = `#/search/${encodeURIComponent(t)}`;
  };
  return (
    <header className="topbar">
      <a className="brand" href={hrefHome}>
        <img className="brand-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="Polkadot Forum" />
      </a>
      <span className="brand-tag">Forum · on chain · no moderators</span>
      <div className="top-search">
        <input
          type="search"
          placeholder="Search topics…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          disabled={!index}
        />
        <button className="searchbtn" onClick={go} aria-label="search">
          ⌕
        </button>
      </div>
      <IdentityChip />
      <a className="newbtn" href={hrefNew()}>
        + New Topic
      </a>
    </header>
  );
}

/* -------------------------------------------------------------- sidebar --- */
function Sidebar({ index, route }: { index: ForumIndex; route: Route }) {
  const activeSlug = route.name === 'category' ? route.slug : null;
  const tags = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of index.topics) for (const tag of t.tags ?? []) c.set(tag, (c.get(tag) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  }, [index]);

  return (
    <aside className="sidebar">
      <a className={`side-link ${route.name === 'home' ? 'on' : ''}`} href={hrefHome}>
        <span className="si">☰</span> Topics
      </a>
      <a className="side-link" href={hrefNew()}>
        <span className="si">＋</span> New Topic
      </a>
      <a className={`side-link ${route.name === 'filters' ? 'on' : ''}`} href={hrefFilters}>
        <span className="si">⃠</span> My filters
      </a>

      <div className="side-sec">Categories</div>
      {index.categories.map((c) => (
        <a key={c.id} className={`side-cat ${activeSlug === c.slug ? 'on' : ''}`} href={hrefCategory(c.slug)}>
          <span className="cat-sq" style={{ background: `#${c.color || '888'}` }} />
          {c.name}
        </a>
      ))}
      <a className={`side-link small ${route.name === 'home' ? 'on' : ''}`} href={hrefHome}>
        All categories
      </a>

      {tags.length ? (
        <>
          <div className="side-sec">Tags</div>
          {tags.map((t) => (
            <a key={t} className="side-tag" href={`#/search/${encodeURIComponent(t)}`}>
              <span className="tagi">🏷</span> {t}
            </a>
          ))}
        </>
      ) : null}
    </aside>
  );
}

/* ------------------------------------------------------------ filter bar -- */
function FilterBar({ active }: { active: 'categories' | 'latest' | 'top' }) {
  return (
    <div className="filterbar">
      <a className={`fb ${active === 'categories' ? 'on' : ''}`} href={hrefHome}>
        Categories
      </a>
      <a className={`fb ${active === 'latest' ? 'on' : ''}`} href="#/search/">
        Latest
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ home -- */
function Home({ index }: { index: ForumIndex }) {
  useFilterTick();
  const [live, setLive] = useState<LivePost[]>([]);
  useEffect(() => {
    liveTopicsAll(30).then(setLive).catch(() => {});
  }, []);

  const latest = useMemo(() => {
    const liveRows = live.map((p) => liveRow(p, index));
    const archived = [...index.topics]
      .sort((a, b) => +new Date(b.lastPostedAt || b.createdAt) - +new Date(a.lastPostedAt || a.createdAt))
      .slice(0, 16)
      .map((t) => archiveRow(t, index));
    return visibleRows([...liveRows, ...archived]).slice(0, 20);
  }, [live, index]);

  return (
    <>
      <FilterBar active="categories" />
      <div className="home-2col">
        <div className="col-cats">
          <div className="ct-head">
            <span>Category</span>
            <span className="ct-num">Topics</span>
          </div>
          {index.categories.map((c) => (
            <CategoryCard key={c.id} c={c} />
          ))}
        </div>
        <div className="col-latest">
          <div className="ct-head">
            <span>Latest</span>
          </div>
          {latest.map((r) => (
            <LatestRow key={`${r.kind}-${r.id}`} r={r} />
          ))}
        </div>
      </div>
    </>
  );
}

function CategoryCard({ c }: { c: ArchiveCategory }) {
  return (
    <a className="cat-card" href={hrefCategory(c.slug)}>
      <span className="cat-card-main">
        <span className="cat-title-line">
          <span className="cat-sq" style={{ background: `#${c.color || '888'}` }} />
          <span className="cat-name">{c.name}</span>
        </span>
        {c.description ? <span className="cat-desc">{c.description}</span> : null}
      </span>
      <span className="ct-num big">{kfmt(c.topicCount)}</span>
    </a>
  );
}

function LatestRow({ r }: { r: Row }) {
  return (
    <a className="latest-row" href={hrefThread(r.kind, r.id)}>
      <span className="lr-avatar" title={r.authorName}>
        {r.authorAvatar ? (
          <img src={r.authorAvatar} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={`ini ${r.live ? 'mask' : ''}`}>{r.live ? '🎭' : initials(r.authorName)}</span>
        )}
      </span>
      <span className="lr-body">
        <span className="lr-title">
          {r.pinned ? <span className="pin">📌</span> : null}
          {r.title}
          {r.live ? <em className="livechip">on-chain</em> : null}
        </span>
        <span className="lr-meta">
          <span className="tcat">
            <span className="tcat-sq" style={{ background: `#${r.categoryColor}` }} />
            {r.categoryName}
          </span>
          {(r.tags ?? []).slice(0, 2).map((t) => (
            <span key={t} className="tag-pill">
              {t}
            </span>
          ))}
        </span>
      </span>
      <span className="lr-right">
        <span className="lr-replies" title="replies">
          {Math.max(0, r.posts - 1)}
        </span>
        <span className="lr-when">{r.when ? fmtWhen(r.when) : ''}</span>
      </span>
    </a>
  );
}

/* -------------------------------------------------------------- category -- */
function CategoryView({ index, slug }: { index: ForumIndex; slug: string }) {
  const cat = index.categories.find((c) => c.slug === slug);
  const [live, setLive] = useState<LivePost[]>([]);
  useEffect(() => {
    liveTopicsInCategory(slug, 60).then(setLive).catch(() => {});
  }, [slug]);

  const archived = useMemo(
    () =>
      index.topics
        .filter((t) => t.categorySlug === slug)
        .sort((a, b) => +new Date(b.lastPostedAt || b.createdAt) - +new Date(a.lastPostedAt || a.createdAt))
        .slice(0, 200)
        .map((t) => archiveRow(t, index)),
    [index, slug],
  );
  const rows = useMemo(
    () => visibleRows([...live.map((p) => liveRow(p, index)), ...archived]),
    [live, archived, index],
  );
  useFilterTick();

  if (!cat) return <div className="panel err">Unknown category “{slug}”.</div>;
  return (
    <>
      <div className="crumb">
        <a href={hrefHome}>Home</a> <span>›</span>{' '}
        <span className="cat-sq" style={{ background: `#${cat.color || '888'}` }} /> {cat.name}
      </div>
      <div className="cat-title-row">
        <h1>{cat.name}</h1>
        <a className="newbtn sm" href={hrefNew(slug)}>
          + New Topic
        </a>
      </div>
      {cat.description ? <p className="cat-blurb">{cat.description}</p> : null}
      <TopicTable rows={rows} />
    </>
  );
}

/* ---------------------------------------------------------------- search -- */
function SearchView({ index, q }: { index: ForumIndex; q: string }) {
  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    const matched = q
      ? index.topics.filter((t) => t.title.toLowerCase().includes(ql) || (t.tags ?? []).some((tag) => tag.includes(ql)))
      : [...index.topics].sort(
          (a, b) => +new Date(b.lastPostedAt || b.createdAt) - +new Date(a.lastPostedAt || a.createdAt),
        );
    return visibleRows(matched.slice(0, 200).map((t) => archiveRow(t, index)));
  }, [index, q]);
  useFilterTick();
  return (
    <>
      <div className="crumb">
        <a href={hrefHome}>Home</a> <span>›</span> {q ? `Search: “${q}”` : 'Latest'}
      </div>
      <h1 className="cat-title-row">{q ? `${rows.length} results` : 'Latest topics'}</h1>
      <TopicTable rows={rows} />
    </>
  );
}

/* ---------------------------------------------------------------- thread -- */
function ThreadView({ index, kind, id }: { index: ForumIndex; kind: 'a' | 'l'; id: number }) {
  const [archive, setArchive] = useState<ArchiveThread | null>(null);
  const [liveT, setLiveT] = useState<{ topic: LivePost; replies: LivePost[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (kind === 'a') {
      loadArchiveThread(id).then((t) => {
        setArchive(t);
        setLoading(false);
      });
    } else {
      liveThread(id).then((t) => {
        setLiveT(t);
        setLoading(false);
      });
    }
  }, [kind, id]);

  if (loading) return <div className="loading">loading the thread…</div>;
  return <Thread index={index} kind={kind} archive={archive} live={liveT} />;
}

/* ------------------------------------------------------- shared table ----- */
export function TopicTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="empty">No topics yet — be the first to post.</p>;
  return (
    <div className="topic-table">
      <div className="topic-head">
        <span>Topic</span>
        <span className="c-replies">Replies</span>
        <span className="c-views">Views</span>
        <span className="c-when">Activity</span>
      </div>
      {rows.map((r) => (
        <a className="topic-row" key={`${r.kind}-${r.id}`} href={hrefThread(r.kind, r.id)}>
          <span className="t-main">
            <span className="t-avatar" title={r.authorName}>
              {r.authorAvatar ? (
                <img src={r.authorAvatar} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className={`ini ${r.live ? 'mask' : ''}`}>{r.live ? '🎭' : initials(r.authorName)}</span>
              )}
            </span>
            <span className="t-title-wrap">
              <span className="t-title">
                {r.pinned ? <span className="pin">📌</span> : null}
                {r.title}
                {r.live ? <em className="livechip">on-chain</em> : null}
                {r.closed ? <span className="closed">🔒</span> : null}
              </span>
              <span className="t-sub">
                <span className="tcat">
                  <span className="tcat-sq" style={{ background: `#${r.categoryColor}` }} />
                  {r.categoryName}
                </span>
                {(r.tags ?? []).slice(0, 3).map((t) => (
                  <span key={t} className="tag-pill">
                    {t}
                  </span>
                ))}
              </span>
            </span>
          </span>
          <span className="c-replies">{Math.max(0, r.posts - 1)}</span>
          <span className="c-views">{r.views != null ? kfmt(r.views) : '—'}</span>
          <span className="c-when">{r.when ? fmtWhen(r.when) : ''}</span>
        </a>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- row builders --- */
function archiveRow(t: ArchiveTopicRow, index: ForumIndex): Row {
  const cat = index.categories.find((c) => c.slug === t.categorySlug);
  return {
    kind: 'a',
    id: t.id,
    title: t.title,
    categorySlug: t.categorySlug,
    categoryName: cat?.name ?? t.categorySlug,
    categoryColor: cat?.color ?? '888',
    authorName: t.author?.name || t.author?.username || 'unknown',
    authorAvatar: avatarUrl(t.author?.avatar ?? null),
    posts: t.postsCount,
    likes: t.likeCount,
    views: t.views,
    when: t.lastPostedAt || t.createdAt,
    tags: t.tags ?? [],
    pinned: t.pinned,
    closed: t.closed,
    live: false,
  };
}
function liveRow(p: LivePost, index: ForumIndex): Row {
  const cat = index.categories.find((c) => keccakMatch(c.slug, p.categoryKey));
  return {
    kind: 'l',
    id: p.id,
    mask: p.mask.toString(),
    title: p.title,
    categorySlug: cat?.slug ?? 'on-chain',
    categoryName: cat?.name ?? 'On-chain',
    categoryColor: cat?.color ?? 'e6007a',
    authorName: p.mask === 27n ? 'Morpheus' : `mask #${p.mask}`,
    authorAvatar: pfpForMask(p.mask),
    posts: p.replies + 1,
    likes: p.likes,
    views: null,
    when: new Date(p.time * 1000).toISOString(),
    tags: [],
    pinned: false,
    closed: false,
    live: true,
  };
}

const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const keyMemo = new Map<string, string>();
function keccakMatch(slug: string, key: string): boolean {
  let k = keyMemo.get(slug);
  if (!k) {
    k = categoryKeyOf(slug).toLowerCase();
    keyMemo.set(slug, k);
  }
  return k === key.toLowerCase();
}
