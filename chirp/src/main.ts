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
  askNotifications, notify,
  pictureOf, setPicture, clearPicture, renewPicture, forgetPicture,
  notesOn, notedChirps, addNote, rateNote, rank,
  CHIRP, MASKS, NOTES as NOTES_ADDR, type Post, type Me, type Who, type Note,
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
    .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${u}</a>`)
    .replace(/(^|\s)(@[A-Za-z0-9_.-]{2,40})/g, (_m, sp, h) => `${sp}<a class="mention" data-q="${h.slice(1)}">${h}</a>`)
    .replace(/(^|\s)([A-Za-z0-9-]{2,40}\.dot)\b/g, (_m, sp, d) => `${sp}<a class="mention" data-q="${d}">${d}</a>`)
    .replace(/(^|\s)(#[A-Za-z0-9_]{1,40})/g, (_m, sp, t) => `${sp}<a class="mention" data-q="${t.slice(1)}">${t}</a>`);
}

const TICK = `<svg class="tick" viewBox="0 0 24 24" fill="currentColor"><path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg>`;
const S = (d: string, f = 'none') => `<svg viewBox="0 0 24 24" fill="${f}" stroke="currentColor" stroke-width="2">${d}</svg>`;
const I = {
  reply: S('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>'),
  repost: S('<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  like: S('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/>'),
  share: S('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/>'),
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
  | { k: 'home' } | { k: 'search' } | { k: 'notif' }
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
/** The newest id already pushed, so the same mention is not announced twice. */
const PUSHED = 'chirp.pushed';
const pushed = {
  get: () => { try { return Number(localStorage.getItem(PUSHED) ?? 0); } catch { return 0; } },
  set: (v: number) => { try { localStorage.setItem(PUSHED, String(v)); } catch { /* private mode */ } },
};

const findPost = (id: number) => [...ALL, ...TH.replies, ...TH.parents, TH.post].find((p) => p && p.id === id) as Post | undefined;

/* -------------------------------------------------------------------- cards */

function actions(p: Post): string {
  return `<div class="acts">
    <button class="act reply" data-reply="${p.id}">${I.reply}<span>${p.replies || ''}</span></button>
    <button class="act rep${p.reposted ? ' on' : ''}" data-repost="${p.id}" aria-pressed="${p.reposted ? 'true' : 'false'}" aria-label="Repost">${I.repost}<span>${p.reposts || ''}</span></button>
    <button class="act like${p.liked ? ' on' : ''}" data-like="${p.id}" aria-pressed="${p.liked ? 'true' : 'false'}" aria-label="Like">${I.like}<span>${p.likes || ''}</span></button>
    <button class="act share" data-share="${p.id}">${I.share}</button>
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
        ${actions(p)}
      </div>
    </div>
  </article>`;
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

const list = (ps: Post[], empty: string) => (ps.length ? ps.map((p) => card(p)).join('') : `<div class="note">${empty}</div>`);

/* -------------------------------------------------------------------- views */

function homeView(): string {
  const top = ALL.filter((p) => !p.replyTo);
  // Following stays strictly chronological — that is the point of it, and X
  // breaking that promise is the complaint people actually have. For you is
  // ranked, and says so.
  const shown = tab === 'following'
    ? top.filter((p) => FOLLOW.has(p.mask))
    : rank(top, FOLLOW, NOTED);
  return `<div class="tabs">
      <button class="tab${tab === 'foryou' ? ' on' : ''}" data-tab="foryou">For you</button>
      <button class="tab${tab === 'following' ? ' on' : ''}" data-tab="following">Following</button>
    </div>`
    + (FRESH.length ? `<button class="fresh-btn" id="showfresh">Show ${FRESH.length} new chirp${FRESH.length > 1 ? 's' : ''}</button>` : '')
    + (ME && !ME.mask ? gate() : '')
    + list(shown, tab === 'following' ? 'Nothing here yet — follow someone from their profile.' : 'No chirps yet.')
    + (ALL.length >= page ? '<button class="more-btn" id="loadmore">Show older chirps</button>' : '');
}

function searchView(): string {
  const t = query.trim().toLowerCase();
  const who = t ? PEOPLE.filter((w) => (w.name + ' ' + w.verified + ' mask' + w.mask).toLowerCase().includes(t)) : PEOPLE;
  const posts = t ? ALL.filter((p) => p.body.toLowerCase().includes(t)) : [];
  return `<div class="searchbar"><input id="q" placeholder="Search people and chirps" value="${esc(query)}" autocomplete="off"></div>`
    + (who.length ? `<div class="sechead">People</div>` + who.slice(0, 20).map((w) => personRow(w)).join('') : '')
    + (t ? `<div class="sechead">Chirps</div>` + list(posts, 'Nothing matches that.') : '');
}

function personRow(w: Who): string {
  return `<div class="prow" data-who="${w.mask}">
    <div class="av">${avatar('0x' + w.mask.toString(16).padStart(40, '0'), w.mask)}</div>
    <div class="grow"><div class="head"><span class="nm">${esc(nm(w))}</span>${w.verified ? TICK : ''}</div>
    <div class="at">${esc(at(w))} · <span class="tier t${w.tier}">${TIERS[w.tier]}</span></div></div>
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
      ${telegram ? `<a href="https://t.me/${encodeURIComponent(telegram)}" target="_blank" rel="noopener">✆ ${esc(telegram)}</a>` : ''}
      ${x ? `<a href="https://x.com/${encodeURIComponent(x)}" target="_blank" rel="noopener">𝕏 ${esc(x)}</a>` : ''}
      <span class="tier t${who.tier}">${TIERS[who.tier]}</span>
    </div>
    <div class="pstats">
      <a data-conn="followers" data-mask="${who.mask}"><b>${followers}</b> followers</a> ·
      <a data-conn="following" data-mask="${who.mask}"><b>${CONN.followingList.length}</b> following</a> ·
      <b>${posts.length}</b> chirps
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
    : view.k === 'search' ? 'Search' : view.k === 'notif' ? 'Notifications' : 'chirp';
  const who = !ME ? '<span>open in the Polkadot app</span>'
    : `<b>${ME.mask ? esc(nm(ME as unknown as Who)) : 'no mask yet'}</b><span>${esc(short(ME.address))}</span>`;
  // The mark stands in for the word only where the word would be the app's own
  // name; on a thread or a profile the title is doing real work and is left alone.
  const mark = title === 'chirp'
    ? `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="20" cy="44" r="4.5" fill="currentColor"/><g fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"><path d="M20 30 A14 14 0 0 1 34 44"/><path d="M20 20 A24 24 0 0 1 44 44"/></g></svg>` : '';
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
          <button class="ghost small" id="pickpfp">Choose a picture</button>
          ${PIC.get(ME.mask) ? '<button class="ghost small" id="clearpfp">Remove</button>' : ''}
          <input type="file" id="pfpfile" accept="image/*" hidden>
        </div>
      </div>
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
    const mine = ME && p.author.toLowerCase() === ME.address.toLowerCase();
    return `<div class="scrim" id="scrim"><div class="menu">
      ${mine ? `<button data-m="edit" data-id="${p.id}">Edit chirp</button>
                <button class="danger" data-m="del" data-id="${p.id}">Delete chirp</button>` : ''}
      <button data-m="quote" data-id="${p.id}">Quote</button>
      <button data-m="who" data-id="${p.id}">View profile</button>
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
        <a href="https://assethub-paseo.subscan.io/account/${CHIRP}" target="_blank" rel="noopener">Chirp contract</a> on the devnet
        Asset Hub. You post as a <a href="https://assethub-paseo.subscan.io/account/${MASKS}" target="_blank" rel="noopener">mask</a>
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
  return v.k === 'home' ? '#/' : v.k === 'search' ? '#/search' : v.k === 'notif' ? '#/notifications'
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
    const text = `${nm(p.who, p.mask)} on chirp: "${p.body}"`;
    // Link to the chirp itself. Pointing at the contract explorer was technically
    // true and useless: nobody wants to read a storage dump of your post.
    const url = `${location.origin}${location.pathname}#/t/${p.id}`;
    try {
      if (navigator.share) await navigator.share({ text, url });
      else { await navigator.clipboard.writeText(`${text} — ${url}`); flash = { text: 'Copied.' }; render(); }
    } catch { /* dismissed */ }
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
    if (m === 'copy') { void navigator.clipboard.writeText(p.body); flash = { text: 'Copied.' }; return render(); }
    if (m === 'chain') { window.open(`https://assethub-paseo.subscan.io/account/${CHIRP}`, '_blank'); return render(); }
    render();
  }));
  document.getElementById('showfresh')?.addEventListener('click', () => { showFresh(); render(); });

  /* ------------------------------------------------------------- pictures */
  document.getElementById('pickpfp')?.addEventListener('click', () => document.getElementById('pfpfile')?.click());
  document.getElementById('pfpfile')?.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f || !ME?.mask) return;
    flash = { text: 'Preparing the picture…' }; render();
    const bytes = await squareWebp(f).catch(() => null);
    if (!bytes) { flash = { text: 'That file could not be read as an image.', bad: true }; return render(); }
    flash = { text: 'Uploading…' }; render();
    const r = await setPicture(ME.mask, bytes);
    if (r.ok) { PIC.set(ME.mask, 'data:image/webp;base64,' + btoa(String.fromCharCode(...bytes))); flash = { text: 'Picture set.' }; }
    else flash = { text: r.why, bad: true };
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
  ALL = await loadAll(page).catch((e) => { loadError = String(e?.message ?? e).slice(0, 120) || 'The chain did not answer.'; return ALL; });
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
app.innerHTML = header() + '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
warmUp();
view = viewOf(location.hash);
(async () => {
  ME = await me().catch(() => null);
  ACT = await actingAs().catch(() => null);
  // Go through refresh() rather than loading the feed by hand: a deep link — a
  // shared thread, someone's profile — has to arrive with ITS data, not with an
  // empty shell and a timeline nobody asked for.
  await refresh();
  // Push your picture's retention window back. Content-addressed, so the same
  // bytes give the same key and the contract still points at it: no transaction,
  // no chain write, and it is the whole reason a picture survives at all.
  if (ME?.mask) void renewPicture(ME.mask);
})();
