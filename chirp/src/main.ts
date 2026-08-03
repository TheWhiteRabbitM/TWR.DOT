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
  claimMask, saveProfile, suggestedName, forgetWho, connections,
  CHIRP, MASKS, type Post, type Me, type Who,
} from './chain';

const app = document.getElementById('app')!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/* ---- the mask, drawn as the contract draws it: seeded by the address ---- */
const PAL = ['#4f8cff', '#a855f7', '#ec4899', '#22d3ee', '#2dd4bf', '#f59e0b', '#f472b6', '#818cf8', '#34d399', '#fb7185'];
function avatar(addr: string): string {
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
const nm = (w?: Who, mask = 0) => w?.name || (w?.verified ? w.verified + '.dot' : 'mask #' + (w?.mask || mask));
const at = (w?: Who, mask = 0) => (w?.verified ? '@' + w.verified + '.dot' : '@mask' + (w?.mask || mask));

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
let query = '';
let flash: { text: string; bad?: boolean } | null = null;
/** How much of the feed is loaded. The chain has no cursor, so this is simply
 *  how far back from the newest chirp we have read. */
let page = 25;
let CONN: { followers: Who[]; followingList: Who[] } = { followers: [], followingList: [] };
/** True while a refresh is in flight, so the header can say so instead of the
 *  app looking frozen. */
let busy = false;

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

const findPost = (id: number) => [...ALL, ...TH.replies, ...TH.parents, TH.post].find((p) => p && p.id === id) as Post | undefined;

/* -------------------------------------------------------------------- cards */

function actions(p: Post): string {
  return `<div class="acts">
    <button class="act reply" data-reply="${p.id}">${I.reply}<span>${p.replies || ''}</span></button>
    <button class="act rep${p.reposted ? ' on' : ''}" data-repost="${p.id}">${I.repost}<span>${p.reposts || ''}</span></button>
    <button class="act like${p.liked ? ' on' : ''}" data-like="${p.id}">${I.like}<span>${p.likes || ''}</span></button>
    <button class="act share" data-share="${p.id}">${I.share}</button>
  </div>`;
}

function card(p: Post, big = false): string {
  const repost = p.quoteOf && !p.body;
  const shown = repost && p.quoted ? p.quoted : p;
  return `<article class="chirp${big ? ' big' : ''}" data-open="${p.id}">
    ${repost ? `<div class="ctx">${I.repost}<span>${esc(nm(p.who, p.mask))} reposted</span></div>` : ''}
    <div class="row">
      <div class="av" data-who="${shown.mask}">${avatar(shown.author)}</div>
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
        ${actions(p)}
      </div>
    </div>
  </article>`;
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
  const shown = tab === 'following' ? top.filter((p) => FOLLOW.has(p.mask)) : top;
  return `<div class="tabs">
      <button class="tab${tab === 'foryou' ? ' on' : ''}" data-tab="foryou">For you</button>
      <button class="tab${tab === 'following' ? ' on' : ''}" data-tab="following">Following</button>
    </div>`
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
    <div class="av">${avatar('0x' + w.mask.toString(16).padStart(40, '0'))}</div>
    <div class="grow"><div class="head"><span class="nm">${esc(nm(w))}</span>${w.verified ? TICK : ''}</div>
    <div class="at">${esc(at(w))} · <span class="tier t${w.tier}">${TIERS[w.tier]}</span></div></div>
  </div>`;
}

function notifView(): string {
  return `<div class="sechead">Replies and quotes of your chirps</div>`
    + list(NOTIF, ME?.mask ? 'Nothing yet.' : 'Claim a mask to get replies.');
}

function profileView(): string {
  if (!PROF) return '<div class="note">Loading…</div>';
  const { who, bio, telegram, x, followers, posts, isMe, iFollow } = PROF;
  const addr = posts[0]?.author ?? '0x' + who.mask.toString(16).padStart(40, '0');
  return `<section class="phead">
    <div class="pavatar">${avatar(addr)}</div>
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
    + `<div class="sechead">Replies</div>`
    + (byParent.get(view.k === 'thread' ? view.id : 0)?.length ? branch(view.k === 'thread' ? view.id : 0, 0)
      : '<div class="note">No replies yet. Be the first.</div>');
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
  return `<header class="top">${back}<h1>${title}${busy ? '<span class="dotspin" aria-label="Loading"></span>' : ''}</h1>
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
      <label>Public name</label>
      <input id="s_name" maxlength="40" value="${esc(ME.name)}" placeholder="the name people see">
      <button class="link" id="usepeople">use my People chain username</button>
      <label>.dot ${ME.verified ? '<span class="okmark">verified ✓</span>' : ''}</label>
      <input value="${ME.verified ? esc(ME.verified) + '.dot' : ''}" placeholder="set when you claimed your mask" disabled>
      ${ME.verified ? '' : '<p class="hint">A .dot is checked when the mask is claimed, and that check is what earns the tick — it cannot be added afterwards.</p>'}
      <label>Bio</label><input id="s_bio" maxlength="160" value="${esc(ME.bio)}" placeholder="one line about you">
      <label>Telegram</label><input id="s_tg" maxlength="32" value="${esc(ME.telegram)}" placeholder="handle, without @">
      <label>X</label><input id="s_x" maxlength="32" value="${esc(ME.x)}" placeholder="handle, without @">
      <button class="primary wide" id="savep">Save on chain</button>
      <p class="hint">The name is yours to choose and proves nothing — which is exactly why the tick is reserved for the .dot the contract verified.</p>
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
  document.body.classList.toggle('locked', Boolean(sheet || settingsOpen || menuFor));

  const body = view.k === 'home' ? homeView()
    : view.k === 'search' ? searchView()
    : view.k === 'notif' ? notifView()
    : view.k === 'profile' ? profileView()
    : view.k === 'people' ? peopleView()
    : threadView();
  app.innerHTML = header()
    + (flash ? `<div class="msg ${flash.bad ? 'bad' : 'good'}">${esc(flash.text)}</div>` : '')
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
    if (e.target === document.getElementById('scrim')) { settingsOpen = false; sheet = null; menuFor = null; render(); }
  });
  document.getElementById('fab')?.addEventListener('click', () => { sheet = { mode: 'new' }; render(); });
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
    tab = b.dataset.tab as 'foryou' | 'following'; render();
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
    const [name, tg, x, bio] = [g('s_name'), g('s_tg'), g('s_x'), g('s_bio')];
    settingsOpen = false;
    act(async () => { const r = await saveProfile(name, tg, x, bio); if (r.ok) { forgetWho(); ME = await me(); } return r; }, 'Saved on chain.');
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
    const p = findPost(Number(b.dataset.repost));
    if (p) act(() => toggleRepost(p.id, ME!.mask), p.reposted ? 'Repost undone.' : 'Reposted.');
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
    if (m === 'del') return act(() => remove(p.id), 'Deleted on chain.');
    if (m === 'who') return goProfile(p.mask);
    if (m === 'copy') { void navigator.clipboard.writeText(p.body); flash = { text: 'Copied.' }; return render(); }
    if (m === 'chain') { window.open(`https://assethub-paseo.subscan.io/account/${CHIRP}`, '_blank'); return render(); }
    render();
  }));
  app.querySelectorAll<HTMLElement>('[data-open]').forEach((c) => c.addEventListener('click', () => {
    const id = Number(c.dataset.open);
    if (view.k === 'thread' && TH.post?.id === id) return;
    go({ k: 'thread', id });
  }));
}

async function refresh() {
  busy = true; render();
  ALL = await loadAll(page).catch(() => ALL);
  if (view.k === 'people' || view.k === 'profile') CONN = await connections(view.mask).catch(() => CONN);
  if (view.k === 'thread') TH = await thread(view.id).catch(() => TH);
  if (view.k === 'profile') PROF = await profile(view.mask).catch(() => PROF);
  if (view.k === 'search' && !PEOPLE.length) PEOPLE = await people().catch(() => []);
  if (view.k === 'notif') {
    NOTIF = await notifications(ME?.mask ?? 0).catch(() => NOTIF);
    if (NOTIF.length) seen.set(Math.max(seen.get(), ...NOTIF.map((p) => p.id)));
  } else if (ME?.mask) {
    NOTIF = await notifications(ME.mask).catch(() => NOTIF); // keep the badge honest
  }
  if (ME?.mask) FOLLOW = await following().catch(() => FOLLOW);
  busy = false;
  render();
}

/* ------------------------------------------------------------------ keyboard */
// Escape closes whatever is open; Cmd/Ctrl+Enter sends what is being written.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (sheet || settingsOpen || menuFor)) {
    sheet = null; settingsOpen = false; menuFor = null; render();
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
  // Go through refresh() rather than loading the feed by hand: a deep link — a
  // shared thread, someone's profile — has to arrive with ITS data, not with an
  // empty shell and a timeline nobody asked for.
  await refresh();
})();
