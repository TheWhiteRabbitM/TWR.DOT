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
import { keep, hydrate, durable } from './keep';
import { runProbe, probeReport, type Finding } from './probe';
import {
  warmUp, me, loadAll, thread, people, following, profile, notifications,
  post, postThread, edit, remove, toggleLike, toggleRepost, toggleFollow,
  claimMask, saveProfile, suggestedName, forgetWho, connections, setHandle, actingAs, canSign,
  pinnedOf, pinChirp, unpinChirp,
  askNotifications, notify, openUrl, gifUrl, gifKind, gifBlob, cachedFeed, TOTAL,
  chatAvailable, discuss, chatRooms, registerBot, serveBot,
  pictureOf, setPicture, clearPicture, renewPicture, forgetPicture, FACE_MAX,
  notesOn, notedChirps, addNote, rateNote, rank, rankWhy,
  followerCounts, interestsFrom, statsFor,
  pollOn, createPoll, votePoll, forgetPolls, findMine, type Poll,
  rulesFor, setReplyPolicy, isBlocked, setBlocked, mayReply, forgetRules,
  REPLY_EVERYONE, REPLY_FOLLOWING, REPLY_MENTIONED,
  mediaOf, attachMedia, detachMedia, forgetMedia, MEDIA_MAX,
  CHIRP, MASKS, NOTES as NOTES_ADDR, type Post, type Me, type Who, type Note, type Stats, type Notice,
} from './chain';
import { lists, createList, removeList, toggleInList, listsWith } from './lists';

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
/**
 * When each mask was last asked for, and how often.
 *
 * Both, because a count alone is not a budget. Boot renders several times in
 * quick succession — the cached feed, then every batch as it lands — and a plain
 * counter burns its retries inside one second, all of them against the reader
 * that is about to be replaced. The face is then given up on permanently, at the
 * exact moment the app was about to gain a working way to fetch it.
 */
const picTries = new Map<number, { n: number; at: number }>();
const PIC_RETRY_GAP = 4000;
const PIC_MAX_TRIES = 8;

function wantPicture(mask: number) {
  if (picWanted.has(mask)) return;
  picWanted.add(mask);
  void pictureOf(mask).then((url) => {
    if (url === null) {
      // Not "no picture" — "could not ask". This latch is the reason every face
      // on the gateway stayed generated after the reader was fixed: the first
      // attempt ran against the session's dead reader, chain-side caches were
      // cleared when it fell back to the public RPC, and this Set was not, so
      // nothing ever asked again. Let it go — but spaced, so a burst of renders
      // cannot spend the whole budget in a second, and capped, so a mask the
      // chain will genuinely never answer for cannot spin for ever.
      const prev = picTries.get(mask) ?? { n: 0, at: 0 };
      const now = Date.now();
      if (now - prev.at < PIC_RETRY_GAP) { picWanted.delete(mask); return; }  // too soon to count
      picTries.set(mask, { n: prev.n + 1, at: now });
      if (prev.n + 1 < PIC_MAX_TRIES) picWanted.delete(mask);
      return;
    }
    if (!url) return;                     // asked, and there is no picture
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
    // A REAL anchor now — href and target, not a bare data-url.
    //
    // The comment that used to sit here said the container has no second window
    // and that target="_blank" is a link that does nothing. That was wrong, and
    // it was wrong for months. Read off the live gateway rather than assumed,
    // the app is framed with
    //   sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
    // — `allow-popups` is present. A link CAN open a window; what the frame
    // cannot do is navigate the top page, which is a different restriction.
    //
    // A real anchor lets the browser open it natively, and that is the one path
    // no popup heuristic ever blocks, because the click IS the gesture. The
    // data-url handler stays as the fallback for hosts that still refuse.
    // rel=noopener because a popup that inherits this sandbox should not also
    // get a handle back to it.
    .replace(/https?:\/\/[^\s<]+/g, (u) => (gifUrl(u) ? gifTag(u) : `<a class="ext" href="${u}" target="_blank" rel="noopener noreferrer" data-url="${u}">${u}</a>`))
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
  if (local) return `<a class="ext gifwrap" href="${u}" target="_blank" rel="noopener noreferrer" data-url="${u}"><img class="gif" src="${local}" alt="GIF"></a>`;
  if (local === undefined) {
    GIFS.set(u, '');            // claim it before the async call, or every render refires
    void gifBlob(u).then((b) => {
      if (!b) return;
      GIFS.set(u, b);
      if (gifTimer) return;
      gifTimer = setTimeout(() => { gifTimer = null; render(); }, 120);
    });
  }
  // Not a "tap to open" pill. Inside the container a link does not open, so
  // that pill invited a tap that could not work and hid the address while doing
  // it. If the image cannot be shown, the honest fallback is the thing that was
  // in the chirp all along: the link, as text.
  return `<a class="ext" href="${u}" target="_blank" rel="noopener noreferrer" data-url="${u}">${u}</a>`;
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
  | { k: 'home' } | { k: 'search' } | { k: 'notif' } | { k: 'saved' } | { k: 'stats' } | { k: 'probe' }
  | { k: 'profile'; mask: number } | { k: 'thread'; id: number }
  | { k: 'people'; mask: number; of: 'followers' | 'following' }
  | { k: 'lists' } | { k: 'list'; name: string };

let ME: Me | null = null;
let ALL: Post[] = [];
let FOLLOW = new Set<number>();
let PEOPLE: Who[] = [];
let NOTIF: Notice[] = [];
let PROF: Awaited<ReturnType<typeof profile>> | null = null;
let TH: Awaited<ReturnType<typeof thread>> = { parents: [], post: null, replies: [] };
/** Polls and pictures for what is on screen, filled in the background like faces. */
const POLLS_BY_CHIRP = new Map<number, Poll | null>();
const MEDIA_BY_CHIRP = new Map<number, { url: string; alt: string } | null>();
const pollWanted = new Set<number>();
const mediaWanted = new Set<number>();
/** Masks in a block relationship with me, so the feed can hide them. */
let BLOCKED = new Set<number>();
/** My own reply policy, for the settings pane to show what is set. */
let MYPOLICY = REPLY_EVERYONE;
/** Composer state for a poll being written alongside a chirp. */
let pollDraft: null | { options: string[]; minutes: number } = null;
/** A picture chosen in the composer, waiting for the chirp to exist. */
let mediaDraft: null | { bytes: Uint8Array; url: string; alt: string } = null;

let view: View = { k: 'home' };
let tab: 'foryou' | 'latest' | 'following' = 'foryou';
/** Which slice of a profile is showing. X splits a profile the same way. */
let ptab: 'chirps' | 'replies' | 'likes' = 'chirps';
let sheet: null | { mode: 'new' | 'reply' | 'quote' | 'edit'; target?: Post } = null;
let settingsOpen = false;
let menuFor: number | null = null;
/** Whose "add to list" chooser is open. */
let listFor: number | null = null;
/** Repost is two different acts — passing something on unchanged, and saying
 *  something about it. X puts both behind the same button, and so does this. */
let repostFor: number | null = null;
let query = '';
let flash: { text: string; bad?: boolean } | null = null;
/** How much of the feed is loaded. The chain has no cursor, so this is simply
 *  how far back from the newest chirp we have read. */
let page = 60;
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
/** Whether the host has a chat surface, and which chirps already have a room. */
let CHAT = false;
/** Whether preferences are held by the host rather than by this page. */
let DURABLE = false;
/** Whether a transaction is possible here — see chain.canSign. `null` until the
 *  first read comes back, and everything gated on it stays silent until then:
 *  the point is to stop guessing, not to guess the other way. */
let CAN_SIGN: boolean | null = null;
/** The container probe: findings so far, whether it is running, and what the
 *  real file input received when a finger tapped it. */
let PROBE: Finding[] = [];
/** The chirp the profile being viewed leads with, and its author. */
let PINNED = 0;
let probing = false;
let probeFile = '';
let ROOMS = new Set<number>();
/** A link the container refused to open, shown so it can at least be read. */
let linkFor: string | null = null;
/** Why the link pane is up: a refused navigation, or a refused clipboard write. */
let linkWhy: 'open' | 'copy' = 'open';
/** The GIF picker, and what it last said. */
let gifOpen = false;
/** Whether the picture panel in the composer is showing its three routes. */
let picOpen = false;
/** What the picture panel last said — an encode failure has to be visible. */
let picSaid: null | { text: string; bad?: boolean } = null;
let gifBound = false;
let gifSaid: { text: string; bad?: boolean } | null = null;

/**
 * What is currently in the composer.
 *
 * The whole column is rebuilt on every state change, and the textarea was
 * rendered from its ORIGIN — the draft for a new chirp, the old body for an
 * edit, and nothing at all for a reply or a quote. So any redraw while the
 * sheet was open silently wiped what had been typed: opening the GIF picker
 * did it, and so did anything else that called render(). Holding the text here
 * makes a redraw harmless.
 */
let sheetText = '';

/**
 * The earlier parts of a thread, in order, still unsent.
 *
 * A thread is not a new kind of object: it is chirps replying to each other,
 * which the contract has always been able to do. What it needs is composing
 * them together and sending them in order — so they are held here until the
 * whole thing is sent.
 */
let THREAD: string[] = [];
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
  set: (v: string) => keep(DRAFT, v),
};

/** The newest chirp id you have already seen in Notifications, so the bell can
 *  say how much is new. Kept locally: the chain has no read-state, and inventing
 *  one on chain would cost a transaction per glance. */
const SEEN = 'chirp.seen';
const seen = {
  get: () => { try { return Number(localStorage.getItem(SEEN) ?? 0); } catch { return 0; } },
  set: (v: number) => keep(SEEN, String(v)),
};
const unread = () => NOTIF.filter((p) => p.id > seen.get()).length;

/** Whether this device has been asked to push. Three states on purpose: not yet
 *  asked, said yes, said no — so a refusal is remembered and not asked again. */
const PUSH = 'chirp.push';
const push = {
  get: () => { try { return localStorage.getItem(PUSH) ?? ''; } catch { return ''; } },
  set: (v: 'on' | 'off') => keep(PUSH, v),
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
      keep(key, JSON.stringify([...set]));
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
  set: (v: number) => keep(PUSHED, String(v)),
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

/**
 * One chirp.
 *
 * `chain` — this post continues the one directly above it, by the same author.
 * `runs`  — the post directly below continues THIS one.
 *
 * Together they turn a self-thread into a single running column instead of a
 * stack of separate cards. A person writing five posts in a row was being drawn
 * as five strangers answering each other, each repeating "Replying to
 * @themselves", which is both noisy and untrue to what happened.
 */
function card(p: Post, big = false, chain = false, runs = false): string {
  const repost = p.quoteOf && !p.body;
  const shown = repost && p.quoted ? p.quoted : p;
  return `<article class="chirp${big ? ' big' : ''}${chain ? ' chain' : ''}${runs ? ' runs' : ''}" data-open="${p.id}">
    ${repost ? `<div class="ctx">${I.repost}<span>${esc(nm(p.who, p.mask))} reposted</span></div>` : ''}
    <div class="row">
      <div class="av" data-who="${shown.mask}">${avatar(shown.author, shown.mask)}</div>
      <div class="grow">
        ${p.replyTo && !big && !chain ? replyingTo(p) : ''}
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
        ${mediaStrip(shown.id, shown.mask)}
        ${pollStrip(shown.id)}
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


/* ------------------------------------------------------- polls and media */

/**
 * Fetch a poll or a picture once, in the background, and redraw when it lands.
 *
 * Same shape as wantPicture, and the same hard-won rule: a refused read is not
 * an answer. `pollOn` and `mediaOf` cache "there is none" themselves and return
 * null without caching when the chain would not say — so the latch here is
 * released on every null, and a real "no poll" costs one read per refresh cycle
 * rather than one per render.
 */
let extraTimer: ReturnType<typeof setTimeout> | null = null;
function redrawSoon() {
  if (extraTimer) return;
  extraTimer = setTimeout(() => { extraTimer = null; render(); }, 120);
}

function wantPoll(id: number) {
  if (pollWanted.has(id)) return;
  pollWanted.add(id);
  void pollOn(id).then((p) => {
    POLLS_BY_CHIRP.set(id, p);
    if (p) redrawSoon();
  }).catch(() => pollWanted.delete(id));
}

function wantMedia(id: number, author: number) {
  if (mediaWanted.has(id)) return;
  mediaWanted.add(id);
  void mediaOf(id, author).then((m) => {
    MEDIA_BY_CHIRP.set(id, m);
    if (m) redrawSoon();
  }).catch(() => mediaWanted.delete(id));
}

/** The picture on a chirp, once it has arrived. */
function mediaStrip(id: number, author: number): string {
  const m = MEDIA_BY_CHIRP.get(id);
  if (m === undefined) { wantMedia(id, author); return ''; }
  if (!m) return '';
  return `<div class="cmedia"><img src="${m.url}" alt="${esc(m.alt)}" loading="lazy">${
    m.alt ? `<div class="calt">${esc(m.alt)}</div>` : ''}</div>`;
}

/**
 * The poll on a chirp: the options while it is open, the result once it is not.
 *
 * The line under the bars is the whole point of putting this on a chain, so it
 * says so rather than being decoration. Anyone can add the votes up themselves.
 */
function pollStrip(id: number): string {
  const p = POLLS_BY_CHIRP.get(id);
  if (p === undefined) { wantPoll(id); return ''; }
  if (!p) return '';

  const total = p.total || 0;
  const closed = !p.open;
  const voted = p.mine > 0;
  const rows = p.options.map((o, i) => {
    const n = p.counts[i] ?? 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    const mine = p.mine === i + 1;
    // Show bars once you have voted or once it is closed — before that, seeing
    // the running score is how a poll turns into a bandwagon.
    return (voted || closed)
      ? `<div class="popt done${mine ? ' mine' : ''}">
           <div class="pbar" style="--p:${pct}%"></div>
           <span class="plabel">${esc(o)}${mine ? ' ✓' : ''}</span>
           <span class="ppct">${pct}%</span>
         </div>`
      : `<button class="popt" data-vote="${p.id}" data-chirp="${id}" data-opt="${i}">${esc(o)}</button>`;
  }).join('');

  const left = closed ? 'Final' : timeLeft(p.closesAt);
  return `<div class="poll" data-poll="${p.id}">
    ${rows}
    <div class="pfoot">${total} ${total === 1 ? 'vote' : 'votes'} · ${left}
      <span class="pwhy" title="Every vote is a row in the poll contract on Asset Hub. Anyone can add them up and get this number — including you.">recountable</span>
    </div>
  </div>`;
}

function timeLeft(closesAt: number): string {
  const s = closesAt - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'Final';
  if (s < 3600) return Math.ceil(s / 60) + 'm left';
  if (s < 86400) return Math.ceil(s / 3600) + 'h left';
  return Math.ceil(s / 86400) + 'd left';
}

/* ----------------------------------------------------------------- lists */

function listsView(): string {
  const all = lists();
  const rows = all.length
    ? all.map((l) => `<div class="lrow">
        <button class="lname" data-list="${esc(l.name)}">${esc(l.name)}</button>
        <span class="lcount">${l.masks.length} ${l.masks.length === 1 ? 'person' : 'people'}</span>
        <button class="ghost small" data-dellist="${esc(l.name)}">Delete</button>
      </div>`).join('')
    : '<div class="note">No lists yet. A list is a timeline of just the people you put in it.</div>';
  return `<div class="sechead">Your lists</div>
    ${rows}
    <div class="lnew">
      <input id="newlist" placeholder="Name a new list" maxlength="24" autocomplete="off">
      <button class="primary small" id="mklist">Create</button>
    </div>
    <div class="note small">Lists stay on this device. Everything else here is public on chain,
    and a list is an opinion about people who never agreed to be sorted — so it is the one thing
    that does not go on the chain. It rides the same host storage as your bookmarks, so a new
    version of chirp does not wipe it.</div>`;
}

function listView(): string {
  const name = view.k === 'list' ? view.name : '';
  const l = lists().find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!l) return '<div class="note">That list is gone.</div>';
  if (!l.masks.length) {
    return `<div class="sechead">${esc(l.name)}</div>
      <div class="note">Nobody in this list yet. Open somebody's profile and use “Add to list”.</div>`;
  }
  const inList = ALL.filter((p) => l.masks.includes(p.mask) && !p.deleted);
  return `<div class="sechead">${esc(l.name)} · ${l.masks.length} ${l.masks.length === 1 ? 'person' : 'people'}</div>`
    + list(inList, 'Nothing from this list in the timeline yet.');
}

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
  // A block hides them from your feed as well, in both directions — but note
  // that this is the same KIND of thing as a mute, not something stronger. On a
  // public chain nothing can stop them reading you; what a block does is
  // published on chain so every client applies it, where a mute is only ever
  // this device's business.
  const top = ALL.filter((p) => !p.replyTo && !muted.has(p.mask) && !BLOCKED.has(p.mask));
  // Following stays strictly chronological — that is the point of it, and X
  // breaking that promise is the complaint people actually have. For you is
  // ranked, and says so.
  // Three, not two. X has For you and Following, and Following is its
  // chronological tab — but it is empty until you follow somebody, so on a small
  // chain the only usable tab was the ranked one, and there was no way to just
  // see what was posted last. Latest is that way.
  const shown = tab === 'following'
    ? top.filter((p) => FOLLOW.has(p.mask))
    : tab === 'latest'
      ? top   // ALL is read newest-id-first, so this is already chronological
      : rank(top, FOLLOW, NOTED, signals());
  return `<div class="tabs">
      <button class="tab${tab === 'foryou' ? ' on' : ''}" data-tab="foryou">For you</button>
      <button class="tab${tab === 'latest' ? ' on' : ''}" data-tab="latest">Latest</button>
      <button class="tab${tab === 'following' ? ' on' : ''}" data-tab="following">Following</button>
    </div>`
    + (FRESH.length ? `<button class="fresh-btn" id="showfresh">Show ${FRESH.length} new chirp${FRESH.length > 1 ? 's' : ''}</button>` : '')
    + (ME && !ME.mask ? gate() : '')
    + list(shown, tab === 'following' ? 'Nothing here yet — follow someone from their profile.' : 'No chirps yet.')
    // `>= page` was the wrong test: a feed of exactly the window size looks
    // full whether or not anything is behind it, and once the contract had more
    // chirps than the window the older ones simply vanished with no way back.
    // The contract's own count is the truth, so ask it.
    + (TOTAL > ALL.length
      ? `<button class="more-btn" id="loadmore">Show older chirps — ${TOTAL - ALL.length} further back</button>`
      : '');
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
  if (!ME?.mask) {
    if (CAN_SIGN === null) return '<div class="note">Reading the chain…</div>';
    return `<div class="note">${CAN_SIGN
      ? 'Claim a mask to see your numbers.'
      : 'These are your own numbers, and they need an account that can sign. Open chirp in the Polkadot app, or connect a wallet here.'}</div>`;
  }
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

/**
 * What the container actually does.
 *
 * Not a feature — a way to stop guessing. Three limits were about to be
 * reported to Parity on the strength of symptoms whose causes turned out to be
 * ours, so each claim now has a test that produces evidence, and the report is
 * copyable so it can be pasted into an issue by whoever ran it.
 */
function probeView(): string {
  const rows = PROBE.map((f) => `<div class="prow2 ${f.result}">
      <span class="ptag">${f.result}</span>
      <div><div class="pwhat">${esc(f.what)}</div><div class="pdetail">${esc(f.detail)}</div></div>
    </div>`).join('');
  return `<div class="sechead">What this container actually does</div>
    <div class="note small">Every answer here is measured on this device, now. It exists because three
    limits were nearly reported to Parity on the strength of symptoms that turned out to have causes on
    our side — a key two bytes over a contract limit, a gas figure sized for a different kind of write.
    A bug report built on a guess wastes the time of whoever could fix the real one.</div>
    <div class="probebar">
      <button class="primary" id="runprobe" ${probing ? 'disabled' : ''}>${probing ? 'Running…' : 'Run the probe'}</button>
      ${PROBE.length ? '<button class="ghost" id="copyprobe">Copy the report</button>' : ''}
    </div>
    <div class="sechead">The one only a finger can answer</div>
    <div class="note small">Tap this. If a chooser opens, the file input works in this container; if
    nothing happens, it does not — and that is the finding, either way.</div>
    <div class="probebar"><input type="file" id="probefile" accept="image/*" class="filein"></div>
    ${probeFile ? `<div class="note small">Received: ${esc(probeFile)}</div>` : ''}
    ${rows}`;
}

/** The saved chirps. Kept on the device on purpose: a bookmark is a note to
 *  yourself, and putting it on a public chain would publish what you are
 *  quietly interested in to everybody, forever. */
function savedView(): string {
  const rows = ALL.filter((p) => marks.has(p.id));
  return `<div class="sechead">Bookmarks</div>`
    + list(rows, 'Nothing saved yet. Bookmark a chirp from its ⋯ menu.')
    + `<div class="note small">Bookmarks stay on this device. A chain would make them public, and what you
      save is nobody's business. ${DURABLE
        ? 'They are held by the Polkadot app rather than by this page, so a new version of chirp does not lose them.'
        : 'This browser holds them, so clearing its data clears these too.'}</div>`;
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
        <div><b>Get told when someone replies or names you</b>
        <span>chirp asks the Polkadot app to notify you. Nothing leaves the device but the alert.</span></div>
        <button class="primary" id="askpush">Turn on</button>
      </div>` : '';
  // Each one says which of the three it is. X does this, and it matters: being
  // replied to, being quoted and being named are three different things to a
  // reader, and an undifferentiated pile makes you open all of them to find out.
  const label: Record<string, string> = {
    reply: 'replied to you',
    quote: 'quoted you',
    mention: 'mentioned you',
  };
  const rows = NOTIF.length
    ? NOTIF.map((n) => `<div class="notice">
        <div class="why-line">${esc(nm(n.who, n.mask))} ${label[n.why]}</div>
        ${card(n)}
      </div>`).join('')
    : `<div class="note">${ME?.mask ? 'Nothing yet.'
        : CAN_SIGN !== false ? 'Claim a mask to be told about replies and mentions.'
        : 'Replies and mentions are addressed to a mask, and a mask needs an account that can sign. Open chirp in the Polkadot app, or connect a wallet here.'}</div>`;
  return offer + `<div class="sechead">Replies, quotes and mentions</div>` + rows;
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
      ${telegram ? `<a class="ext" href="https://t.me/${encodeURIComponent(telegram)}" target="_blank" rel="noopener noreferrer" data-url="https://t.me/${encodeURIComponent(telegram)}">✆ ${esc(telegram)}</a>` : ''}
      ${x ? `<a class="ext" href="https://x.com/${encodeURIComponent(x)}" target="_blank" rel="noopener noreferrer" data-url="https://x.com/${encodeURIComponent(x)}">𝕏 ${esc(x)}</a>` : ''}
      <span class="tier t${who.tier}">${TIERS[who.tier]}</span>
    </div>
    <div class="pstats">
      <a data-conn="followers" data-mask="${who.mask}"><b>${followers}</b> followers</a> ·
      <a data-conn="following" data-mask="${who.mask}"><b>${CONN.followingList.length}</b> following</a> ·
      <b>${posts.length}</b> chirps
      ${isMe && marks.size ? ` · <a id="gosaved"><b>${marks.size}</b> bookmarked</a>` : ''}
      ${isMe ? ' · <a id="gostats">your numbers</a>' : ''}
    </div>
  </section>`
    // The pinned chirp leads, marked, and is not repeated below — X shows it
    // once. If it has been deleted since it was pinned, nothing is shown rather
    // than an empty slot: the contract stores a number and cannot police it.
    + (() => {
      const p = PINNED ? ALL.find((x) => x.id === PINNED && !x.deleted) : undefined;
      return p ? `<div class="pinrow">${I.bookmark} Pinned</div>` + card(p) : '';
    })()
    // X splits a profile into Posts, Replies and Likes, and it matters here for
    // the same reason: someone who answers a lot has their own chirps buried
    // under their replies, and a visitor cannot tell what they actually say.
    + `<div class="tabs">
        <button class="tab${ptab === 'chirps' ? ' on' : ''}" data-ptab="chirps">Chirps</button>
        <button class="tab${ptab === 'replies' ? ' on' : ''}" data-ptab="replies">Replies</button>
        <button class="tab${ptab === 'likes' ? ' on' : ''}" data-ptab="likes">Likes</button>
      </div>`
    + (() => {
      if (ptab === 'replies') {
        const rows = posts.filter((p) => p.replyTo);
        return list(rows, 'No replies yet.');
      }
      if (ptab === 'likes') {
        // Only answerable for yourself: the contract stores likes by (account,
        // chirp), so reading somebody ELSE'S would mean walking every chirp and
        // asking about their address. Said plainly rather than shown empty.
        if (!isMe) return '<div class="note">Only you can see what you liked — the contract records a like against an account, and reading someone else\'s would mean asking about every chirp in turn.</div>';
        return list(ALL.filter((p) => p.liked), 'Nothing liked yet.');
      }
      return list(posts.filter((p) => !p.replyTo && p.id !== PINNED), 'No chirps yet.');
    })();
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

  /** Does this post have a continuation directly under it — its only reply, by
   *  the same person? That is a self-thread, not an exchange. */
  const runsOn = (p: Post): boolean => {
    const kids = byParent.get(p.id) ?? [];
    return kids.length === 1 && kids[0].mask === p.mask;
  };

  // A self-thread is drawn as one running column: no fresh indent, no repeated
  // "Replying to @yourself", and a rule down the avatar gutter joining the
  // posts. Written as separate cards it read as five strangers answering each
  // other — which is not what happened, and looked it.
  const branch = (id: number, depth: number, author: number): string =>
    (byParent.get(id) ?? []).map((r, _i, arr) => {
      const cont = arr.length === 1 && r.mask === author;
      return `<div class="branch${cont ? ' cont' : ''}" style="--d:${cont ? depth : Math.min(depth, 4)}">`
        + card(r, false, cont, runsOn(r))
        + `</div>` + branch(r.id, cont ? depth : depth + 1, r.mask);
    }).join('');
  // Quotes of this chirp. X puts them behind the repost count; here they are a
  // section, because on a small feed they ARE the conversation as often as the
  // replies are, and burying them made them invisible.
  const id = view.k === 'thread' ? view.id : 0;
  const quotes = ALL.filter((p) => p.quoteOf === id && p.body && !p.deleted);

  // The ancestors above the focused chirp are a chain by definition — each one
  // leads to the next — so every one of them carries the rule down, and any that
  // follows its own author drops the "Replying to".
  const above = TH.parents.map((p, i, a) => {
    const next: Post | undefined = a[i + 1] ?? TH.post ?? undefined;
    return card(p, false, i > 0 && a[i - 1].mask === p.mask, Boolean(next));
  }).join('');
  const last = TH.parents[TH.parents.length - 1];

  return above
    + (TH.post ? card(TH.post, true, false, runsOn(TH.post)) : '')
    + notesSection()
    + (quotes.length ? `<div class="sechead">Quotes</div>` + quotes.map((p) => card(p)).join('') : '')
    + (TH.post && runsOn(TH.post) ? '' : `<div class="sechead">Replies</div>`)
    + (byParent.get(id)?.length
      ? branch(id, 0, TH.post?.mask ?? last?.mask ?? -1)
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

/**
 * The invitation to claim a mask — shown only where claiming can actually work.
 *
 * Claiming is a transaction. Offered to somebody with nothing that can sign, it
 * is a button whose only possible outcome is an error, and it was the largest
 * thing on the screen for every reader arriving through the gateway. What they
 * need instead is to know that reading is all of it here, and where to go if
 * they want more.
 */
function gate(): string {
  if (CAN_SIGN === null) return '';        // not known yet — say nothing
  if (!CAN_SIGN) {
    return `<section class="gate">
      <h2>You are reading chirp</h2>
      <p>Everything here is public and needs nothing from you — no account, no wallet, no permission.
      Posting does: a chirp is a transaction, signed by an account that holds a mask.</p>
      <p class="hint">Open chirp in the Polkadot app to claim one, or connect a wallet extension in this
      browser. Either way the mask belongs to your account and cannot be transferred, so nobody can post
      as you.</p>
    </section>`;
  }
  // The optional field was read as "type your name here" and people typed their
  // People chain username — a `.01`. That is a different thing from a `.dot`,
  // the contract checks it against the .dot registry, and the check failing
  // takes the whole claim down with it. So: leave it empty is now the stated
  // default, the two names are told apart in as many words, and the handler
  // refuses to send a `.01` rather than spending somebody's transaction on it.
  return `<section class="gate">
    <h2>Claim your mask to post</h2>
    <p>A mask is bound to your account and cannot be transferred, so nobody can post as you.
    <b>Most people should leave the box below empty</b> and just claim — you can set your @ name
    afterwards in Settings.</p>
    <input id="dotlabel" placeholder="leave empty unless you own a .dot domain" autocomplete="off" spellcheck="false">
    <p class="hint">Only for a <b>.dot domain</b> you own, without the suffix — <code>alice</code>, not
    <code>alice.dot</code>. The contract checks it against the registry and that is what earns the tick.
    A name ending in <b>.01</b> is a People chain username, not a .dot: leave this empty and set it in
    Settings once you have a mask.</p>
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
    : view.k === 'saved' ? 'Bookmarks' : view.k === 'stats' ? 'Your numbers' : view.k === 'probe' ? 'Container probe'
    : view.k === 'lists' ? 'Lists' : view.k === 'list' ? view.name : 'chirp';
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
        <div class="pfpways">
          <!-- Paste leads, because it is the one that works here. The file
               chooser is the obvious control and a mobile container swallows
               it, so it is offered second and named as the fallback rather
               than sitting there looking like the way in. -->
          <div class="pasted" id="pastepfp" contenteditable="true" tabindex="0"
               aria-label="Paste a picture here">Copy an image, then paste it here</div>
          <label class="fileline">or choose a file
            <input type="file" id="pfpfile" accept="image/*" class="filein"></label>
          ${PIC.get(ME.mask) ? '<button class="ghost small" id="clearpfp">Remove picture</button>' : ''}
        </div>
      </div>
      ${pfpStep ? `<p class="hint ${pfpStep.bad ? 'bad' : ''}">${esc(pfpStep.text)}</p>` : ''}
      <p class="hint">Stored on Asset Hub, in the contract, as the image itself — not a link and not a
      key. It cannot expire, it survives clearing your browser, and every reader sees the same bytes.
      Squared and shrunk to ${FACE_PX}px here so it fits the ${(FACE_MAX / 1000).toFixed(0)} KB the
      contract accepts; you pay a small one-off deposit for the storage.</p>
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
      <label>Who can reply to you</label>
      <div class="row seg">
        ${[[REPLY_EVERYONE, 'Everyone'], [REPLY_FOLLOWING, 'People you follow'], [REPLY_MENTIONED, 'Only who you name']]
          .map(([v, l]) => `<button class="ghost small${MYPOLICY === v ? ' on' : ''}" data-policy="${v}">${l}</button>`).join('')}
      </div>
      <p class="hint">Published on chain, so every client reads the same rule and nobody — not us,
      not an operator — can change it but you. <b>It is not enforced by the chain.</b> The chirp
      contract was deployed before this existed and has no way to consult it, so somebody determined
      can still send a reply straight to it. This is a rule that can be audited, not one that can be
      bypassed silently: you can check for yourself whether it was respected.</p>
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

      <!-- The probe lives on a route, and inside the container there is no
           address bar to type one into. Without a way in from the interface it
           may as well not exist — which is what it was until somebody asked how
           to open it. -->
      <label>Diagnostics</label>
      <p class="hint">What this container actually allows — measured on this device. Worth running if
      something here fails silently: it produces a report you can paste into a bug report.</p>
      <button class="ghost wide" id="golists">Your lists</button>
      <button class="ghost wide" id="goprobe">Test what this app allows</button>
    </div></div>`;
  }
  if (linkFor) {
    // Two different failures share this pane, and it must not claim the wrong
    // one. `linkWhy` says which: a link the container would not open, or a
    // clipboard write that was refused — in which case telling somebody it is
    // "already on your clipboard" is precisely the lie this pane exists to stop.
    return `<div class="scrim" id="scrim"><div class="pane">
      <div class="panehead"><b>${linkWhy === 'copy' ? 'Copying was refused' : 'This app cannot open links'}</b><button class="iconbtn" id="linkclose">✕</button></div>
      <p class="hint">${linkWhy === 'copy'
        ? 'The container would not let the app write to your clipboard. Here is the text — select it and copy it by hand.'
        : 'The Polkadot app refused to hand this address to a browser, and a container has no second window of its own. Here it is.'}</p>
      <div class="linkbox">${esc(linkFor)}</div>
      <button class="primary wide" id="linkcopy">Try copying again</button>
    </div></div>`;
  }
  if (shareFor) {
    const p = findPost(shareFor);
    return `<div class="scrim" id="scrim"><div class="menu">
      ${CHAT ? `<button data-sh="chat">${ROOMS.has(shareFor) ? 'Open the conversation' : 'Discuss it in chat'}</button>` : ''}
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
  if (listFor) {
    const mine = listsWith(listFor);
    const all = lists();
    return `<div class="scrim" id="scrim"><div class="menu">
      <div class="menuhead">Add to a list</div>
      ${all.length
        ? all.map((l) => `<button data-addlist="${esc(l.name)}">${mine.includes(l.name) ? '✓ ' : ''}${esc(l.name)}</button>`).join('')
        : '<div class="note small">No lists yet — make one below.</div>'}
      <div class="lnew"><input id="quicklist" placeholder="New list name" maxlength="24" autocomplete="off">
        <button class="primary small" id="quickmk">Create &amp; add</button></div>
      <button data-addlist="">Cancel</button>
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
      ${mine ? `<button data-m="pin" data-id="${p.id}">${PINNED === p.id ? 'Unpin from your profile' : 'Pin to your profile'}</button>` : ''}
      ${ME?.mask ? `<button data-m="note" data-id="${p.id}">Add context</button>` : ''}
      <button data-m="who" data-id="${p.id}">View profile</button>
      ${mine ? '' : `<button data-m="mute" data-id="${p.id}">${muted.has(p.mask) ? 'Unmute' : 'Mute'} ${esc(at(p.who, p.mask))}</button>`}
      ${mine || !ME?.mask ? '' : `<button class="danger" data-m="block" data-id="${p.id}">${
        BLOCKED.has(p.mask) ? 'Unblock' : 'Block'} ${esc(at(p.who, p.mask))}</button>`}
      ${ME?.mask ? `<button data-m="tolist" data-id="${p.id}">Add to list…</button>` : ''}
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
    <!-- The parts of a thread already written, above the one being written.
         X shows them as a stack you can still edit; so does this, and each is
         its own chirp on chain the moment it is sent. -->
    ${THREAD.map((p, i) => `<div class="tpart">
      <span class="tpart-n">${i + 1}</span>
      <div class="tpart-b">${esc(p)}</div>
      <button class="iconbtn" data-tdrop="${i}" aria-label="Remove this part">✕</button>
    </div>`).join('')}
    <textarea id="stxt" maxlength="400" placeholder="${THREAD.length ? 'And then…' : sheet.mode === 'reply' ? 'Post your reply' : sheet.mode === 'quote' ? 'Add a comment' : "What's happening on chain?"}">${esc(sheetText)}</textarea>
    <div class="mentions" id="mbox" hidden role="listbox" aria-label="People"></div>
    <!-- The GIF button. A keyboard's GIF key inserts a link, but only some
         keyboards have one and none of them exist on a desktop — so there is a
         button that takes the link the way a person actually has it: copied. -->
    <div class="composebar">
      <button class="iconbtn gifbtn" id="gifopen" aria-label="Add a GIF" title="Add a GIF">GIF</button>
      <!-- A picture and a poll only make sense on something new. An edit cannot
           gain either: the chirp already exists, and a poll attached after
           people have replied changes what they were answering. -->
      ${sheet.mode === 'new' || sheet.mode === 'reply'
        ? `<button class="iconbtn gifbtn${mediaDraft ? ' on' : ''}" id="picopen" aria-label="Add a picture" title="Add a picture">IMG</button>
           <button class="iconbtn gifbtn${pollDraft ? ' on' : ''}" id="pollopen" aria-label="Add a poll" title="Add a poll">POLL</button>` : ''}
      ${sheet.mode !== 'edit'
        ? `<button class="iconbtn gifbtn" id="tadd" aria-label="Add another chirp to this thread" title="Add another">＋</button>` : ''}
      <span class="count" id="scount">280</span>
      <button class="primary" id="ssend">${sheet.mode === 'edit' ? 'Save'
        : THREAD.length ? `Post all ${THREAD.length + 1}`
        : title === 'New chirp' ? 'Chirp' : title}</button></div>
    ${gifOpen ? `<div class="gifpick">
      <p class="hint">Paste a Giphy link, or the direct image address of a GIF — the one a keyboard inserts, starting with media.tenor.com or i.giphy.com. Only the link is stored, so a GIF costs nothing on chain and nothing on Bulletin.
      Only the link is stored, so a GIF costs nothing on chain and nothing on Bulletin.</p>
      <input id="gifurl" placeholder="https://media.tenor.com/…" autocomplete="off" spellcheck="false">
      <div class="row">
        <button class="ghost small" id="gifpaste">Paste from clipboard</button>
        <button class="primary small" id="gifadd">Add it</button>
      </div>
      ${gifSaid ? `<p class="hint ${gifSaid.bad ? 'bad' : ''}">${esc(gifSaid.text)}</p>` : ''}
    </div>` : ''}
    <!-- Three routes to a picture, not one.
         The file chooser is the route most likely to do nothing at all in this
         container — that is a measured, reported limitation, not a guess — so it
         is offered LAST and never on its own. Pasting needs no permission and no
         chooser: the clipboard arrives with the paste event. This mirrors what
         already works for avatars in Settings; the composer only ever had the
         chooser, which is exactly why attaching a picture to a post did not
         work. You can also paste straight into the text box without opening
         this panel at all. -->
    ${picOpen && !mediaDraft ? `<div class="gifpick">
      <div class="pasted" id="pastepic" contenteditable="true" tabindex="0"
           aria-label="Paste or drop a picture here">Copy a picture, then paste it here — or drop one in</div>
      <label class="fileline">or choose a file
        <input type="file" id="picfile" accept="image/*" class="filein"></label>
      <p class="hint">Pasting works where a file chooser may not. You can also paste into the
      text box itself while writing.</p>
      ${picSaid ? `<p class="hint ${picSaid.bad ? 'bad' : ''}">${esc(picSaid.text)}</p>` : ''}
    </div>` : ''}
    ${mediaDraft ? `<div class="picdraft">
      <img src="${mediaDraft.url}" alt="">
      <input id="alttext" placeholder="Describe it, for people who cannot see it" maxlength="120" value="${esc(mediaDraft.alt)}">
      <button class="ghost small" id="picdrop">Remove picture</button>
      <p class="hint">The image itself goes into a contract, not a link to it — so it cannot expire
      and every reader gets the same bytes. It is resized to fit 24 kB before it is sent, and it is
      attached in a second transaction once the chirp exists.</p>
    </div>` : ''}
    ${pollDraft ? `<div class="polldraft">
      <div class="sechead small">Poll</div>
      ${pollDraft.options.map((o, i) => `<input class="popt-in" data-oi="${i}"
        placeholder="Option ${i + 1}" maxlength="40" value="${esc(o)}">`).join('')}
      <div class="row">
        ${pollDraft.options.length < 4 ? '<button class="ghost small" id="polladd">Add option</button>' : ''}
        <select id="polldur">
          ${[[60, '1 hour'], [360, '6 hours'], [1440, '1 day'], [4320, '3 days'], [10080, '1 week']]
            .map(([m, l]) => `<option value="${m}"${pollDraft!.minutes === m ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="ghost small" id="polldrop">Remove poll</button>
      </div>
      <p class="hint">Every vote is a row in a contract, so the result is one anybody can add up
      themselves — including you, and including someone who does not believe it. The poll is created
      in a second transaction once the chirp exists.</p>
    </div>` : ''}
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
  document.body.classList.toggle('locked', Boolean(sheet || settingsOpen || menuFor || confirmDelete || repostFor || listFor));

  const body = view.k === 'home' ? homeView()
    : view.k === 'saved' ? savedView()
    : view.k === 'stats' ? statsView()
    : view.k === 'probe' ? probeView()
    : view.k === 'search' ? searchView()
    : view.k === 'notif' ? notifView()
    : view.k === 'profile' ? profileView()
    : view.k === 'people' ? peopleView()
    : view.k === 'lists' ? listsView()
    : view.k === 'list' ? listView()
    : threadView();
  app.innerHTML = header()
    + (flash ? `<div class="msg ${flash.bad ? 'bad' : 'good'}" role="status" aria-live="polite">${esc(flash.text)}<button class="x-flash" id="dismiss" aria-label="Dismiss">✕</button></div>` : '')
    + (loadError ? `<div class="msg bad" role="alert">Could not read the chain — showing what was already loaded.
        <button class="link" id="retry">Try again</button></div>` : '')
    + `<main>${body}</main>`
    + `<footer class="foot">
        Every chirp — replies, quotes and reposts included — is a row in the
        <a class="ext" href="https://assethub-paseo.subscan.io/account/${CHIRP}" target="_blank" rel="noopener noreferrer" data-url="https://assethub-paseo.subscan.io/account/${CHIRP}">Chirp contract</a> on the devnet
        Asset Hub. You post as a <a class="ext" href="https://assethub-paseo.subscan.io/account/${MASKS}" target="_blank" rel="noopener noreferrer" data-url="https://assethub-paseo.subscan.io/account/${MASKS}">mask</a>
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

/**
 * Copy, and if the container refuses, SHOW the text instead of pretending.
 *
 * Every copy in this app used to be `clipboard.writeText(x).catch(() => {})`
 * followed by a cheerful "Copied." — which is a claim, made without looking, in
 * a container that may well have refused. Somebody then pastes nothing into a
 * message and has no idea why.
 *
 * `writeText` rejects when it is blocked, so the promise is actually awaited.
 * The old `execCommand('copy')` path is tried second because it still works in
 * some webviews where the async API is gated, and only when both fail does the
 * text go on screen to be selected by hand.
 */
async function copyOrShow(text: string, good = 'Copied.'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    flash = { text: good };
    return render();
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) { flash = { text: good }; return render(); }
  } catch { /* fall through */ }
  linkFor = text;
  linkWhy = 'copy';
  render();
}

/**
 * Run a write, and never leave somebody staring at a word.
 *
 * A tester reported this exactly: "it says to approve in wallet. The app has no
 * wallet tab, and there is no pop up to sign anything. What do I do?" The answer
 * was that the transaction has a two-minute timeout, so "Signing…" sat there
 * silently for two minutes and then failed with something unreadable. The app
 * knew nothing was happening and said nothing.
 *
 * So the message escalates on its own. After eight seconds without a sheet it
 * stops implying the person is being slow and says what is probably wrong and
 * what to try — which is the difference between a bug and a dead end.
 */
async function act(fn: () => Promise<{ ok: boolean; why?: string }>, good: string) {
  flash = { text: 'Signing… your wallet should ask you to approve this.' }; render();
  const nudge = setTimeout(() => {
    flash = {
      text: 'Still waiting for a signature. If no approval sheet has appeared, this host may not be '
        + 'able to raise one — close this, reopen chirp from the Polkadot app, and try once more.',
    };
    render();
  }, 8000);
  const r = await fn();
  clearTimeout(nudge);
  flash = r.ok ? { text: good } : { text: r.why ?? 'Failed', bad: true };
  await refresh();
}

/** The view as a URL, so the phone's back button walks the app instead of
 *  leaving it, and a thread can be linked to. */
function hashOf(v: View): string {
  return v.k === 'home' ? '#/' : v.k === 'search' ? '#/search'
    : v.k === 'notif' ? '#/notifications' : v.k === 'saved' ? '#/saved' : v.k === 'stats' ? '#/stats' : v.k === 'probe' ? '#/probe'
    : v.k === 'profile' ? '#/u/' + v.mask
    : v.k === 'people' ? '#/u/' + v.mask + '/' + v.of
    : v.k === 'lists' ? '#/lists'
    : v.k === 'list' ? '#/l/' + encodeURIComponent(v.name)
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
  if (h.startsWith('probe')) return { k: 'probe' };
  if (h.startsWith('lists')) return { k: 'lists' };
  if (h.startsWith('l/')) return { k: 'list', name: decodeURIComponent(h.slice(2)) };
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
  document.getElementById('fab')?.addEventListener('click', () => { sheet = { mode: 'new' }; sheetText = draft.get(); render(); });
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
    tab = b.dataset.tab as 'foryou' | 'latest' | 'following'; showFresh(false); render();
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
    // The single place the composer's text is remembered across redraws.
    stxt.addEventListener('input', () => { sheetText = stxt.value; });
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
      const parts = [...THREAD, v].filter(Boolean);
      sheet = null;
      if (s.mode === 'new') draft.set('');

      // A thread: several chirps, each replying to the one before. Signed one
      // at a time, because each is its own transaction — so the progress is
      // shown rather than leaving a person staring at a spinner through four
      // signature sheets.
      if (parts.length > 1) {
        THREAD = [];
        return act(async () => postThread(ME!.mask, parts, (done, total) => {
          flash = { text: `Posting ${done + 1} of ${total}…` };
          render();
        }), `Thread of ${parts.length} posted on chain.`);
      }

      if (s.mode === 'edit' && s.target) return act(() => edit(s.target!.id, v), 'Updated on chain.');

      // A poll and a picture need the chirp's id, which does not exist until
      // the chirp is on chain — so the post goes first, the id is found, and
      // each extra is its own transaction after it. Kept together here so the
      // reply and the new-chirp paths cannot drift apart.
      const withExtras = (base: string) => async () => {
        const r = await post(ME!.mask, v, s.mode === 'reply' && s.target ? s.target.id : 0, 0);
        if (!r.ok) { draft.set(v); return r; }
        if (!mediaDraft && !pollDraft) { flash = { text: base }; return r; }
        flash = { text: 'Posted. Attaching…' }; render();
        const id = await findMine(ME!.mask, v).catch(() => 0);
        if (!id) {
          mediaDraft = null; pollDraft = null;
          return { ok: true, why: '' } as { ok: boolean; why?: string };
        }
        const said = await attachExtras(id);
        flash = { text: base + (said.length ? ' — ' + said.join(', ') + '.' : '') };
        return r;
      };
      if (s.mode === 'reply' && s.target) return act(withExtras('Replied on chain.'), 'Replied on chain.');
      if (s.mode === 'quote' && s.target) return act(() => post(ME!.mask, v, 0, s.target!.id), 'Quoted on chain.');
      return act(withExtras('Posted on chain.'), 'Posted on chain.');
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
    const raw = ((document.getElementById('dotlabel') as HTMLInputElement)?.value ?? '').trim();
    // Refuse a People chain username here rather than spend the transaction on
    // it. The contract checks this against the .dot registry, so a `.01` does
    // not merely fail to earn a tick — it takes the whole claim down, and the
    // person is left with no mask and no idea why. Reported by a tester who read
    // the box as "type your name".
    const looksLikePeople = /\.\d{2}$/.test(raw);
    const hasOtherSuffix = raw.includes('.') && !/\.dot$/i.test(raw) && !looksLikePeople;
    if (looksLikePeople || hasOtherSuffix) {
      flash = {
        text: `"${raw}" is a People chain username, not a .dot domain — and the contract checks this `
          + 'box against the .dot registry, so it would refuse the whole claim. Clear the box, claim '
          + 'your mask, then set that name in Settings.',
        bad: true,
      };
      return render();
    }
    act(async () => { const r = await claimMask(raw); if (r.ok) ME = await me(); return r; }, 'Mask claimed — it is yours and cannot be moved.');
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
    if (what === 'quote') { sheet = { mode: 'quote', target: p }; sheetText = ''; return render(); }
    act(() => toggleRepost(p.id, ME!.mask), p.reposted ? 'Repost undone.' : 'Reposted.');
  }));
  app.querySelectorAll<HTMLElement>('[data-reply]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const p = findPost(Number(b.dataset.reply));
    if (!p) return;
    // Check the author's published rule BEFORE opening the composer. Letting
    // somebody write a reply and refusing it afterwards wastes their words; and
    // the check is stated as the author's choice, not as a failure of theirs.
    void mayReply(p, ME?.mask ?? 0).then((ok) => {
      if (!ok.ok) { flash = { text: ok.why, bad: true }; return render(); }
      sheet = { mode: 'reply', target: p };
      sheetText = '';
      render();
    });
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
      await copyOrShow(url, 'Link copied.');
    } else if (how === 'copytext') {
      await copyOrShow(`${text}\n${url}`, 'Chirp and link copied.');
    } else if (how === 'native') {
      // The webview may or may not have a share sheet. If it does not, this
      // throws and we say so rather than appearing to have done something.
      try {
        if (navigator.share) await navigator.share({ text, url });
        else await copyOrShow(url, 'No share sheet here — link copied instead.');
      } catch { /* dismissed by the person, which is not a failure */ }
    } else if (how === 'quote') {
      sheet = { mode: 'quote', target: p }; sheetText = '';
    } else if (how === 'chat') {
      // The chirp's own room, in the Polkadot app's chat. Note what this is not:
      // there is no way to address a person through the bridge, so this is a
      // conversation about a post, never a message to somebody.
      flash = { text: 'Opening the conversation…' }; render();
      const r = await discuss(p.id, `chirp: ${nm(p.who, p.mask)}`, `${text}\n${url}`);
      if (r.ok) {
        ROOMS.add(p.id);
        flash = { text: r.value === 'New' ? 'Room opened — it is in your chat.' : 'That conversation already exists — it is in your chat.' };
      } else {
        flash = { text: r.why, bad: true };
      }
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
    if (m === 'edit') { sheet = { mode: 'edit', target: p }; sheetText = p.body; return render(); }
    if (m === 'quote') { sheet = { mode: 'quote', target: p }; sheetText = ''; return render(); }
    if (m === 'del') { confirmDelete = p.id; return render(); }
    if (m === 'who') return goProfile(p.mask);
    if (m === 'why') { whyFor = whyFor === p.id ? null : p.id; return render(); }
    if (m === 'pin') {
      const on = PINNED === p.id;
      return act(async () => {
        const r = on ? await unpinChirp(ME!.mask) : await pinChirp(ME!.mask, p.id);
        if (r.ok) PINNED = on ? 0 : p.id;
        return r;
      }, on ? 'Unpinned.' : 'Pinned to your profile.');
    }
    if (m === 'mark') { marks.toggle(p.id); flash = { text: marks.has(p.id) ? 'Bookmarked on this device.' : 'Bookmark removed.' }; return render(); }
    if (m === 'mute') { muted.toggle(p.mask); flash = { text: muted.has(p.mask) ? 'Muted on this device.' : 'Unmuted.' }; return render(); }
    if (m === 'block') {
      const on = BLOCKED.has(p.mask);
      return act(async () => {
        const r = await setBlocked(ME!.mask, p.mask, !on);
        if (r.ok) { if (on) BLOCKED.delete(p.mask); else BLOCKED.add(p.mask); }
        return r;
      }, on ? 'Unblocked.' : 'Blocked. They can still read you — everything here is public — but conforming clients will not carry their replies to you.');
    }
    if (m === 'tolist') { listFor = p.mask; menuFor = null; return render(); }
    if (m === 'note') { noteSheet = { chirpId: p.id, kind: 0 }; return render(); }
    if (m === 'link') {
      void copyOrShow(`${location.origin}${location.pathname}#/t/${p.id}`, 'Link copied.'); return;
    }
    if (m === 'copy') { void copyOrShow(p.body); return; }
    if (m === 'chain') { void openUrl(`https://assethub-paseo.subscan.io/account/${CHIRP}`); return render(); }
    render();
  }));
  document.getElementById('showfresh')?.addEventListener('click', () => { showFresh(); render(); });
  app.querySelectorAll<HTMLElement>('[data-ptab]').forEach((b) => b.addEventListener('click', () => {
    ptab = b.dataset.ptab as 'chirps' | 'replies' | 'likes'; render();
  }));
  document.getElementById('goprobe')?.addEventListener('click', () => { settingsOpen = false; go({ k: 'probe' }); });
  document.getElementById('gosaved')?.addEventListener('click', () => go({ k: 'saved' }));
  bindExtras();

  /* ----------------------------------------------------------------- probe */
  document.getElementById('runprobe')?.addEventListener('click', async () => {
    PROBE = []; probing = true; render();
    await runProbe((f) => { PROBE = [...PROBE, f]; render(); }, ACT?.real ?? ACT?.signer ?? ME?.address ?? '').catch(() => undefined);
    probing = false; render();
  });
  document.getElementById('copyprobe')?.addEventListener('click', async () => {
    await copyOrShow(probeReport(PROBE, probeFile), 'Report copied.');
  });
  document.getElementById('probefile')?.addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    probeFile = f ? `${f.name}, ${f.size} bytes, ${f.type || 'no type'}` : 'the chooser closed with no file';
    render();
  });

  /* --------------------------------------------------------------- threads */
  document.getElementById('tadd')?.addEventListener('click', () => {
    const ta = document.getElementById('stxt') as HTMLTextAreaElement | null;
    const v = (ta?.value ?? '').trim();
    if (!v) return;
    THREAD.push(v);
    sheetText = '';           // the next part starts empty
    render();
    (document.getElementById('stxt') as HTMLTextAreaElement | null)?.focus();
  });
  app.querySelectorAll<HTMLElement>('[data-tdrop]').forEach((b) => b.addEventListener('click', () => {
    // Put it back in the box rather than deleting it — dropping a paragraph you
    // wrote should not destroy it.
    const i = Number(b.dataset.tdrop);
    const ta = document.getElementById('stxt') as HTMLTextAreaElement | null;
    const back = THREAD[i];
    THREAD.splice(i, 1);
    sheetText = ta?.value ? `${back}\n${ta.value}` : back;
    render();
  }));

  /* ------------------------------------------------------------------ gifs */
  // NOT bound to the element: bound to the document, once, matched by id on the
  // way up. Every other handler here is re-attached on each render, and if a
  // render ever lands between the tap and the attach — or the button is inside
  // a subtree that was replaced — the tap goes nowhere and the button looks
  // dead. Delegation cannot miss.
  if (!gifBound) {
    gifBound = true;
    document.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement | null)?.closest('#gifopen');
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      gifOpen = !gifOpen; gifSaid = null; render();
      (document.getElementById('gifurl') as HTMLInputElement | null)?.focus();
    });
  }
  document.getElementById('gifpaste')?.addEventListener('click', async () => {
    const el = document.getElementById('gifurl') as HTMLInputElement | null;
    try { if (el) el.value = await navigator.clipboard.readText(); }
    catch { gifSaid = { text: 'This app will not give the page the clipboard — paste into the field by hand.', bad: true }; }
    render();
  });
  document.getElementById('gifadd')?.addEventListener('click', () => {
    const el = document.getElementById('gifurl') as HTMLInputElement | null;
    const u = (el?.value ?? '').trim();
    if (!u) return;
    // Checked here rather than on send, so a link that will never render is
    // refused while it can still be replaced — not after the chirp is on chain.
    const kind = gifKind(u);
    if (kind !== 'image' && kind !== 'giphy-page') {
      // Said HERE, while the box is still open and the link can still be
      // swapped — not after the chirp is on chain and the picture is missing.
      gifSaid = {
        text: kind === 'tenor-page'
          ? 'That is a Tenor page, and Tenor will not serve the picture from one — we tried. Long-press the GIF and copy the image address instead: it starts with media.tenor.com.'
          : 'That is not a Tenor or Giphy link. Copy the GIF from their app or site and paste the link here.',
        bad: true,
      };
      const box = document.querySelector('.gifpick');
      if (box) {
        box.querySelector('.hint.bad')?.remove();
        const p = document.createElement('p');
        p.className = 'hint bad';
        p.textContent = gifSaid.text;
        box.appendChild(p);
      }
      return;
    }
    const ta = document.getElementById('stxt') as HTMLTextAreaElement | null;
    if (ta) {
      ta.value = (ta.value.trimEnd() + '\n' + u).trim();
      ta.dispatchEvent(new Event('input', { bubbles: true }));   // keep the counter and the draft honest
      ta.focus();
    }
    // Closed by hand, NOT by render(): a redraw rebuilds the textarea, and for a
    // reply or a quote it rebuilds it EMPTY — so calling render() here threw
    // away the link that had just been added, along with anything already typed.
    gifOpen = false; gifSaid = null;
    document.querySelector('.gifpick')?.remove();
  });
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
    const t = linkFor ?? ''; linkFor = null; await copyOrShow(t, 'Address copied.');
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
  if (view.k === 'profile') {
    PROF = await profile(view.mask, ALL).catch(() => PROF);
    PINNED = await pinnedOf(view.mask).catch(() => 0);
  }
  if (view.k === 'search' && !PEOPLE.length) PEOPLE = await people().catch(() => []);
  if (view.k === 'notif') {
    NOTIF = await notifications(ME?.mask ?? 0, ALL, ME ?? undefined).catch(() => NOTIF);
    if (NOTIF.length) seen.set(Math.max(seen.get(), ...NOTIF.map((p) => p.id)));
  } else if (ME?.mask) {
    NOTIF = await notifications(ME.mask, ALL, ME).catch(() => NOTIF); // keep the badge honest
  }
  await refreshNotes().catch(() => undefined);
  FOLLOWERS = await followerCounts().catch(() => FOLLOWERS);
  if (ME?.mask) FOLLOW = await following().catch(() => FOLLOW);
  // Re-ask only for what can actually have changed.
  //
  // The first cut cleared both caches wholesale every cycle, which on a
  // twenty-five chirp timeline is fifty extra reads every twenty seconds for
  // answers that were nearly all still "no poll, no picture". That is the read
  // amplification this app has spent its life removing, reintroduced by me.
  //
  // What genuinely changes: an OPEN poll's counts, because other people vote.
  // What does not: a closed poll, and a chirp that has neither — with one
  // exception, a chirp posted moments ago, because its author attaches the poll
  // and the picture in a second transaction just after it. So young chirps are
  // re-asked for a few minutes and everything else is left alone.
  const YOUNG = 5 * 60 * 1000;
  const now = Date.now();
  for (const p of ALL) {
    const poll = POLLS_BY_CHIRP.get(p.id);
    const young = now - p.time * 1000 < YOUNG;
    if (poll !== undefined && ((poll && poll.open) || (!poll && young))) {
      POLLS_BY_CHIRP.delete(p.id); pollWanted.delete(p.id); forgetPolls(p.id);
    }
    if (MEDIA_BY_CHIRP.get(p.id) === null && young) {
      MEDIA_BY_CHIRP.delete(p.id); mediaWanted.delete(p.id); forgetMedia(p.id);
    }
  }
  if (ME?.mask) await loadRules().catch(() => undefined);
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

/** The size the picture is stored at. 128 rather than 256: the largest place it
 *  is ever drawn is 64px, and the bytes are now paid for as chain storage. */
const FACE_PX = 128;

async function squareWebp(file: File, size = FACE_PX): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();

  // Step the quality down until it fits. A photograph at quality .85 can be
  // three times a drawing at the same setting, so a fixed number would take
  // some pictures and refuse others for no reason a person could see.
  //
  // Two thresholds, not one. The contract accepts FACE_MAX, but the weight a
  // transaction may use is capped by the chain, and a write near the contract's
  // limit runs close to that ceiling — which is how the first attempt met
  // Revive.OutOfGas. So aim for COMFORT first and only accept the contract's
  // limit if nothing smaller can be had.
  const COMFORT = 6000;
  let last: Uint8Array | null = null;
  for (const q of [0.62, 0.5, 0.4, 0.3, 0.22]) {
    const blob: Blob = await new Promise((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/webp', q));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length <= COMFORT) return bytes;
    last = bytes;
  }
  if (last && last.length <= FACE_MAX) return last;
  throw new Error('too detailed to fit');
}

/**
 * My reply policy, and which of the masks on screen are in a block with me.
 *
 * Asked only for masks that are actually in the timeline: the contract has no
 * "list everyone I blocked" read, and adding one would have meant publishing an
 * enumerable enemies list, which is worse than the extra reads. Blocks are rare,
 * so `blockCount` is checked first and the per-mask walk is skipped entirely
 * when it is zero — which for almost everybody it is.
 */
async function loadRules() {
  if (!ME?.mask) return;
  forgetRules();
  const mine = await rulesFor(ME.mask).catch(() => ({ policy: REPLY_EVERYONE, blocks: 0 }));
  MYPOLICY = mine.policy;
  if (!mine.blocks) { BLOCKED = new Set(); return; }
  const seenMasks = [...new Set(ALL.map((p) => p.mask))].filter((m) => m && m !== ME!.mask);
  const hits = await Promise.all(seenMasks.map(async (m) => ((await isBlocked(ME!.mask, m)) ? m : 0)));
  BLOCKED = new Set(hits.filter(Boolean));
}

/** Re-read the notes for whatever is on screen. Kept apart from refresh() so a
 *  rating does not also re-fetch the entire timeline. */
async function refreshNotes() {
  NOTED = await notedChirps().catch(() => NOTED);
  if (view.k === 'thread') THNOTES = await notesOn(view.id).catch(() => THNOTES);
}


/**
 * A picture for a chirp: wider than an avatar, and to a harder ceiling.
 *
 * Not square, because a photograph cropped to a square to fit a contract is a
 * photograph the app damaged. Fitted inside 640px instead, keeping its shape.
 *
 * The same two-threshold rule as squareWebp, for the same reason: the contract
 * takes MEDIA_MAX, but a write near a contract's limit runs close to the
 * chain's per-transaction weight ceiling, and that is how the avatar write met
 * Revive.OutOfGas the first time. Aim well under, accept the limit only if
 * nothing smaller can be had.
 */
async function fitWebp(file: File, maxSide = 640): Promise<{ bytes: Uint8Array; url: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const COMFORT = 18_000;
  let last: Uint8Array | null = null;
  for (const q of [0.72, 0.6, 0.5, 0.4, 0.3, 0.22]) {
    const blob: Blob = await new Promise((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/webp', q));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length <= COMFORT) return { bytes, url: URL.createObjectURL(blob) };
    last = bytes;
  }
  if (last && last.length <= MEDIA_MAX) {
    return { bytes: last, url: URL.createObjectURL(new Blob([last as BlobPart], { type: 'image/webp' })) };
  }
  throw new Error('too detailed to fit');
}

/**
 * Everything the composer promised but could not send until the chirp existed.
 *
 * A poll and a picture both reference a chirp id, and the id only exists once
 * the chirp is on chain — so they are separate transactions, deliberately, and
 * they run after. If one fails the chirp still stands: losing the post because
 * its picture would not encode would be the worse outcome by far, so each is
 * reported on its own rather than rolling anything back.
 */
async function attachExtras(chirpId: number): Promise<string[]> {
  const said: string[] = [];
  if (!chirpId || !ME?.mask) return said;
  if (mediaDraft) {
    const alt = (document.getElementById('alttext') as HTMLInputElement | null)?.value ?? mediaDraft.alt;
    const r = await attachMedia(chirpId, ME.mask, mediaDraft.bytes, alt).catch(() => ({ ok: false, why: 'the picture did not attach' } as const));
    said.push(r.ok ? 'picture attached' : 'picture failed: ' + (('why' in r && r.why) || ''));
    if (r.ok) MEDIA_BY_CHIRP.delete(chirpId);
  }
  if (pollDraft) {
    const opts = [...document.querySelectorAll<HTMLInputElement>('.popt-in')].map((i) => i.value);
    const mins = Number((document.getElementById('polldur') as HTMLSelectElement | null)?.value ?? pollDraft.minutes);
    const r = await createPoll(chirpId, ME.mask, opts.length ? opts : pollDraft.options, mins)
      .catch(() => ({ ok: false, why: 'the poll was not created' } as const));
    said.push(r.ok ? 'poll created' : 'poll failed: ' + (('why' in r && r.why) || ''));
    if (r.ok) { POLLS_BY_CHIRP.delete(chirpId); pollWanted.delete(chirpId); }
  }
  mediaDraft = null;
  pollDraft = null;
  return said;
}

/** Wire the controls added for polls, pictures, lists and rules. Called from
 *  the same place every other listener is bound, after each render. */
function bindExtras() {
  /* ------------------------------------------------------------- voting */
  app.querySelectorAll<HTMLElement>('[data-vote]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();                       // the card underneath opens the thread
    if (!ME?.mask) { flash = { text: 'Claim a mask to vote.', bad: true }; return render(); }
    const pollId = Number(b.dataset.vote);
    const chirpId = Number(b.dataset.chirp);
    const opt = Number(b.dataset.opt);
    void act(async () => {
      const r = await votePoll(pollId, chirpId, opt);
      if (r.ok) { POLLS_BY_CHIRP.delete(chirpId); pollWanted.delete(chirpId); }
      return r;
    }, 'Voted. Anyone can recount it.');
  }));

  /* ------------------------------------------------------ composer: poll */
  document.getElementById('pollopen')?.addEventListener('click', () => {
    pollDraft = pollDraft ? null : { options: ['', ''], minutes: 1440 };
    render();
  });
  document.getElementById('polladd')?.addEventListener('click', () => {
    if (pollDraft && pollDraft.options.length < 4) {
      pollDraft.options = [...document.querySelectorAll<HTMLInputElement>('.popt-in')].map((i) => i.value);
      pollDraft.options.push('');
      render();
    }
  });
  document.getElementById('polldrop')?.addEventListener('click', () => { pollDraft = null; render(); });
  // Keep what has been typed: the pane is re-rendered from state, so without
  // this every keystroke elsewhere would wipe the options.
  app.querySelectorAll<HTMLInputElement>('.popt-in').forEach((i) => i.addEventListener('input', () => {
    if (pollDraft) pollDraft.options[Number(i.dataset.oi)] = i.value;
  }));
  document.getElementById('polldur')?.addEventListener('change', (e) => {
    if (pollDraft) pollDraft.minutes = Number((e.target as HTMLSelectElement).value);
  });

  /* --------------------------------------------------- composer: picture */
  //
  // The first cut fired a synthetic file chooser and nothing else. In this
  // container a file input may accept the element and never open anything —
  // measured, and reported to Parity — so that single route is the one most
  // likely to fail, and attaching a picture to a post simply did not work.
  // Avatars already had the answer: paste. It needs no chooser and no
  // permission, because the bytes ride in on the paste event.
  const usePicked = async (f: File | null | undefined) => {
    if (!f) { picSaid = { text: 'Nothing there looked like an image.', bad: true }; return render(); }
    picSaid = { text: 'Resizing…' }; render();
    try {
      const fit = await fitWebp(f);
      mediaDraft = { bytes: fit.bytes, url: fit.url, alt: '' };
      picOpen = false;
      picSaid = null;
      flash = { text: `Picture ready — ${Math.round(fit.bytes.length / 1000)} kB. It is attached after the chirp.` };
    } catch {
      picSaid = { text: 'That picture could not be shrunk enough to fit 24 kB. Try a smaller one.', bad: true };
    }
    render();
  };
  const fromClipboard = (e: ClipboardEvent) => {
    const items = [...(e.clipboardData?.items ?? [])];
    const img = items.find((i) => i.type.startsWith('image/'));
    if (!img) return null;
    e.preventDefault();
    return img.getAsFile();
  };

  document.getElementById('picopen')?.addEventListener('click', () => {
    if (mediaDraft) { mediaDraft = null; return render(); }   // pressing it again removes
    picOpen = !picOpen; picSaid = null; render();
  });
  document.getElementById('pastepic')?.addEventListener('paste', (e) => {
    const f = fromClipboard(e as ClipboardEvent);
    void usePicked(f);
  });
  document.getElementById('picfile')?.addEventListener('change', (e) => {
    void usePicked((e.target as HTMLInputElement).files?.[0]);
  });
  // Drop, for a desktop. Cheap to add and it is the other gesture people try.
  const drop = document.getElementById('pastepic');
  drop?.addEventListener('dragover', (e) => { e.preventDefault(); });
  drop?.addEventListener('drop', (e) => {
    e.preventDefault();
    void usePicked((e as DragEvent).dataTransfer?.files?.[0]);
  });
  // And the one people actually do: paste while writing, without opening
  // anything. A paste that is not an image falls through to the textarea
  // untouched, so this cannot break typing.
  document.getElementById('stxt')?.addEventListener('paste', (e) => {
    if (!(sheet?.mode === 'new' || sheet?.mode === 'reply')) return;
    const f = fromClipboard(e as ClipboardEvent);
    if (f) void usePicked(f);
  });
  document.getElementById('picdrop')?.addEventListener('click', () => { mediaDraft = null; render(); });
  document.getElementById('alttext')?.addEventListener('input', (e) => {
    if (mediaDraft) mediaDraft.alt = (e.target as HTMLInputElement).value;
  });

  /* ------------------------------------------------------------- rules */
  app.querySelectorAll<HTMLElement>('[data-policy]').forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.policy);
    if (!ME?.mask) return;
    void act(async () => {
      const r = await setReplyPolicy(ME!.mask, v);
      if (r.ok) MYPOLICY = v;
      return r;
    }, 'Rule published on chain.');
  }));

  /* ------------------------------------------------------------- lists */
  app.querySelectorAll<HTMLElement>('[data-addlist]').forEach((b) => b.addEventListener('click', () => {
    const name = b.dataset.addlist ?? '';
    if (name && listFor) {
      const now = toggleInList(name, listFor);
      flash = { text: now ? `Added to ${name}.` : `Removed from ${name}.` };
    }
    listFor = null;
    render();
  }));
  document.getElementById('quickmk')?.addEventListener('click', () => {
    const v = (document.getElementById('quicklist') as HTMLInputElement | null)?.value ?? '';
    if (v.trim() && listFor) {
      createList(v);
      toggleInList(v.trim(), listFor);
      flash = { text: `Added to ${v.trim()}.` };
    }
    listFor = null;
    render();
  });
  document.getElementById('mklist')?.addEventListener('click', () => {
    const v = (document.getElementById('newlist') as HTMLInputElement | null)?.value ?? '';
    if (v.trim()) { createList(v); flash = { text: 'List created.' }; }
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-dellist]').forEach((b) => b.addEventListener('click', () => {
    removeList(b.dataset.dellist ?? '');
    flash = { text: 'List deleted.' };
    render();
  }));
  app.querySelectorAll<HTMLElement>('[data-list]').forEach((b) => b.addEventListener('click', () => {
    go({ k: 'list', name: b.dataset.list ?? '' });
  }));
  document.getElementById('golists')?.addEventListener('click', () => { settingsOpen = false; go({ k: 'lists' }); });
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
  if (ME?.mask) { NOTIF = await notifications(ME.mask, fresh, ME).catch(() => NOTIF); await announce(); }
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
    : `${fresh.length} new replies, quotes and mentions on chirp`;
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
    sheet = null; THREAD = []; settingsOpen = false; menuFor = null; confirmDelete = null; repostFor = null; listFor = null; render();
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
// Pull anything the HOST is holding into this origin before the first render
// reads it. A new bundle is a new content hash and, in most containers, a new
// origin with empty storage — so without this every publish silently reset
// everyone's bookmarks, mutes and notification watermark.
void hydrate().then(() => render());
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
  // AFTER the first read, not before: whether a transaction is possible here is
  // partly answered by whether that read worked, and asking early gets the
  // gateway's optimistic "yes". Until this line runs CAN_SIGN is null, and the
  // things it gates render nothing rather than guess.
  CAN_SIGN = await canSign().catch(() => false);
  // Go through refresh() rather than loading the feed by hand: a deep link — a
  // shared thread, someone's profile — has to arrive with ITS data, not with an
  // empty shell and a timeline nobody asked for.
  await refresh();
  // Push your picture's retention window back. Content-addressed, so the same
  // bytes give the same key and the contract still points at it: no transaction,
  // no chain write, and it is the whole reason a picture survives at all.
  if (ME?.mask) void renewPicture(ME.mask);
  // Whether the chat bridge exists is a host question, asked once. If it does,
  // find out which chirps already have a room — an app that offers to "start"
  // a conversation that is already running is not paying attention.
  DURABLE = await durable().catch(() => false);
  CHAT = await chatAvailable().catch(() => false);
  if (CHAT) {
    ROOMS = await chatRooms().catch(() => ROOMS); render();
    // Stand up in the chat as a participant, and answer what can be answered
    // without a key. A command that WRITES is handed back here, because the
    // signature has to come from the app — the chat has no key of its own.
    if (await registerBot().catch(() => false)) {
      void serveBot((ask) => {
        sheet = { mode: 'new' };
        sheetText = ask.text;
        flash = { text: 'From the chat — check it and sign.' };
        render();
      }).catch(() => undefined);
    }
  }
})();
