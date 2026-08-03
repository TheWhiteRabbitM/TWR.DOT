/**
 * chirp — X, on chain, text only.
 *
 * Five places, the way a phone app is laid out: Home (For you / Following),
 * Search, Notifications, Profile, and a thread you can open from anywhere.
 * Every act is a contract call — post, reply, quote, repost, like, follow,
 * delete, and the profile you publish. There is no server holding any of it,
 * and reading needs no wallet at all.
 *
 * Names: the bold name is what you chose in settings — free text, like X, and
 * proof of nothing. The tick belongs only to a `.dot` the contract checked
 * against the registry. The mask number underneath cannot be faked, because a
 * mask is bound to its account and cannot be transferred.
 */
import './style.css';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  warmUp, me, loadAll, thread, people, following, profile, notifications,
  post, edit, remove, toggleLike, toggleRepost, toggleFollow,
  claimMask, saveProfile, suggestedName, forgetWho, connections, setHandle, actingAs,
  askNotifications, notify, openUrl, gifUrl, gifBlob, cachedFeed,
  pictureOf, setPicture, clearPicture, renewPicture, forgetPicture, pictureRights,
  notesOn, notedChirps, addNote, rateNote, rank, rankWhy,
  followerCounts, interestsFrom, statsFor,
  CHIRP, MASKS, NOTES as NOTES_ADDR, type Post, type Me, type Who, type Note, type Stats,
} from './chain';

const app = document.getElementById('app')!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/* ---- the mask, drawn as the contract draws it: seeded by the address ---- */
const PAL = ['#4f8cff', '#a855f7', '#ec4899', '#22d3ee', '#2dd4bf', '#f59e0b', '#f472b6', '#818cf8', '#34d399', '#fb7185'];
/** Pictures already fetched, so a redraw does not flash back to the generated
 *  face. Populated in the background by wantPicture(). */
const PIC = new Map<number, string>();
const picWanted = new Set<number>();

/** Fetch a face once, in the background, and redraw when it lands. Deliberately
 *  not awaited by the renderer: a timeline must not wait on twenty images, and
 *  a face that never arrives must cost nothing but the generated one. */
let picTimer: ReturnType<typeof setTimeout> | null = null;
function wantPicture(mask: number) {
  if (picWanted.has(mask)) return;
  picWanted.add(mask);
  void pictureOf(mask).then((url) => {
    if (!url) return;
    PIC.set(mask, url);
    // Coalesce: twenty faces landing together should cause one redraw, not twenty.
    if (picTimer) return;
    picTimer = setTimeout(() => { picTimer = null; render(); }, 120);
  });
}

/** The face for a mask: the uploaded picture if we have it, and the generated
 *  one otherwise — which is also what an expired picture falls back to, since
 *  Bulletin forgets and the contract keeps pointing anyway. */
function avatar(addr: string, mask?: number): string {
  if (mask) {
    const pic = PIC.get(mask);
    if (pic) return `<img class="pfp" src="${pic}" alt="">`;
    wantPicture(mask);
  }
  const hex = (addr || '0x0').replace(/^0x/, '').padStart(40, '0').slice(0, 40);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  let s = 0n;
  for (const b of keccak_256(bytes)) s = (s << 8n) | BigInt(b);
  const n = (d: bigint, m: bigint) => Number((s / d) % m);
  const c1 = PAL[n(1n, 10n)], c2 = PAL[n(10n, 10n)];
  const round = 6 + n(1n, 6n), vy = 17 + n(7n, 4n), eye = n(13n, 3n);
  const W = 'rgba(255,255,255,.95)';
  const visor = eye === 0
    ? `<rect x="13" y="${vy}" width="14" height="2.4" rx="1.2" fill="${W}"/>`
    : eye === 1
      ? `<circle cx="15.5" cy="${vy + 1}" r="1.7" fill="${W}"/><circle cx="24.5" cy="${vy + 1}" r="1.7" fill="${W}"/>`
      : `<rect x="13" y="${vy}" width="6" height="2.4" rx="1.2" fill="${W}"/><rect x="21" y="${vy}" width="6" height="2.4" rx="1.2" fill="${W}"/>`;
  const gid = 'g' + hex.slice(0, 6);
  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="40" height="40" fill="url(#${gid})"/><circle cx="12" cy="10" r="16" fill="#fff" opacity="0.12"/><rect x="10" y="8" width="20" height="24" rx="${round}" fill="none" stroke="${W}" stroke-width="1.6"/>${visor}<rect x="16" y="26" width="8" height="1.5" rx="0.75" fill="${W}" opacity="0.6"/></svg>`;
}

const TIERS = ['Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
const short = (a: string) => (a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a);
const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
};
const when = (t: number) => new Date(t * 1000).toLocaleString();
const nm = (w?: Who, mask = 0) => w?.name || w?.handle || (w?.verified ? w.verified + '.dot' : 'mask #' + (w?.mask || mask));
/** The @ line, in order of how much it says: the People username the holder
 *  claimed here, then a .dot the contract proved, then the mask number — which
 *  says least but is the only one nobody could have chosen. */
const at = (w?: Who, mask = 0) =>
  w?.handle ? '@' + w.handle
    : w?.verified ? '@' + w.verified + '.dot'
      : '@mask' + (w?.mask || mask);

/**
 * Turn a chirp's text into something you can act on: @handles, .dot names and
 * #tags become taps into search, bare links become links. Escaping happens
 * FIRST and the linkifier only ever inserts markup around already-escaped text,
 * so a post can never inject anything.
 */
function rich(text: string): string {
  return esc(text)
    // A GIF from the phone keyboard arrives as a link, so it is shown as one —
    // no bytes on Bulletin, no bytes on chain, just the text that was already
    // in the chirp. Only the keyboards' own hosts are rendered this way; every
    // other link stays a link.
    //
    // data-url rather than href: inside the Polkadot app there is no second
    // window, so an anchor with target="_blank" is a link that does nothing at
    // all. The host opens it for us through navigateTo.
    .replace(/https?:\/\/[^\s<]+/g, (u) => (gifUrl(u) ? gifTag(u) : `<a class="ext" data-url="${u}">${u}</a>`))
    .replace(/(^|\s)(@[A-Za-z0-9_.-]{2,40})/g, (_m, sp, h) => `${sp}<a class="mention" data-q="${h.slice(1)}">${h}</a>`)
    .replace(/(^|\s)([A-Za-z0-9-]{2,40}\.dot)\b/g, (_m, sp, d) => `${sp}<a class="mention" data-q="${d}">${d}</a>`)
    .replace(/(^|\s)(#[A-Za-z0-9_]{1,40})/g, (_m, sp, t) => `${sp}<a class="mention" data-q="${t.slice(1)}">${t}</a>`);
}

/** GIFs already fetched into local blob URLs, and the ones that were refused. */
const GIFS = new Map<string, string>();
let gifTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A GIF, once we hold the bytes. Until then it is a link that says what it is —
 * never an empty frame, and never a silent nothing: if the container refuses
 * the fetch, tapping it hands the URL to the host, which opens it outside.
 */
function gifTag(u: string): string {
  const local = GIFS.get(u);
  if (local) return `<a class="ext gifwrap" data-url="${u}"><img class="gif" src="${local}" alt="GIF"></a>`;
  if (local === undefined) {
    GIFS.set(u, '');            // claim it before the async call, or every render refires
    void gifBlob(u).then((b) => {
      if (!b) return;
      GIFS.set(u, b);
      if (gifTimer) return;
      gifTimer = setTimeout(() => { gifTimer = null; render(); }, 120);
    });
  }
  return `<a class="ext gifchip" data-url="${u}">GIF — tap to open</a>`;
}

const TICK = `<svg class="tick" viewBox="0 0 24 24" fill="currentColor"><path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg>`;
const S = (d: string, f = 'none') => `<svg viewBox="0 0 24 24" fill="${f}" stroke="currentColor" stroke-width="2">${d}</svg>`;
const I = {
  reply: S('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>'),
  repost: S('<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  like: S('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/>'),
  share: S('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/>'),
  // Bars, not an eye: an eye promises views, and nothing here counts views.
  stats: S('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
  bookmark: S('<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-5-7 5V4a1 1 0 0 1 1-1z"/>'),
  marked: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-5-7 5V4a1 1 0 0 1 1-1z"/></svg>`,
  more: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
  home: S('<path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  search: S('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  bell: S('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  person: S('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  gear: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.8 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.3 19.7l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.4 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  back: S('<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>'),
  plus: S('<path d="M12 5v14"/><path d="M5 12h14"/>'),
};

/* -------------------------------------------------------------------- state */
type View =
  | { k: 'home' } | { k: 'search' } | { k: 'notif' } | { k: 'saved' } | { k: 'stats' }
  | { k: 'profile'; mask: number } | { k: 'thread'; id: number }
  | { k: 'people'; mask: number; of: 'followers' | 'following' };

let ME: Me | null = null;
let ALL: Post[] = [];
let FOLLOW = new Set<number>();
let PEOPLE: Who[] = [];
let NOTIF: Post[] = [];
let PROF: Awaited<ReturnType<typeof profile>> | null = null;
let TH: Awaited<ReturnType<typeof thread>> = { parents: [], post: null, replies: [] };

let view: View = { k: 'home' };
let tab: 'foryou' | 'following' = 'foryou';
let sheet: null | { mode: 'new' | 'reply' | 'quote' | 'edit'; target?: Post } = null;
let settingsOpen = false;
let menuFor: number | null = null;
/** Repost is two different acts — passing something on unchanged, and saying
 *  something about it. X puts both behind the same button, and so does this. */
let repostFor: number | null = null;
let query = '';
let flash: { text: string; bad?: boolean } | null = null;
/** How much of the feed is loaded. The chain has no cursor, so this is simply
 *  how far back from the newest chirp we have read. */
let page = 25;
let CONN: { followers: Who[]; followingList: Who[] } = { followers: [], followingList: [] };
/** True while a refresh is in flight, so the header can say so instead of the
 *  app looking frozen. */
let busy = false;
/** The account that signs, and the one it acts for when it has been made a
 *  proxy. Two different things, and the difference is the whole point. */
let ACT: { signer: string; real: string | null } | null = null;
/** Set when a read failed. The app used to keep showing the last good data with
 *  no hint it was stale, which is worse than an error: you cannot tell a quiet
 *  network from a quiet timeline. */
let loadError = '';
/** A destructive action waiting for a yes. Deleting was one tap and permanent. */
let confirmDelete: number | null = null;
/** Chirps that arrived while you were reading. They are held here rather than
 *  spliced into the feed: a timeline that reflows under the thumb loses your
 *  place, so the new ones wait behind a button, the way X does it. */
let FRESH: Post[] = [];
/** Chirps carrying a note that bridged — one pass over the notes contract per
 *  refresh, rather than a lookup per card. */
let NOTED = new Map<number, Note>();
/** The notes on the thread being read, with their fitted scores. */
let THNOTES: Note[] = [];
/** The note being written or rated, if any. */
let noteSheet: null | { chirpId: number; kind: number } = null;
/** Follower counts, for the ranker and the numbers page. */
let FOLLOWERS = new Map<number, number>();
/** Which chirp's ranking is being explained, if any. */
let whyFor: number | null = null;
/** Which chirp the share sheet is open for. */
let shareFor: number | null = null;
/** A link the container refused to open, shown so it can at least be read. */
let linkFor: string | null = null;
/** Where the picture upload got to. Shown, because when it fails inside a
 *  container it fails silently and there is nothing to go on otherwise. */
let pfpStep: { text: string; bad?: boolean } | null = null;

/**
 * A link to a chirp that works when it leaves the app.
 *
 * `location.origin` inside the container is the bundle's own address — a CID
 * gateway URL, or something the host made up. Pasting that into a message gives
 * the other person a link to nothing. The .dot name is the address that resolves
 * for everyone, and the host routes it back into the app when it is tapped from
 * inside.
 */
const chirpLink = (id: number) => `https://chirponchain.dot/#/t/${id}`;

/** What you were writing, kept across a failed signature and a closed app. A
 *  post that costs a signature must not be able to eat the text you typed. */
const DRAFT = 'chirp.draft';
const draft = {
  get: () => { try { return localStorage.getItem(DRAFT) ?? ''; } catch { return ''; } },
  set: (v: string) => { try { v ? localStorage.setItem(DRAFT, v) : localStorage.removeItem(DRAFT); } catch { /* private mode */ } },
};

/** The newest chirp id you have already seen in Notifications, so the bell can
 *  say how much is new. Kept locally: the chain has no read-state, and inventing
 *  one on chain would cost a transaction per glance. */
const SEEN = 'chirp.seen';
const seen = {
  get: () => { try { return Number(localStorage.getItem(SEEN) ?? 0); } catch { return 0; } },
  set: (v: number) => { try { localStorage.setItem(SEEN, String(v)); } catch { /* private mode */ } },
};
const unread = () => NOTIF.filter((p) => p.id > seen.get()).length;

/** Whether this device has been asked to push. Three states on purpose: not yet
 *  asked, said yes, said no — so a refusal is remembered and not asked again. */
const PUSH = 'chirp.push';
const push = {
  get: () => { try { return localStorage.getItem(PUSH) ?? ''; } catch { return ''; } },
  set: (v: 'on' | 'off') => { try { localStorage.setItem(PUSH, v); } catch { /* private mode */ } },
};
/**
 * Bookmarks and mutes: this device's business and nobody else's.
 *
 * Both are deliberately off chain. A bookmark on a public chain announces what
 * you are quietly interested in, forever, to everyone — and a mute list
 * announces who you cannot stand. Neither is worth a transaction, and both are
 * worth keeping private.
 */
function localSet(key: string) {
  const read = () => { try { return new Set<number>(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set<number>(); } };
  const set = read();
  return {
    has: (id: number) => set.has(id),
    get size() { return set.size; },
    toggle(id: number) {
      set.has(id) ? set.delete(id) : set.add(id);
      try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* private mode */ }
      return set.has(id);
    },
  };
}
const marks = localSet('chirp.marks');
const muted = localSet('chirp.muted');

/** The newest id already pushed, so the same mention is not announced twice. */
const PUSHED = 'chirp.pushed';
const pushed = {
  get: () => { try { return Number(localStorage.getItem(PUSHED) ?? 0); } catch { return 0; } },
  set: (v: number) => { try { localStorage.setItem(PUSHED, String(v)); } catch { /* private mode */ } },
};

const findPost = (id: number) => [...ALL, ...TH.replies, ...TH.parents, TH.post].find((p) => p && p.id === id) as Post | undefined;

/* -------------------------------------------------------------------- cards */

/**
 * The action row, laid out the way X lays it out.
 *
 * Four evenly spread icons was the wrong shape: X gives the counted actions
 * equal columns and pushes the uncounted pair — bookmark and share — to the
 * right edge, so the eye reads "what people did" separately from "what I can
 * do with it". Counts sit in the flow whether or not they are zero, so a row
 * does not reflow the moment the first like lands.
 *
 * There is a stats entry, and it shows engagement rather than views. X puts
 * impressions there; we have none and will not invent them.
 */
function actions(p: Post): string {
  const engaged = p.likes + p.replies + p.reposts;
  return `<div class="acts">
    <button class="act reply" data-reply="${p.id}" aria-label="Reply">${I.reply}<span>${p.replies || ''}</span></button>
    <button class="act rep${p.reposted ? ' on' : ''}" data-repost="${p.id}" aria-pressed="${p.reposted ? 'true' : 'false'}" aria-label="Repost">${I.repost}<span>${p.reposts || ''}</span></button>
    <button class="act like${p.liked ? ' on' : ''}" data-like="${p.id}" aria-pressed="${p.liked ? 'true' : 'false'}" aria-label="Like">${I.like}<span>${p.likes || ''}</span></button>
    <button class="act stats" data-why="${p.id}" aria-label="Why am I seeing this">${I.stats}<span>${engaged || ''}</span></button>
    <div class="acts-end">
      <button class="act bmk${marks.has(p.id) ? ' on' : ''}" data-mark="${p.id}" aria-label="Bookmark">${marks.has(p.id) ? I.marked : I.bookmark}</button>
      <button class="act share" data-share="${p.id}" aria-label="Share">${I.share}</button>
    </div>
  </div>`;
}

function card(p: Post, big = false): string {
  const repost = p.quoteOf && !p.body;
  const shown = repost && p.quoted ? p.quoted : p;
  return `<article class="chirp${big ? ' big' : ''}" data-open="${p.id}">
    ${repost ? `<div class="ctx">${I.repost}<span>${esc(nm(p.who, p.mask))} reposted</span></div>` : ''}
    <div class="row">
      <div class="av" data-who="${shown.mask}">${avatar(shown.author, shown.mask)}</div>
      <div class="grow">
        ${p.replyTo && !big ? replyingTo(p) : ''}
        <div class="head">
          <span class="nm" data-who="${shown.mask}">${esc(nm(shown.who, shown.mask))}</span>${shown.who?.verified ? TICK : ''}
          <span class="at">${esc(at(shown.who, shown.mask))}</span>
          <span class="dot">·</span><span class="ts" title="${esc(when(p.time))}">${ago(p.time)}</span>
          ${p.edited ? '<span class="edited">· edited</span>' : ''}
          <button class="more" data-more="${p.id}" aria-label="More">${I.more}</button>
        </div>
        <div class="body">${rich(shown.body)}</div>
        ${!repost && p.quoted ? `<div class="quoted">
          <div class="head"><span class="nm">${esc(nm(p.quoted.who, p.quoted.mask))}</span>${p.quoted.who?.verified ? TICK : ''}
          <span class="at">${esc(at(p.quoted.who, p.quoted.mask))}</span></div>
          <div class="body">${rich(p.quoted.body)}</div></div>` : ''}
        ${big ? `<div class="detail-time">${esc(when(p.time))}</div>
        <div class="statrow">
          <span><b>${p.replies}</b> replies</span>
          <span><b>${p.reposts}</b> reposts</span>
          <span><b>${p.likes}</b> likes</span>
        </div>` : ''}
        ${noteStrip(p.id)}
        ${whyFor === p.id ? whyBox(p) : ''}
        ${actions(p)}
      </div>
    </div>
  </article>`;
}

/**
 * Why this chirp is where it is.
 *
 * A ranked feed that will not explain itself is the thing people object to, and
 * the explanation here is cheap because the ranker is arithmetic rather than a
 * model — every term can be named and shown with its value.
 */
function whyBox(p: Post): string {
  const w = rankWhy(p, FOLLOW, NOTED, signals());
  return `<div class="why">
    <div class="why-h">Why you are seeing this</div>
    ${w.parts.map((x) => `<div class="why-r"><span>${esc(x.label)}</span><b>${x.value.toFixed(2)}</b></div>`).join('')}
    <div class="why-r total"><span>score</span><b>${w.total.toFixed(2)}</b></div>
    <div class="why-f">Nothing here comes from watching you read. Every term is a public act or the clock.</div>
  </div>`;
}

/**
 * The note under a chirp, when one has bridged.
 *
 * It sits below the post and leaves the post alone: nothing is hidden and
 * nothing is deleted, because the contract cannot remove a chirp and should not
 * be able to. The claim it makes is deliberately narrow — that people who
 * disagree with each other both found this helpful — because that is the only
 * thing the model actually establishes.
 */
function noteStrip(chirpId: number): string {
  const n = NOTED.get(chirpId);
  if (!n) return '';
  return `<div class="cnote" data-note="${n.id}">
    <div class="cnote-h">${n.kind === 1 ? 'Readers added context they thought people would want to know' : 'Readers added context'}</div>
    <div class="cnote-b">${rich(n.body)}</div>
    <div class="cnote-f">Rated helpful by people who do not agree on much else. <a data-open="${chirpId}">See the ratings</a></div>
  </div>`;
}

/** "Replying to @someone" — without it a reply in a thread reads as if it were
 *  addressed to nobody. */
function replyingTo(p: Post): string {
  const parent = ALL.find((x) => x.id === p.replyTo);
  if (!parent) return '';
  return `<div class="ctx small">Replying to <a class="mention" data-who="${parent.mask}">${esc(at(parent.who, parent.mask))}</a></div>`;
}

/** A list, or — while a read is still in flight and we have nothing — skeletons.
 *  Never the empty message: "no chirps yet" is a claim, and an app that has not
 *  finished looking is in no position to make it. */
const list = (ps: Post[], empty: string) => (ps.length
  ? ps.map((p) => card(p)).join('')
  : busy
    ? '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'
    : `<div class="note">${empty}</div>`);

/* -------------------------------------------------------------------- views */

/** What the ranker knows. Recomputed per render, which is cheap, and never
 *  stored anywhere: your topics are derived from public acts and stay here. */
function signals() {
  return {
    followers: FOLLOWERS,
    interests: ME?.mask ? interestsFrom(ALL, ME.mask, new Set(ALL.filter((p) => p.liked).map((p) => p.id))) : undefined,
  };
}

function homeView(): string {
  // Muting hides them from the timeline, not from the chain: open their profile
  // and everything is still there. A mute is "not in my feed", not censorship,
  // and this app could not censor anything if it wanted to.
  const top = ALL.filter((p) => !p.replyTo && !muted.has(p.mask));
  // Following stays strictly chronological — that is the point of it, and X
  // breaking that promise is the complaint people actually have. For you is
  // ranked, and says so.
  const shown = tab === 'following'
    ? top.filter((p) => FOLLOW.has(p.mask))
    : rank(top, FOLLOW, NOTED, signals());
  return `<div class="tabs">
      <button class="tab${tab === 'foryou' ? ' on' : ''}" data-tab="foryou">For you</button>
      <button class="tab${tab === 'following' ? ' on' : ''}" data-tab="following">Following</button>
    </div>`
    + (FRESH.length ? `<button class="fresh-btn" id="showfresh">Show ${FRESH.length} new chirp${FRESH.length > 1 ? 's' : ''}</button>` : '')
    + (ME && !ME.mask ? gate() : '')
    + list(shown, tab === 'following' ? 'Nothing here yet — follow someone from their profile.' : 'No chirps yet.')
    + (ALL.length >= page ? '<button class="more-btn" id="loadmore">Show older chirps</button>' : '');
}

/**
 * What is being talked about, counted from the feed the app already holds.
 *
 * No trending service and no window into anyone's behaviour: it is the tags in
 * the chirps, weighted by how recent they are, so a tag used all week does not
 * outrank one people are using now. Nothing here leaves the device.
 */
function trends(): { tag: string; n: number; hot: number }[] {
  const now = Date.now() / 1000;
  const seenTags = new Map<string, { n: number; hot: number }>();
  for (const p of ALL) {
    if (p.deleted) continue;
    const weight = Math.pow(0.5, Math.max(0, now - p.time) / (24 * 3600));
    for (const m of new Set(p.body.match(/#[A-Za-z0-9_]{1,40}/g) ?? [])) {
      const k = m.slice(1).toLowerCase();
      const cur = seenTags.get(k) ?? { n: 0, hot: 0 };
      seenTags.set(k, { n: cur.n + 1, hot: cur.hot + weight });
    }
  }
  return [...seenTags].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.hot - a.hot).slice(0, 8);
}

/**
 * Who to follow. Not "people like you" — we have no behavioural profile and are
 * not about to build one. It is the two things the chain plainly says: who the
 * people you already follow are following, and who has been writing.
 */
function suggestions(): Who[] {
  if (!ME?.mask) return [];
  const posts = new Map<number, number>();
  for (const p of ALL) if (!p.deleted) posts.set(p.mask, (posts.get(p.mask) ?? 0) + 1);
  return PEOPLE
    .filter((w) => w.mask !== ME!.mask && !FOLLOW.has(w.mask) && !muted.has(w.mask))
    .map((w) => ({ w, score: (posts.get(w.mask) ?? 0) + (CONN.followingList.some((f) => f.mask === w.mask) ? 5 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.w);
}

function searchView(): string {
  const t = query.trim().toLowerCase();
  const who = t ? PEOPLE.filter((w) => (w.name + ' ' + w.handle + ' ' + w.verified + ' mask' + w.mask).toLowerCase().includes(t)) : PEOPLE;
  const posts = t ? ALL.filter((p) => p.body.toLowerCase().includes(t)) : [];
  const tr = trends(), sug = suggestions();
  return `<div class="searchbar"><input id="q" placeholder="Search people and chirps" value="${esc(query)}" autocomplete="off"></div>`
    + (!t && tr.length ? `<div class="sechead">What is happening</div>`
      + tr.map((x, i) => `<div class="trend" data-q="${esc(x.tag)}">
          <div class="tr-rank">${i + 1}</div>
          <div><div class="tr-tag">#${esc(x.tag)}</div>
          <div class="tr-n">${x.n} chirp${x.n === 1 ? '' : 's'}</div></div>
        </div>`).join('') : '')
    + (!t && sug.length ? `<div class="sechead">Who to follow</div>`
      + sug.map((w) => personRow(w, true)).join('') : '')
    + (who.length ? `<div class="sechead">People</div>` + who.slice(0, 20).map((w) => personRow(w)).join('') : '')
    + (t ? `<div class="sechead">Chirps</div>` + list(posts, 'Nothing matches that.') : '');
}

/**
 * Your numbers.
 *
 * Note what is not here: impressions, views, reach, watch time. Those require a
 * server watching people read, and there is no server. A number for them would
 * have to be made up, and a made-up number with a chart under it is worse than
 * no page at all. Everything below is counted from chirps and follows that are
 * already public — you could recount it yourself from the contract.
 */
function statsView(): string {
  if (!ME?.mask) return '<div class="note">Claim a mask to see your numbers.</div>';
  const s = statsFor(ME.mask, ALL, FOLLOWERS.get(ME.mask) ?? 0, FOLLOW.size, ALL.filter((p) => p.liked).length);
  const peak = Math.max(1, ...s.days.map((d) => d.posts + d.got));
  const big = (n: number, l: string) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
  return `<div class="sechead">Your numbers</div>
    <div class="statgrid">
      ${big(s.chirps, 'chirps')}${big(s.replies, 'replies')}
      ${big(s.followers, 'followers')}${big(s.following, 'following')}
      ${big(s.likesGot, 'likes received')}${big(s.repliesGot, 'replies received')}
      ${big(s.repostsGot, 'reposts')}${big(Number(s.perChirp.toFixed(1)), 'engagement per chirp')}
    </div>
    <div class="sechead">The last fortnight</div>
    <div class="bars">${s.days.map((d) => `<div class="bar" title="${d.day}: ${d.posts} chirps, ${d.got} engagement">
      <div class="b-got" style="height:${(d.got / peak) * 100}%"></div>
      <div class="b-post" style="height:${(d.posts / peak) * 100}%"></div>
    </div>`).join('')}</div>
    <div class="barkey"><span class="k-post"></span> chirps <span class="k-got"></span> engagement received</div>
    ${s.bestHour ? `<div class="note small">You chirp most around ${String(s.bestHour.hour).padStart(2, '0')}:00 — ${s.bestHour.n} of them.</div>` : ''}
    ${s.topics.length ? `<div class="sechead">What you write about</div>
      <div class="chips">${s.topics.map((t) => `<span class="chip" data-q="${esc(t.word)}">${esc(t.word)} <b>${t.n}</b></span>`).join('')}</div>` : ''}
    ${s.top.length ? `<div class="sechead">Your most engaged chirps</div>${s.top.map((p) => card(p)).join('')}` : ''}
    <div class="note small">Counted from the contract, not from watching you. There are no impressions here
    because nothing records who read what — a number for that would have to be invented.</div>`;
}

/** The saved chirps. Kept on the device on purpose: a bookmark is a note to
 *  yourself, and putting it on a public chain would publish what you are
 *  quietly interested in to everybody, forever. */
function savedView(): string {
  const rows = ALL.filter((p) => marks.has(p.id));
  return `<div class="sechead">Bookmarks</div>`
    + list(rows, 'Nothing saved yet. Bookmark a chirp from its ⋯ menu.')
    + `<div class="note small">Bookmarks stay on this device. A chain would make them public, and what you save is nobody's business.</div>`;
}

function personRow(w: Who, withFollow = false): string {
  return `<div class="prow" data-who="${w.mask}">
    <div class="av">${avatar('0x' + w.mask.toString(16).padStart(40, '0'), w.mask)}</div>
    <div class="grow"><div class="head"><span class="nm">${esc(nm(w))}</span>${w.verified ? TICK : ''}</div>
    <div class="at">${esc(at(w))} · <span class="tier t${w.tier}">${TIERS[w.tier]}</span></div></div>
    ${withFollow && ME?.mask ? `<button class="primary small" data-follow="${w.mask}">Follow</button>` : ''}
  </div>`;
}

function notifView(): string {
  // The offer sits here rather than on the home screen: you are on this page
  // because you care about being told, which is the only moment the question
  // is a fair one to ask.
  const offer = ME?.mask && push.get() !== 'on'
    ? `<div class="pushrow">
        <div><b>Get told when someone replies</b>
        <span>chirp asks the Polkadot app to notify you. Nothing leaves the device but the alert.</span></div>
        <button class="primary" id="askpush">Turn on</button>
      </div>` : '';
  return offer + `<div class="sechead">Replies and quotes of your chirps</div>`
    + list(NOTIF, ME?.mask ? 'Nothing yet.' : 'Claim a mask to get replies.');
}

function profileView(): string {
  if (!PROF) return '<div class="note">Loading…</div>';
  const { who, bio, telegram, x, followers, posts, isMe, iFollow } = PROF;
  const addr = posts[0]?.author ?? '0x' + who.mask.toString(16).padStart(40, '0');
  return `<section class="phead">
    <div class="pavatar">${avatar(addr, who.mask)}</div>
    <div class="pact">${isMe
      ? '<button class="ghost" id="editprof">Edit profile</button>'
      : `<button class="${iFollow ? 'ghost' : 'primary'}" data-follow="${who.mask}">${iFollow ? 'Following' : 'Follow'}</button>`}</div>
    <h2>${esc(nm(who))}${who.verified ? TICK : ''}</h2>
    <div class="at">${esc(at(who))}</div>
    ${bio ? `<p class="bio">${esc(bio)}</p>` : ''}
    <div class="plinks">
      ${telegram ? `<a class="ext" data-url="https://t.me/${encodeURIComponent(telegram)}">✆ ${esc(telegram)}</a>` : ''}
      ${x ? `<a class="ext" data-url="https://x.com/${encodeURIComponent(x)}">𝕏 ${esc(x)}</a>` : ''}
      <span class="tier t${who.tier}">${TIERS[who.tier]}</span>
    </div>
    <div class="pstats">
      <a data-conn="followers" data-mask="${who.mask}"><b>${followers}</b> followers</a> ·
      <a data-conn="following" data-mask="${who.mask}"><b>${CONN.followingList.length}</b> following</a> ·
      <b>${posts.length}</b> chirps
      ${isMe && marks.size ? ` · <a id="gosaved"><b>${marks.size}</b> bookmarked</a>` : ''}
      ${isMe ? ' · <a id="gostats">your numbers</a>' : ''}
    </div>
  </section>` + list(posts, 'No chirps yet.');
}

function peopleView(): string {
  if (view.k !== 'people') return '';
  const rows = view.of === 'followers' ? CONN.followers : CONN.followingList;
  return `<div class="sechead">${view.of === 'followers' ? 'Followers' : 'Following'}</div>`
    + (rows.length ? rows.map((w) => personRow(w)).join('')
      : `<div class="note">${view.of === 'followers' ? 'Nobody yet.' : 'Not following anyone yet.'}</div>`);
}

function threadView(): string {
  // Replies to replies are shown indented under the one they answer, so a
  // conversation reads as a conversation instead of a flat pile.
  const byParent = new Map<number, Post[]>();
  for (const r of ALL) if (r.replyTo) byParent.set(r.replyTo, [...(byParent.get(r.replyTo) ?? []), r]);
  const branch = (id: number, depth: number): string =>
    (byParent.get(id) ?? []).map((r) =>
      `<div class="branch" style="--d:${Math.min(depth, 4)}">${card(r)}</div>` + branch(r.id, depth + 1)).join('');
  return TH.parents.map((p) => card(p)).join('')
    + (TH.post ? card(TH.post, true) : '')
    + notesSection()
    + `<div class="sechead">Replies</div>`
    + (byParent.get(view.k === 'thread' ? view.id : 0)?.length ? branch(view.k === 'thread' ? view.id : 0, 0)
      : '<div class="note">No replies yet. Be the first.</div>');
}

/**
 * The notes on the chirp being read, with what the model made of each.
 *
 * The score is shown rather than hidden. A note that has not reached enough
 * ratings says so plainly instead of appearing to have failed, because "not
 * enough people have looked at this" and "people looked and disagreed" are
 * completely different facts and a single greyed-out state would conflate them.
 */
function notesSection(): string {
  const id = view.k === 'thread' ? view.id : 0;
  if (!id) return '';
  const add = ME?.mask
    ? `<button class="ghost small" id="addnote">Add context</button>`
    : '';
  if (!THNOTES.length) {
    return `<div class="sechead">Context ${add}</div>
      <div class="note">Nobody has added context to this chirp.</div>`;
  }
  const rows = THNOTES.map((n) => {
    const state = n.helpful
      ? '<span class="nstate good">Shown on the chirp</span>'
      : n.score === undefined
        ? `<span class="nstate">Needs more ratings — ${n.ratings} so far</span>`
        : '<span class="nstate">Rated, but not across viewpoints</span>';
    const rate = ME?.mask && n.mine === undefined && n.mask !== ME.mask
      ? `<div class="nrate">
          <button class="ghost small" data-rate="${n.id}" data-v="2">Helpful</button>
          <button class="ghost small" data-rate="${n.id}" data-v="1">Somewhat</button>
          <button class="ghost small" data-rate="${n.id}" data-v="0">Not helpful</button>
        </div>`
      : n.mine !== undefined
        ? `<div class="nrate"><span class="nstate">You rated it ${['not helpful', 'somewhat', 'helpful'][n.mine]}.</span></div>`
        : '';
    return `<article class="cnote full">
      <div class="cnote-h">${n.kind === 1 ? 'Says this chirp is misleading' : 'Adds context'} ${state}</div>
      <div class="cnote-b">${rich(n.body)}</div>
      <div class="cnote-f">by <a class="mention" data-who="${n.mask}">${esc(at(n.who, n.mask))}</a>
        · ${n.ratings} rating${n.ratings === 1 ? '' : 's'}${n.score !== undefined ? ` · score ${n.score.toFixed(2)}` : ''}
        ${n.edited ? ' · edited after ratings were cast' : ''}</div>
      ${rate}
    </article>`;
  }).join('');
  return `<div class="sechead">Context ${add}</div>${rows}`;
}

function gate(): string {
  return `<section class="gate">
    <h2>Claim your mask to post</h2>
    <p>A mask is bound to your account and cannot be transferred, so nobody can post as you.
    Own a <b>.dot</b>? Put the label in — the contract checks it against the registry, and that is what earns a tick.</p>
    <input id="dotlabel" placeholder="your .dot label, without the suffix (optional)" autocomplete="off" spellcheck="false">
    <button class="primary" id="claim">Claim my mask</button>
  </section>`;
}

/* ------------------------------------------------------------------- chrome */

function header(): string {
  const back = view.k === 'thread' || view.k === 'profile' || view.k === 'people'
    ? `<button class="iconbtn" id="back" aria-label="Back">${I.back}</button>` : '';
  const title = view.k === 'thread' ? 'Thread' : view.k === 'profile' ? 'Profile'
    : view.k === 'people' ? (view.of === 'followers' ? 'Followers' : 'Following')
    : view.k === 'search' ? 'Search' : view.k === 'notif' ? 'Notifications'
    : view.k === 'saved' ? 'Bookmarks' : view.k === 'stats' ? 'Your numbers' : 'chirp';
  const who = !ME ? '<span>reading only — open in the Polkadot app, or connect a wallet extension</span>'
    : `<b>${ME.mask ? esc(nm(ME as unknown as Who)) : 'no mask yet'}</b><span>${esc(short(ME.address))}</span>`;
  // The mark stands in for the word only where the word would be the app's own
  // name; on a thread or a profile the title is doing real work and is left alone.
  const mark = title === 'chirp'
    ? `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M18 13h28a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8H32l-12 9v-9h-2a8 8 0 0 1-8-8V21a8 8 0 0 1 8-8z" fill="currentColor"/><circle cx="32" cy="30" r="6.5" fill="var(--bg)"/></svg>` : '';
  return `<header class="top">${back}<h1>${mark}${title}${busy ? '<span class="dotspin" aria-label="Loading"></span>' : ''}</h1>
    <div class="who">${who}</div>
    ${ME?.mask ? `<button class="iconbtn" id="settings" aria-label="Settings">${I.gear}</button>` : ''}
  </header>`;
}

function nav(): string {
  const item = (k: string, icon: string, label: string, on: boolean) =>
    `<button class="navb${on ? ' on' : ''}" data-nav="${k}" aria-label="${label}">${icon}</button>`;
  return `<nav class="bottom">
    ${item('home', I.home, 'Home', view.k === 'home')}
    ${item('search', I.search, 'Search', view.k === 'search')}
    ${item('notif', I.bell + (unread() ? `<span class="badge">${unread() > 9 ? '9+' : unread()}</span>` : ''), 'Notifications', view.k === 'notif')}
    ${item('profile', I.person, 'Profile', view.k === 'profile')}
  </nav>
  ${ME?.mask ? `<button class="fab" id="fab" aria-label="New chirp">${I.plus}</button>` : ''}`;
}

function overlay(): string {
  if (settingsOpen && ME) {
    return `<div class="scrim" id="scrim"><div class="pane">
      <div class="panehead"><b>Settings</b><button class="iconbtn" id="closepane">✕</button></div>
      <label>Picture</label>
      <div class="pfprow">
        <div class="pfpnow">${avatar('0x' + ME.mask.toString(16).padStart(40, '0'), ME.mask)}</div>
        <div>
          <!-- A REAL, visible file input. It used to be hidden behind a button
               that called .click() on it, which is the one pattern a mobile
               webview swallows: the picker never opened and the button looked
               dead. Let the platform draw its own control. -->
          <input type="file" id="pfpfile" accept="image/*" class="filein">
          ${PIC.get(ME.mask) ? '<button class="ghost small" id="clearpfp">Remove</button>' : ''}
        </div>
      </div>
      <!-- A second way in, because the first one may simply not exist here.
           Some containers have no file chooser at all, and then a file input is
           furniture. Pasting works through the clipboard instead, which is a
           different permission and a different code path. -->
      <div class="pasted" id="pastepfp" contenteditable="true" tabindex="0"
           aria-label="Paste a picture here">Or paste a picture here</div>
      ${pfpStep ? `<p class="hint ${pfpStep.bad ? 'bad' : ''}">${esc(pfpStep.text)}</p>` : ''}
      <button class="link" id="pfprights">Check what the app allows</button>
      <p class="hint">Cropped square and shrunk to 256px here, then stored on the Bulletin chain — the app
      uploads it for you, so you need no storage account of your own. Bulletin keeps data for about a
      fortnight, so chirp quietly re-uploads the same picture each time you open it, which costs nothing
      and needs no transaction. Stay away longer than that and you come back to the generated face until
      you set one again.</p>
      <label>Public name</label>
      <input id="s_name" maxlength="40" value="${esc(ME.name)}" placeholder="the name people see">
      <button class="link" id="usepeople">use my People chain username</button>
      <label>.dot ${ME.verified ? '<span class="okmark">verified ✓</span>' : ''}</label>
      <input value="${ME.verified ? esc(ME.verified) + '.dot' : ''}" placeholder="set when you claimed your mask" disabled>
      ${ME.verified ? '' : '<p class="hint">A .dot is checked when the mask is claimed, and that check is what earns the tick — it cannot be added afterwards.</p>'}
      <label>People chain username</label>
      <input id="s_handle" maxlength="32" value="${esc(ME.handle)}" placeholder="e.g. watanabe.01">
      <button class="link" id="usehandle">use the one the app knows</button>
      <p class="hint">This is the @ name people see. It is unique — first to claim it keeps it — and only
      you can set it, because your mask cannot be moved. It carries <b>no tick</b>: Asset Hub cannot read
      the People chain, so nothing here can prove the username is yours. Only a .dot is checked.</p>
      <label>Bio</label><input id="s_bio" maxlength="160" value="${esc(ME.bio)}" placeholder="one line about you">
      <label>Telegram</label><input id="s_tg" maxlength="32" value="${esc(ME.telegram)}" placeholder="handle, without @">
      <label>X</label><input id="s_x" maxlength="32" value="${esc(ME.x)}" placeholder="handle, without @">
      <label>Account</label>
      ${ACT?.real
        ? `<p class="hint linked"><b>Linked.</b> chirp signs with the account the Polkadot app derived for it,
            and sends every call through your proxy, so the chain records
            <code>${esc(short(ACT.real))}</code> — <b>your</b> account — as the author.
            That is the same AccountId your People chain username belongs to, so anyone can check the two match.</p>`
        : `<p class="hint">chirp signs with <code>${esc(short(ACT?.signer ?? ''))}</code>, an account the Polkadot app
            derived for this app. It is nobody in particular, which is why your @ name cannot be proven.
            <br><br><b>To post as your real account</b>, add that address as a <b>proxy</b> of yours — one transaction,
            from a wallet holding your identity account:<br>
            <code>Proxy.addProxy(delegate = ${esc(ACT?.signer ?? '')}, type = Any, delay = 0)</code>
            <br><br>chirp notices it by itself and starts acting for you. Verified on this chain: a delegate can call a
            contract function gated on ownership of something only the real account holds.</p>`}
      <button class="primary wide" id="savep">Save on chain</button>
      <p class="hint">The name is yours to choose and proves nothing — which is exactly why the tick is reserved for the .dot the contract verified.</p>
    </div></div>`;
  }
  if (linkFor) {
    return `<div class="scrim" id="scrim"><div class="pane">
      <div class="panehead"><b>This app cannot open links</b><button class="iconbtn" id="linkclose">✕</button></div>
      <p class="hint">The Polkadot app refused to hand this address to a browser, and a container has no
      second window of its own. Here it is — it is already on your clipboard.</p>
      <div class="linkbox">${esc(linkFor)}</div>
      <button class="primary wide" id="linkcopy">Copy it again</button>
    </div></div>`;
  }
  if (shareFor) {
    const p = findPost(shareFor);
    return `<div class="scrim" id="scrim"><div class="menu">
      <button data-sh="native">Share…</button>
      <button data-sh="copy">Copy link</button>
      <button data-sh="copytext">Copy chirp and link</button>
      ${ME?.mask ? '<button data-sh="quote">Quote it</button>' : ''}
      <button data-sh="chain">View on chain</button>
      <div class="menu-note">${p ? esc(chirpLink(p.id)) : ''}</div>
      <button data-sh="close">Cancel</button>
    </div></div>`;
  }
  if (noteSheet && ME?.mask) {
    return `<div class="scrim" id="scrim"><div class="pane">
      <div class="panehead"><b>Add context</b><button class="iconbtn" id="closepane">✕</button></div>
      <p class="hint">A note is only shown on the chirp if people who normally disagree with each other
      both rate it helpful. Votes alone do not do it — a note the majority likes and the minority rejects
      stays here, where you are reading it now.</p>
      <label>What kind</label>
      <div class="kindrow">
        <button class="ghost small${noteSheet.kind === 0 ? ' on' : ''}" data-kind="0">Adds context</button>
        <button class="ghost small${noteSheet.kind === 1 ? ' on' : ''}" data-kind="1">Says it is misleading</button>
      </div>
      <label>Your note</label>
      <textarea id="notebody" maxlength="700" rows="6" placeholder="What is missing, and where can it be checked? A source carries more than an opinion."></textarea>
      <button class="primary wide" id="savenote">Publish the note</button>
    </div></div>`;
  }
  if (confirmDelete) {
    const p = findPost(confirmDelete);
    return `<div class="scrim" id="scrim"><div class="pane">
      <div class="panehead"><b>Delete this chirp?</b></div>
      <p class="hint">It stops showing everywhere and its replies lose their parent. The row stays
      on chain — nothing there truly disappears — but you cannot undo this from the app.</p>
      ${p ? `<div class="quoted"><div class="body">${esc(p.body)}</div></div>` : ''}
      <div class="confirmrow">
        <button class="ghost" id="cancel-del">Keep it</button>
        <button class="primary danger-btn" id="do-del">Delete</button>
      </div>
    </div></div>`;
  }
  if (repostFor) {
    const p = findPost(repostFor);
    return `<div class="scrim" id="scrim"><div class="menu">
      <button data-rp="repost">${p?.reposted ? 'Undo repost' : 'Repost'}</button>
      <button data-rp="quote">Quote</button>
      <button data-rp="close">Cancel</button>
    </div></div>`;
  }
  if (menuFor) {
    const p = findPost(menuFor);
    if (!p) return '';
    // Compared on the MASK, not on the address.
    //
    // `p.author` is the H160 pallet-revive recorded as msg.sender; `ME.address`
    // is the ss58 the wallet reports. Those two are different encodings of
    // different things and were never equal, so Edit and Delete never appeared
    // for anybody — the contract would have accepted both all along.
    //
    // The mask is the better test anyway: it is the identity the post carries,
    // and it stays right when the call went through a proxy.
    const mine = Boolean(ME?.mask) && p.mask === ME!.mask;
    return `<div class="scrim" id="scrim"><div class="menu">
      ${mine ? `<button data-m="edit" data-id="${p.id}">Edit chirp</button>
                <button class="danger" data-m="del" data-id="${p.id}">Delete chirp</button>` : ''}
      <button data-m="quote" data-id="${p.id}">Quote</button>
      <button data-m="mark" data-id="${p.id}">${marks.has(p.id) ? 'Remove bookmark' : 'Bookmark'}</button>
      <button data-m="why" data-id="${p.id}">Why am I seeing this?</button>
      ${ME?.mask ? `<button data-m="note" data-id="${p.id}">Add context</button>` : ''}
      <button data-m="who" data-id="${p.id}">View profile</button>
      ${mine ? '' : `<button data-m="mute" data-id="${p.id}">${muted.has(p.mask) ? 'Unmute' : 'Mute'} ${esc(at(p.who, p.mask))}</button>`}
      <button data-m="link" data-id="${p.id}">Copy link</button>
      <button data-m="copy" data-id="${p.id}">Copy text</button>
      <button data-m="chain" data-id="${p.id}">View on chain</button>
      <button data-m="close">Cancel</button>
    </div></div>`;
  }
  if (!sheet) return '';
  const t = sheet.target;
  const title = sheet.mode === 'reply' ? 'Reply' : sheet.mode === 'quote' ? 'Quote' : sheet.mode === 'edit' ? 'Edit' : 'New chirp';
  return `<div class="scrim" id="scrim"><div class="pane compose-pane">
    <div class="panehead"><b>${title}</b><button class="iconbtn" id="closepane">✕</button></div>
    ${t && sheet.mode !== 'edit' ? `<div class="quoted">
      <div class="head"><span class="nm">${esc(nm(t.who, t.mask))}</span><span class="at">${esc(at(t.who, t.mask))}</span></div>
      <div class="body">${esc(t.body)}</div></div>` : ''}
    <textarea id="stxt" maxlength="400" placeholder="${sheet.mode === 'reply' ? 'Post your reply' : sheet.mode === 'quote' ? 'Add a comment' : "What's happening on chain?"}">${sheet.mode === 'edit' && t ? esc(t.body) : sheet.mode === 'new' ? esc(draft.get()) : ''}</textarea>
    <div class="mentions" id="mbox" hidden role="listbox" aria-label="People"></div>
    <div class="composebar"><span class="count" id="scount">280</span>
      <button class="primary" id="ssend">${sheet.mode === 'edit' ? 'Save' : title === 'New chirp' ? 'Chirp' : title}</button></div>
  </div></div>`;
}

/** Where the reader was, per view. Re-rendering replaces the whole column, so
 *  without this a like halfway down the feed threw you back to the top — the
 *  optimistic update made that worse, not better, because it renders twice. */
const scrollAt = new Map<string, number>();

function render() {
  const key = hashOf(view);
  if (app.querySelector('main')) scrollAt.set(key, scrollY);
  // A sheet is over the column; let it scroll, not the timeline behind it.
  document.body.classList.toggle('locked', Boolean(sheet || settingsOpen || menuFor || confirmDelete || repostFor));

  const body = view.k === 'home' ? homeView()
    : view.k === 'saved' ? savedView()
    : view.k === 'stats' ? statsView()
    : view.k === 'search' ? searchView()
    : view.k === 'notif' ? notifView()
    : view.k === 'profile' ? profileView()
    : view.k === 'people' ? peopleView()
    : threadView();
  app.innerHTML = header()
    + (flash ? `<div class="msg ${flash.bad ? 'bad' : 'good'}" role="status" aria-live="polite">${esc(flash.text)}<button class="x-flash" id="dismiss" aria-label="Dismiss">✕</button></div>` : '')
    + (loadError ? `<div class="msg bad" role="alert">Could not read the chain — showing what was already loaded.
        <button class="link" id="retry">Try again</button></div>` : '')
    + `<main>${body}</main>`
    + `<footer class="foot">
        Every chirp — replies, quotes and reposts included — is a row in the
        <a class="ext" data-url="https://assethub-paseo.subscan.io/account/${CHIRP}">Chirp contract</a> on the devnet
        Asset Hub. You post as a <a class="ext" data-url="https://assethub-paseo.subscan.io/account/${MASKS}">mask</a>
        bound to your account and non-transferable, so a chirp can only come from its author. Text only, 280 characters, no server.
        <span style="display:block;margin-top:10px;opacity:.6">build ${esc(__BUILD__)}</span>
      </footer>`
    + nav() + overlay();
  wire();
  // Put the reader back where they were, unless a sheet is taking focus.
  if (!sheet && !settingsOpen) scrollTo({ top: scrollAt.get(key) ?? 0 });
}

/* ------------------------------------------------------------------- wiring */

function counter(ta: HTMLTextAreaElement, out: HTMLElement, btn: HTMLButtonElement, allowEmpty = false) {
  const sync = () => {
    const n = 280 - ta.value.length;
    out.textContent = String(n);
    out.className = 'count' + (n < 0 ? ' over' : n <= 20 ? ' warn' : '');
    btn.disabled = (!allowEmpty && !ta.value.trim()) || n < 0;
  };
  ta.addEventListener('input', sync); sync(); ta.focus();
}

/**
 * Suggest people while an @name is being typed, the way X does.
 *
 * This deliberately does NOT go through render(): the app redraws the whole
 * column on any state change, which would throw away the caret mid-word. It
 * owns one box and writes to it directly, so typing stays typing.
 */
function attachMentions(ta: HTMLTextAreaElement, box: HTMLElement) {
  let matches: Who[] = [];
  let sel = 0;

  const close = () => { box.hidden = true; box.innerHTML = ''; matches = []; sel = 0; };

  /** The @token the caret is sitting in, if any. */
  const token = () => {
    const pos = ta.selectionStart ?? 0;
    const m = ta.value.slice(0, pos).match(/(?:^|\s)@([A-Za-z0-9_.-]{0,40})$/);
    return m ? { q: m[1].toLowerCase(), start: pos - m[1].length - 1, end: pos } : null;
  };

  const paint = () => {
    if (!matches.length) return close();
    box.hidden = false;
    box.innerHTML = matches.map((w, i) => `<button class="mrow${i === sel ? ' on' : ''}" data-pick="${i}" role="option" aria-selected="${i === sel}">
        <span class="mav">${avatar('0x' + w.mask.toString(16).padStart(40, '0'), w.mask)}</span>
        <span class="mnm">${esc(nm(w))}</span><span class="mat">${esc(at(w))}</span>
      </button>`).join('');
    box.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) =>
      b.addEventListener('mousedown', (e) => { e.preventDefault(); choose(Number(b.dataset.pick)); }));
  };

  const choose = (i: number) => {
    const t = token();
    const w = matches[i];
    if (!t || !w) return close();
    // The handle is what a reader can act on, so that is what goes in — a
    // display name is not unique and would point at nobody.
    const handle = w.handle || (w.verified ? w.verified + '.dot' : 'mask' + w.mask);
    const before = ta.value.slice(0, t.start);
    const after = ta.value.slice(t.end);
    ta.value = before + '@' + handle + ' ' + after;
    const caret = (before + '@' + handle + ' ').length;
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event('input'));   // keep the counter and the draft honest
    close();
    ta.focus();
  };

  const search = () => {
    const t = token();
    if (!t) return close();
    const pool = PEOPLE.length ? PEOPLE : [];
    matches = pool
      .filter((w) => (w.handle + ' ' + w.name + ' ' + w.verified + ' mask' + w.mask).toLowerCase().includes(t.q))
      .slice(0, 6);
    sel = 0;
    paint();
  };

  ta.addEventListener('input', search);
  ta.addEventListener('click', search);
  ta.addEventListener('blur', () => setTimeout(close, 120));
  ta.addEventListener('keydown', (e) => {
    if (box.hidden || !matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % matches.length; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + matches.length) % matches.length; paint(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }  // close the list, not the composer
  });
}

async function act(fn: () => Promise<{ ok: boolean; why?: string }>, good: string) {
  flash = { text: 'Signing…' }; render();
  const r = await fn();
  flash = r.ok ? { text: good } : { text: r.why ?? 'Failed', bad: true };
  await refresh();
}

/** The view as a URL, so the phone's back button walks the app instead of
 *  leaving it, and a thread can be linked to. */
function hashOf(v: View): string {
  return v.k === 'home' ? '#/' : v.k === 'search' ? '#/search'
    : v.k === 'notif' ? '#/notifications' : v.k === 'saved' ? '#/saved' : v.k === 'stats' ? '#/stats'
    : v.k === 'profile' ? '#/u/' + v.mask
    : v.k === 'people' ? '#/u/' + v.mask + '/' + v.of
    : '#/t/' + v.id;
}
function viewOf(hash: string): View {
  const h = hash.replace(/^#\/?/, '');
  if (h.startsWith('u/')) {
    const [n, sub] = h.slice(2).split('/');
    if (sub === 'followers' || sub === 'following') return { k: 'people', mask: Number(n) || 0, of: sub };
    return { k: 'profile', mask: Number(n) || 0 };
  }
  if (h.startsWith('t/')) return { k: 'thread', id: Number(h.slice(2)) || 0 };
  if (h.startsWith('search')) return { k: 'search' };
  if (h.startsWith('notifications')) return { k: 'notif' };
  if (h.startsWith('saved')) return { k: 'saved' };
  if (h.startsWith('stats')) return { k: 'stats' };
  return { k: 'home' };
}
/** Navigate. Pushing the hash is what makes Back work; the hashchange handler
 *  is the single place a view is ever applied, so the two cannot drift. */
function go(v: View) {
  const h = hashOf(v);
  if (location.hash === h) { view = v; refresh(); return; }
  location.hash = h;
}
function goProfile(mask: number) { go({ k: 'profile', mask }); }

function wire() {
  document.getElementById('back')?.addEventListener('click', () => history.back());
  document.getElementById('settings')?.addEventListener('click', () => { settingsOpen = true; render(); });
  document.getElementById('editprof')?.addEventListener('click', () => { settingsOpen = true; render(); });
  document.getElementById('closepane')?.addEventListener('click', () => { settingsOpen = false; sheet = null; menuFor = null; render(); });
  document.getElementById('scrim')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('scrim')) { settingsOpen = false; sheet = null; menuFor = null; confirmDelete = null; repostFor = null; render(); }
  });
  document.getElementById('fab')?.addEventListener('click', () => { sheet = { mode: 'new' }; render(); });
  document.getElementById('dismiss')?.addEventListener('click', () => { flash = null; render(); });
  document.getElementById('retry')?.addEventListener('click', () => refresh());
  document.getElementById('cancel-del')?.addEventListener('click', () => { confirmDelete = null; render(); });
  document.getElementById('do-del')?.addEventListener('click', () => {
    const id = confirmDelete!; confirmDelete = null;
    act(() => remove(id), 'Deleted on chain.');
  });
  document.getElementById('loadmore')?.addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true; b.textContent = 'Loading…';
    page += 25;
    refresh();
  });

  app.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.nav!;
    if (k === 'profile') { if (ME?.mask) goProfile(ME.mask); else go({ k: 'home' }); return; }
    go({ k: k as 'home' | 'search' | 'notif' });
  }));
  app.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    // Switching tabs redraws the column anyway, so there is no place left to
    // lose: fold the held-back chirps in rather than throwing them away.
    tab = b.dataset.tab as 'foryou' | 'following'; showFresh(false); render();
  }));

  const q = document.getElementById('q') as HTMLInputElement | null;
  if (q) {
    q.addEventListener('input', () => { query = q.value; const at2 = q.selectionStart; render();
      const q2 = document.getElementById('q') as HTMLInputElement; q2.focus(); q2.setSelectionRange(at2 ?? 0, at2 ?? 0); });
  }

  // composer sheet
  const stxt = document.getElementById('stxt') as HTMLTextAreaElement | null;
  const ssend = document.getElementById('ssend') as HTMLButtonElement | null;
  const scnt = document.getElementById('scount');
  if (stxt && ssend && scnt && sheet) {
    counter(stxt, scnt, ssend, sheet.mode === 'quote');
    const mbox = document.getElementById('mbox');
    if (mbox) {
      attachMentions(stxt, mbox);
      // Fetch the directory once, in the background: the first @ should not wait
      // for the chain, and by the time a name is half typed it is here.
      if (!PEOPLE.length) void people().then((p) => { PEOPLE = p; }).catch(() => undefined);
    }
    const s = sheet;
    // Keep a new chirp as it is typed, so a refused signature or a closed app
    // does not swallow it.
    if (s.mode === 'new') stxt.addEventListener('input', () => draft.set(stxt.value));
    ssend.addEventListener('click', () => {
      const v = stxt.value.trim();
      sheet = null;
      if (s.mode === 'new') draft.set('');
      if (s.mode === 'edit' && s.target) return act(() => edit(s.target!.id, v), 'Updated on chain.');
      if (s.mode === 'reply' && s.target) return act(() => post(ME!.mask, v, s.target!.id, 0), 'Replied on chain.');
      if (s.mode === 'quote' && s.target) return act(() => post(ME!.mask, v, 0, s.target!.id), 'Quoted on chain.');
      return act(async () => {
        const r = await post(ME!.mask, v);
        if (!r.ok) draft.set(v); // hand the words back
        return r;
      }, 'Posted on chain.');
    });
  }

  document.getElementById('savep')?.addEventListener('click', () => {
    const g = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value ?? '';
    const [name, tg, x, bio, handle] = [g('s_name'), g('s_tg'), g('s_x'), g('s_bio'), g('s_handle')];
    const wantHandle = handle.trim().replace(/^@/, '');
    settingsOpen = false;
    act(async () => {
      const r = await saveProfile(name, tg, x, bio);
      if (!r.ok) return r;
      // The handle lives in its own contract, so it is a second signature — only
      // asked for when it actually changed.
      if (wantHandle && wantHandle !== ME?.handle) {
        const h = await setHandle(ME!.mask, wantHandle);
        if (!h.ok) return { ok: false, why: /TakenAlready|ContractReverted/i.test(h.why) ? 'That username is already taken by another mask.' : h.why };
      }
      forgetWho();
      ME = await me();
      return r;
    }, 'Saved on chain.');
  });
  document.getElementById('usehandle')?.addEventListener('click', async () => {
    const n = await suggestedName();
    const el = document.getElementById('s_handle') as HTMLInputElement | null;
    if (el && n) el.value = n;
    if (!n) { flash = { text: 'The host did not report a People chain username.', bad: true }; render(); }
  });
  document.getElementById('usepeople')?.addEventListener('click', async () => {
    const n = await suggestedName();
    const el = document.getElementById('s_name') as HTMLInputElement | null;
    if (el && n) el.value = n;
    if (!n) { flash = { text: 'The host did not report a People chain username.', bad: true }; render(); }
  });
  document.getElementById('claim')?.addEventListener('click', () => {
    const label = (document.getElementById('dotlabel') as HTMLInputElement)?.value ?? '';
    act(async () => { const r = await claimMask(label); if (r.ok) ME = await me(); return r; }, 'Mask claimed — it is yours and cannot be moved.');
  });

  app.querySelectorAll<HTMLElement>('[data-like]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const p = findPost(Number(b.dataset.like));
    // Move the heart now and reconcile after: a like that waits for a block
    // feels broken even when it is working.
    if (p) { p.liked = !p.liked; p.likes += p.liked ? 1 : -1; render(); }
    act(() => toggleLike(Number(b.dataset.like)), p?.liked ? 'Liked.' : 'Like removed.');
  }));
  app.querySelectorAll<HTMLElement>('[data-repost]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!ME?.mask) { flash = { text: 'Claim a mask first.', bad: true }; return render(); }
    repostFor = Number(b.dataset.repost); render();
  }));
  app.querySelectorAll<HTMLElement>('[data-rp]').forEach((b) => b.addEventListener('click', () => {
    const what = b.dataset.rp, p = repostFor ? findPost(repostFor) : undefined;
    repostFor = null;
    if (!p || what === 'close') return render();
    if (what === 'quote') { sheet = { mode: 'quote', target: p }; return render(); }
    act(() => toggleRepost(p.id, ME!.mask), p.reposted ? 'Repost undone.' : 'Reposted.');
  }));
  app.querySelectorAll<HTMLElement>('[data-reply]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const p = findPost(Number(b.dataset.reply));
    if (p) { sheet = { mode: 'reply', target: p }; render(); }
  }));
  app.querySelectorAll<HTMLElement>('[data-follow]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); act(() => toggleFollow(Number(b.dataset.follow)), 'Done.');
  }));
  app.querySelectorAll<HTMLElement>('[data-share]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const p = findPost(Number(b.dataset.share));
    if (!p) return;
    shareFor = p.id; render();
  }));
  app.querySelectorAll<HTMLElement>('[data-mark]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    marks.toggle(Number(b.dataset.mark));
    render();
  }));
  app.querySelectorAll<HTMLElement>('[data-sh]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const p = findPost(shareFor ?? 0);
    if (!p) { shareFor = null; return render(); }
    const how = b.dataset.sh;
    if (how === 'close') { shareFor = null; return render(); }
    const url = chirpLink(p.id);
    const text = `${nm(p.who, p.mask)} on chirp: "${p.body}"`;
    shareFor = null;
    if (how === 'copy') {
      await navigator.clipboard.writeText(url).catch(() => undefined);
      flash = { text: 'Link copied.' };
    } else if (how === 'copytext') {
      await navigator.clipboard.writeText(`${text}\n${url}`).catch(() => undefined);
      flash = { text: 'Chirp and link copied.' };
    } else if (how === 'native') {
      // The webview may or may not have a share sheet. If it does not, this
      // throws and we say so rather than appearing to have done something.
      try {
        if (navigator.share) await navigator.share({ text, url });
        else { await navigator.clipboard.writeText(url); flash = { text: 'No share sheet here — link copied instead.' }; }
      } catch { /* dismissed by the person, which is not a failure */ }
    } else if (how === 'quote') {
      sheet = { mode: 'quote', target: p };
    } else if (how === 'chain') {
      void openUrl(`https://assethub-paseo.subscan.io/account/${CHIRP}`);
    }
    render();
  }));
  app.querySelectorAll<HTMLElement>('[data-more]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); menuFor = Number(b.dataset.more); render();
  }));
  app.querySelectorAll<HTMLElement>('[data-who]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); goProfile(Number(b.dataset.who));
  }));
  app.querySelectorAll<HTMLElement>('[data-conn]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    go({ k: 'people', mask: Number(b.dataset.mask), of: b.dataset.conn as 'followers' | 'following' });
  }));
  app.querySelectorAll<HTMLElement>('[data-q]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); query = b.dataset.q ?? ''; go({ k: 'search' });
  }));
  app.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.m, id = Number(b.dataset.id), p = id ? findPost(id) : undefined;
    menuFor = null;
    if (m === 'close' || !p) return render();
    if (m === 'edit') { sheet = { mode: 'edit', target: p }; return render(); }
    if (m === 'quote') { sheet = { mode: 'quote', target: p }; return render(); }
    if (m === 'del') { confirmDelete = p.id; return render(); }
    if (m === 'who') return goProfile(p.mask);
    if (m === 'why') { whyFor = whyFor === p.id ? null : p.id; return render(); }
    if (m === 'mark') { marks.toggle(p.id); flash = { text: marks.has(p.id) ? 'Bookmarked on this device.' : 'Bookmark removed.' }; return render(); }
    if (m === 'mute') { muted.toggle(p.mask); flash = { text: muted.has(p.mask) ? 'Muted on this device.' : 'Unmuted.' }; return render(); }
    if (m === 'note') { noteSheet = { chirpId: p.id, kind: 0 }; return render(); }
    if (m === 'link') {
      void navigator.clipboard.writeText(`${location.origin}${location.pathname}#/t/${p.id}`);
      flash = { text: 'Link copied.' }; return render();
    }
    if (m === 'copy') { void navigator.clipboard.writeText(p.body); flash = { text: 'Copied.' }; return render(); }
    if (m === 'chain') { void openUrl(`https://assethub-paseo.subscan.io/account/${CHIRP}`); return render(); }
    render();
  }));
  document.getElementById('showfresh')?.addEventListener('click', () => { showFresh(); render(); });
  document.getElementById('gosaved')?.addEventListener('click', () => go({ k: 'saved' }));
  document.getElementById('gostats')?.addEventListener('click', () => go({ k: 'stats' }));
  app.querySelectorAll<HTMLElement>('[data-url]').forEach((a) => a.addEventListener('click', async (e) => {
    e.stopPropagation(); e.preventDefault();
    const u = a.dataset.url ?? '';
    // If the container will not open it, say so and show the address. A tap
    // that silently does nothing is the worst of the three outcomes.
    if (!(await openUrl(u))) { linkFor = u; render(); }
  }));
  document.getElementById('linkclose')?.addEventListener('click', () => { linkFor = null; render(); });
  document.getElementById('linkcopy')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(linkFor ?? '').catch(() => undefined);
    linkFor = null; flash = { text: 'Address copied.' }; render();
  });
  app.querySelectorAll<HTMLElement>('[data-why]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    whyFor = whyFor === Number(b.dataset.why) ? null : Number(b.dataset.why);
    render();
  }));

  /* ------------------------------------------------------------- pictures */
  document.getElementById('pfpfile')?.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) { pfpStep = { text: 'The picker closed without a file.', bad: true }; return render(); }
    await usePicture(f);
  });
  // Paste: the clipboard route, for containers with no file chooser.
  document.getElementById('pastepfp')?.addEventListener('paste', async (e) => {
    e.preventDefault();
    const items = [...((e as ClipboardEvent).clipboardData?.items ?? [])];
    const img = items.find((i) => i.type.startsWith('image/'));
    if (!img) { pfpStep = { text: 'Nothing on the clipboard looked like an image.', bad: true }; return render(); }
    const f = img.getAsFile();
    if (f) await usePicture(f);
  });
  document.getElementById('pfprights')?.addEventListener('click', async () => {
    pfpStep = { text: 'Asking…' }; render();
    const r = await pictureRights();
    const said = Object.entries(r).map(([k, v]) => `${k}: ${v ? 'yes' : 'no'}`).join(', ');
    pfpStep = Object.keys(r).length
      ? { text: `The app answered — ${said}.`, bad: Object.values(r).some((v) => !v) }
      : { text: 'No host here: pictures need the Polkadot app.', bad: true };
    render();
  });
  document.getElementById('clearpfp')?.addEventListener('click', async () => {
    if (!ME?.mask) return;
    const r = await clearPicture(ME.mask);
    if (r.ok) { PIC.delete(ME.mask); picWanted.delete(ME.mask); forgetPicture(ME.mask); flash = { text: 'Back to the generated face.' }; }
    else flash = { text: r.why, bad: true };
    render();
  });

  /* ---------------------------------------------------------------- notes */
  document.getElementById('addnote')?.addEventListener('click', () => {
    if (view.k === 'thread') { noteSheet = { chirpId: view.id, kind: 0 }; render(); }
  });
  app.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    if (noteSheet) { noteSheet.kind = Number(b.dataset.kind); render(); }
  }));
  document.getElementById('savenote')?.addEventListener('click', async () => {
    const ta = document.getElementById('notebody') as HTMLTextAreaElement | null;
    const body = ta?.value.trim() ?? '';
    if (!body || !noteSheet || !ME?.mask) return;
    flash = { text: 'Publishing the note…' }; render();
    const r = await addNote(noteSheet.chirpId, ME.mask, noteSheet.kind, body);
    noteSheet = null;
    flash = r.ok ? { text: 'Note published.' } : { text: r.why, bad: true };
    if (r.ok) await refreshNotes();
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-rate]').forEach((b) => b.addEventListener('click', async () => {
    if (!ME?.mask) return;
    const id = Number(b.dataset.rate), v = Number(b.dataset.v);
    flash = { text: 'Recording your rating…' }; render();
    const r = await rateNote(id, ME.mask, v);
    flash = r.ok ? { text: 'Rated. It cannot be changed — that is what stops people waiting to see which way it goes.' } : { text: r.why, bad: true };
    if (r.ok) await refreshNotes();
    render();
  }));
  document.getElementById('askpush')?.addEventListener('click', async () => {
    const ok = await askNotifications();
    push.set(ok ? 'on' : 'off');
    // Whatever is already on this page has been seen, so it is not news.
    if (ok && NOTIF.length) pushed.set(Math.max(pushed.get(), ...NOTIF.map((p) => p.id)));
    flash = ok ? { text: 'Notifications on.' } : { text: 'The app said no to notifications.', bad: true };
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-open]').forEach((c) => c.addEventListener('click', () => {
    const id = Number(c.dataset.open);
    if (view.k === 'thread' && TH.post?.id === id) return;
    go({ k: 'thread', id });
  }));
}

async function refresh() {
  busy = true; loadError = ''; FRESH = [];  // a full read supersedes anything held back
  render();
  ALL = await loadAll(page, (soFar) => { ALL = soFar; render(); })
    .catch((e) => { loadError = String(e?.message ?? e).slice(0, 120) || 'The chain did not answer.'; return ALL; });
  if (view.k === 'people' || view.k === 'profile') CONN = await connections(view.mask).catch(() => CONN);
  if (view.k === 'thread') TH = await thread(view.id).catch(() => TH);
  // ALL is handed on rather than re-read: both of these used to fetch the whole
  // timeline again, so a refresh cost it two or three times over.
  if (view.k === 'profile') PROF = await profile(view.mask, ALL).catch(() => PROF);
  if (view.k === 'search' && !PEOPLE.length) PEOPLE = await people().catch(() => []);
  if (view.k === 'notif') {
    NOTIF = await notifications(ME?.mask ?? 0, ALL).catch(() => NOTIF);
    if (NOTIF.length) seen.set(Math.max(seen.get(), ...NOTIF.map((p) => p.id)));
  } else if (ME?.mask) {
    NOTIF = await notifications(ME.mask, ALL).catch(() => NOTIF); // keep the badge honest
  }
  await refreshNotes().catch(() => undefined);
  FOLLOWERS = await followerCounts().catch(() => FOLLOWERS);
  if (ME?.mask) FOLLOW = await following().catch(() => FOLLOW);
  busy = false;
  render();
}

/**
 * Any photo becomes a 256px square WebP, here on the device.
 *
 * The crop is centred rather than offered as a control: a picker with handles is
 * a lot of interface for a 40px circle. 256 is the size the biggest avatar on
 * the page is drawn at, doubled for a retina screen, and nothing is served by
 * uploading more — Bulletin has a quota and this has to be renewed forever.
 */
/**
 * Take a picture from wherever it came — the file chooser or the clipboard —
 * and put it on chain, narrating each step.
 *
 * The narration is not decoration. Inside a container every one of these steps
 * can fail without saying anything: no picker, no clipboard, no permission, no
 * preimage service. A person tapping a dead button has nothing to report and
 * nothing to try; a person who can see it stopped at "uploading" does.
 */
async function usePicture(f: File) {
  if (!ME?.mask) return;
  pfpStep = { text: `Got ${f.name || 'the image'} — ${Math.round(f.size / 1024)} KB. Resizing…` }; render();
  const bytes = await squareWebp(f).catch(() => null);
  if (!bytes) { pfpStep = { text: 'That file could not be decoded as an image.', bad: true }; return render(); }
  pfpStep = { text: `Resized to ${bytes.length} bytes. Uploading to Bulletin…` }; render();
  const r = await setPicture(ME.mask, bytes);
  if (r.ok) {
    PIC.set(ME.mask, 'data:image/webp;base64,' + btoa(String.fromCharCode(...bytes)));
    picWanted.delete(ME.mask);
    pfpStep = { text: 'Picture set.' };
  } else {
    pfpStep = { text: r.why, bad: true };
  }
  render();
}

async function squareWebp(file: File, size = 256): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/webp', 0.85));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Re-read the notes for whatever is on screen. Kept apart from refresh() so a
 *  rating does not also re-fetch the entire timeline. */
async function refreshNotes() {
  NOTED = await notedChirps().catch(() => NOTED);
  if (view.k === 'thread') THNOTES = await notesOn(view.id).catch(() => THNOTES);
}

/* ------------------------------------------------------------ pull to refresh */
//
// Only from the very top, and only for a real downward drag: anything looser
// fights the scroll on a long timeline, which is worse than not having it. The
// indicator follows the finger with resistance so the gesture feels attached to
// something rather than triggering at an invisible threshold.
const PULL_TRIGGER = 72;
let pullFrom = -1;
let pulled = 0;

function pullEl(): HTMLElement {
  let el = document.getElementById('pull');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pull';
    el.className = 'pull';
    el.innerHTML = '<div class="pull-spin"></div>';
    document.body.appendChild(el);
  }
  return el;
}

function setPull(px: number, spinning = false) {
  const el = pullEl();
  el.style.transform = `translate(-50%, ${Math.min(px, PULL_TRIGGER + 20)}px)`;
  el.style.opacity = String(Math.min(1, px / 40));
  el.classList.toggle('ready', px >= PULL_TRIGGER);
  el.classList.toggle('spinning', spinning);
}

addEventListener('touchstart', (e) => {
  // A sheet open, or already scrolled: not a pull.
  if (sheet || settingsOpen || noteSheet || menuFor || scrollY > 2 || busy) { pullFrom = -1; return; }
  pullFrom = e.touches[0].clientY;
}, { passive: true });

addEventListener('touchmove', (e) => {
  if (pullFrom < 0) return;
  const dy = e.touches[0].clientY - pullFrom;
  if (dy <= 0) { pulled = 0; setPull(0); return; }
  // Square-root resistance: the first pixels move freely, the last ones do not,
  // which is what makes a pull feel like it is pulling against something.
  pulled = Math.sqrt(dy) * 9;
  setPull(pulled);
}, { passive: true });

addEventListener('touchend', () => {
  if (pullFrom < 0) return;
  const go = pulled >= PULL_TRIGGER;
  pullFrom = -1; pulled = 0;
  if (!go) return setPull(0);
  setPull(PULL_TRIGGER, true);
  void refresh().finally(() => setPull(0));
});

/* ---------------------------------------------------------------- live feed */
// The chain has no subscription we can lean on here, so the feed asks. It asks
// only while the app is actually being looked at and nothing is being written:
// a poll behind a hidden tab is a bill nobody reads, and one that lands mid-post
// would redraw the composer out from under the caret.
const POLL_MS = 20_000;

/** Fold the held-back chirps into the feed. `scroll` is false when the column is
 *  being redrawn for another reason and jumping the page would be rude. */
function showFresh(scroll = true) {
  if (!FRESH.length) return;
  ALL = [...FRESH, ...ALL];
  FRESH = [];
  if (scroll) scrollTo({ top: 0, behavior: 'smooth' });
}

async function poll() {
  if (document.visibilityState !== 'visible') return;
  if (busy || sheet || settingsOpen || noteSheet) return;
  const fresh = await loadAll(page).catch(() => null);
  if (!fresh) return;                       // a quiet network is not news
  // Replies to you are worth knowing about wherever you are in the app, and they
  // are a slice of the feed we just read — not a second read of it.
  if (ME?.mask) { NOTIF = await notifications(ME.mask, fresh).catch(() => NOTIF); await announce(); }
  if (view.k !== 'home') { ALL = fresh; return render(); }
  if (busy || sheet || view.k !== 'home') return;  // it may have changed while we waited
  const known = new Set(ALL.map((p) => p.id));
  const added = fresh.filter((p) => !known.has(p.id) && !p.replyTo);
  // Counts, likes and edits on chirps already shown can land straight away —
  // nothing moves. Only genuinely new top-level chirps wait behind the button.
  const addedIds = new Set(added.map((p) => p.id));
  ALL = fresh.filter((p) => !addedIds.has(p.id));
  FRESH = added;
  render();
}

/** Push what arrived for you while you were elsewhere — once per chirp, and as
 *  one line rather than one alert each, because five buzzes for five replies is
 *  how an app gets its notifications turned off. */
async function announce() {
  if (push.get() !== 'on') return;
  const mark = pushed.get();
  const fresh = NOTIF.filter((p) => p.id > mark);
  if (!fresh.length) return;
  pushed.set(Math.max(mark, ...fresh.map((p) => p.id)));
  const one = fresh[0];
  const text = fresh.length === 1
    ? `${one.who ? nm(one.who) : 'Someone'} replied: ${one.body.slice(0, 80)}`
    : `${fresh.length} new replies and quotes on chirp`;
  await notify(text, fresh.length === 1 ? `#/t/${one.id}` : '#/notifications');
}

setInterval(() => { void poll(); }, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void poll();
});

/* ------------------------------------------------------------------ keyboard */
// Escape closes whatever is open; Cmd/Ctrl+Enter sends what is being written.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (sheet || settingsOpen || menuFor || confirmDelete || repostFor)) {
    sheet = null; settingsOpen = false; menuFor = null; confirmDelete = null; repostFor = null; render();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const b = document.getElementById('ssend') as HTMLButtonElement | null;
    if (b && !b.disabled) b.click();
  }
});
addEventListener('hashchange', () => { view = viewOf(location.hash); refresh(); });

/* --------------------------------------------------------------------- boot */
view = viewOf(location.hash);
warmUp();
// Paint the last feed we had, immediately. It is public data we already read,
// it is replaced the moment the chain answers, and it is the difference between
// opening the app and opening three grey rectangles.
ALL = cachedFeed();
render();
if (!ALL.length) app.innerHTML = header() + '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';

(async () => {
  // The feed does NOT wait for the wallet: it reads over the public RPC while
  // the handshake is still going. Identity fills in when it arrives.
  const first = refresh();
  ME = await me().catch(() => null);
  ACT = await actingAs().catch(() => null);
  await first;
  // Go through refresh() rather than loading the feed by hand: a deep link — a
  // shared thread, someone's profile — has to arrive with ITS data, not with an
  // empty shell and a timeline nobody asked for.
  await refresh();
  // Push your picture's retention window back. Content-addressed, so the same
  // bytes give the same key and the contract still points at it: no transaction,
  // no chain write, and it is the whole reason a picture survives at all.
  if (ME?.mask) void renewPicture(ME.mask);
})();
