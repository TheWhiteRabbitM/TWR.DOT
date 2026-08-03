/**
 * chirp — a microblog that lives in a contract, with the conversation on chain.
 *
 * The first cut was a wall of posts nobody could answer. This one has the acts
 * that make a timeline a timeline: reply, repost, quote, share, delete, follow,
 * and a thread you can open. Every one of them is a contract call — there is no
 * server holding any of it.
 *
 * Names: the bold name is what you chose in settings (free text, like X), the
 * grey handle is your `.dot` if the contract verified it against the registry —
 * and only that earns a tick — otherwise the mask number, which cannot be faked
 * because a mask is bound to its account.
 */
import './style.css';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  warmUp, me, feed, thread, post, edit, remove, toggleLike, toggleRepost, toggleFollow,
  isFollowing, claimMask, saveProfile, suggestedName, forgetWho,
  CHIRP, MASKS, type Post, type Me,
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
  const round = 6 + n(1n, 6n), visorY = 17 + n(7n, 4n), eye = n(13n, 3n);
  const W = 'rgba(255,255,255,.95)';
  const visor = eye === 0
    ? `<rect x="13" y="${visorY}" width="14" height="2.4" rx="1.2" fill="${W}"/>`
    : eye === 1
      ? `<circle cx="15.5" cy="${visorY + 1}" r="1.7" fill="${W}"/><circle cx="24.5" cy="${visorY + 1}" r="1.7" fill="${W}"/>`
      : `<rect x="13" y="${visorY}" width="6" height="2.4" rx="1.2" fill="${W}"/><rect x="21" y="${visorY}" width="6" height="2.4" rx="1.2" fill="${W}"/>`;
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
const nameOf = (p: Post) => p.who?.name || (p.who?.verified ? p.who.verified + '.dot' : 'mask #' + p.mask);
const handleOf = (p: Post) => (p.who?.verified ? '@' + p.who.verified + '.dot' : '@mask' + p.mask);

const TICK = `<svg class="tick" viewBox="0 0 24 24" fill="currentColor"><path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg>`;
const I = {
  reply: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/></svg>`,
  repost: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  like: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>`,
  more: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`,
};

/* ------------------------------------------------------------------- state */
let ME: Me | null = null;
let LIST: Post[] = [];
let view: { kind: 'feed' } | { kind: 'thread'; id: number } = { kind: 'feed' };
let THREAD: { parents: Post[]; post: Post | null; replies: Post[] } = { parents: [], post: null, replies: [] };
let sheet: null | { mode: 'reply' | 'quote' | 'edit'; target: Post } = null;
let settingsOpen = false;
let flash: { text: string; bad?: boolean } | null = null;

/* -------------------------------------------------------------------- views */

function card(p: Post, opts: { big?: boolean; inThread?: boolean } = {}): string {
  const mine = ME && p.author.toLowerCase() === ME.address.toLowerCase();
  const repost = p.quoteOf && !p.body;      // passed on unchanged
  const quoted = p.quoted;
  return `<article class="chirp${opts.big ? ' big' : ''}" data-open="${p.id}">
    ${repost ? `<div class="ctx">${I.repost}<span>${esc(nameOf(p))} reposted</span></div>` : ''}
    <div class="row">
      <div class="av">${avatar(repost && quoted ? quoted.author : p.author)}</div>
      <div class="grow">
        <div class="head">
          <span class="nm">${esc(repost && quoted ? nameOf(quoted) : nameOf(p))}</span>${(repost && quoted ? quoted : p).who?.verified ? TICK : ''}
          <span class="at">${esc(repost && quoted ? handleOf(quoted) : handleOf(p))}</span>
          <span class="dot">·</span><span class="ts">${ago(p.time)}</span>
          ${p.edited ? '<span class="edited">· edited</span>' : ''}
          <button class="more" data-more="${p.id}" aria-label="More">${I.more}</button>
        </div>
        <div class="body">${esc(repost && quoted ? quoted.body : p.body)}</div>
        ${!repost && quoted ? `<div class="quoted">
            <div class="head"><span class="nm">${esc(nameOf(quoted))}</span>${quoted.who?.verified ? TICK : ''}
            <span class="at">${esc(handleOf(quoted))}</span><span class="dot">·</span><span class="ts">${ago(quoted.time)}</span></div>
            <div class="body">${esc(quoted.body)}</div>
          </div>` : ''}
        <div class="acts">
          <button class="act reply" data-reply="${p.id}">${I.reply}<span>${p.replies || ''}</span></button>
          <button class="act rep${p.reposted ? ' on' : ''}" data-repost="${p.id}">${I.repost}<span>${p.reposts || ''}</span></button>
          <button class="act like${p.liked ? ' on' : ''}" data-like="${p.id}">${I.like}<span>${p.likes || ''}</span></button>
          <button class="act share" data-share="${p.id}">${I.share}</button>
        </div>
      </div>
    </div>
    ${mine ? '' : ''}
  </article>`;
}

function composer(): string {
  if (!ME) return '';
  if (!ME.mask) {
    return `<section class="gate">
      <h2>Claim your mask to post</h2>
      <p>A mask is bound to your account and cannot be transferred, so nobody can post as you.
      Own a <b>.dot</b>? Put the label in and the contract checks it against the registry — that is what earns a tick.</p>
      <input id="dotlabel" placeholder="your .dot label, without the suffix (optional)" autocomplete="off" spellcheck="false">
      <button class="primary" id="claim">Claim my mask</button>
    </section>`;
  }
  return `<section class="compose">
    <div class="av">${avatar(ME.address)}</div>
    <div class="grow">
      <textarea id="txt" maxlength="400" placeholder="What's happening on chain?"></textarea>
      <div class="composebar"><span class="count" id="count">280</span>
        <button class="primary" id="send" disabled>Chirp</button></div>
    </div>
  </section>`;
}

function header(): string {
  const back = view.kind === 'thread' ? `<button class="iconbtn" id="back" aria-label="Back">${I.back}</button>` : '';
  const who = !ME
    ? '<span>open in the Polkadot app</span>'
    : `<b>${ME.mask ? esc(ME.name || (ME.verified ? ME.verified + '.dot' : 'mask #' + ME.mask)) : 'no mask yet'}</b><span>${esc(short(ME.address))}</span>`;
  return `<header class="top">
    ${back}<h1>${view.kind === 'thread' ? 'Thread' : 'chirp'}</h1>
    ${ME?.mask ? `<span class="tier t${ME.tier}">${TIERS[ME.tier]}</span>` : ''}
    <div class="who">${who}</div>
    ${ME?.mask ? `<button class="iconbtn" id="settings" aria-label="Settings">${I.gear}</button>` : ''}
  </header>`;
}

function sheetView(): string {
  if (settingsOpen) {
    const m = ME!;
    return `<div class="scrim" id="scrim"><div class="pane">
      <div class="panehead"><b>Settings</b><button class="iconbtn" id="closepane">✕</button></div>
      <label>Public name</label>
      <input id="s_name" maxlength="40" value="${esc(m.name)}" placeholder="the name people see">
      <button class="link" id="usepeople">use my People chain username</button>
      <label>.dot ${m.verified ? '<span class="okmark">verified ✓</span>' : ''}</label>
      ${m.verified
        ? `<input value="${esc(m.verified)}.dot" disabled>`
        : `<input id="s_dot" placeholder="claimed at mask time only" disabled>
           <p class="hint">A .dot is checked when you claim your mask, and that check is what earns the tick — it cannot be added later.</p>`}
      <label>Telegram</label><input id="s_tg" maxlength="32" value="${esc(m.telegram)}" placeholder="handle, without @">
      <label>X</label><input id="s_x" maxlength="32" value="${esc(m.x)}" placeholder="handle, without @">
      <label>Bio</label><input id="s_bio" maxlength="160" value="${esc(m.bio)}" placeholder="one line about you">
      <button class="primary wide" id="savep">Save on chain</button>
      <p class="hint">The name is yours to choose and proves nothing — that is why the tick is reserved for the .dot the contract verified.</p>
    </div></div>`;
  }
  if (!sheet) return '';
  const t = sheet.target;
  const title = sheet.mode === 'reply' ? 'Reply' : sheet.mode === 'quote' ? 'Quote' : 'Edit';
  return `<div class="scrim" id="scrim"><div class="pane">
    <div class="panehead"><b>${title}</b><button class="iconbtn" id="closepane">✕</button></div>
    ${sheet.mode !== 'edit' ? `<div class="quoted">
      <div class="head"><span class="nm">${esc(nameOf(t))}</span><span class="at">${esc(handleOf(t))}</span></div>
      <div class="body">${esc(t.body)}</div></div>` : ''}
    <textarea id="stxt" maxlength="400" placeholder="${sheet.mode === 'reply' ? 'Post your reply' : sheet.mode === 'quote' ? 'Add a comment' : 'Rewrite your chirp'}">${sheet.mode === 'edit' ? esc(t.body) : ''}</textarea>
    <div class="composebar"><span class="count" id="scount">280</span>
      <button class="primary" id="ssend">${title}</button></div>
  </div></div>`;
}

function menuView(id: number, p: Post): string {
  const mine = ME && p.author.toLowerCase() === ME.address.toLowerCase();
  return `<div class="scrim" id="scrim"><div class="menu">
    ${mine ? `<button data-m="edit" data-id="${id}">Edit chirp</button>
              <button class="danger" data-m="del" data-id="${id}">Delete chirp</button>` : ''}
    <button data-m="quote" data-id="${id}">Quote</button>
    <button data-m="follow" data-id="${id}">${followLabel} ${esc(nameOf(p))}</button>
    <button data-m="copy" data-id="${id}">Copy text</button>
    <button data-m="chain" data-id="${id}">View contract</button>
    <button data-m="close">Cancel</button>
  </div></div>`;
}
let menuFor: number | null = null;
let followLabel = 'Follow';

function render() {
  const body = view.kind === 'feed'
    ? composer() + (LIST.length ? LIST.map((p) => card(p)).join('') : '<div class="note">No chirps yet.</div>')
    : THREAD.parents.map((p) => card(p)).join('')
      + (THREAD.post ? card(THREAD.post, { big: true }) : '')
      + (THREAD.replies.length ? THREAD.replies.map((p) => card(p)).join('') : '<div class="note">No replies yet.</div>');

  const menuPost = menuFor ? [...LIST, ...THREAD.replies, ...THREAD.parents, THREAD.post].find((x) => x && x.id === menuFor) : null;

  app.innerHTML = header()
    + (flash ? `<div class="msg ${flash.bad ? 'bad' : 'good'}">${esc(flash.text)}</div>` : '')
    + body
    + `<footer class="foot">
        Every chirp is a row in the <a href="https://assethub-paseo.subscan.io/account/${CHIRP}" target="_blank" rel="noopener">Chirp contract</a>
        on the devnet Asset Hub — replies, quotes and reposts included. You post as a
        <a href="https://assethub-paseo.subscan.io/account/${MASKS}" target="_blank" rel="noopener">mask</a> bound to your account and
        non-transferable, so a chirp can only come from its author. The name is yours to pick; the tick means the contract
        checked that <code>.dot</code> against the registry.
        <span style="display:block;margin-top:10px;opacity:.6">build ${esc(__BUILD__)}</span>
      </footer>`
    + (menuPost ? menuView(menuPost.id, menuPost) : sheetView());
  wire();
}

/* ------------------------------------------------------------------- wiring */

function countWatch(ta: HTMLTextAreaElement, out: HTMLElement, btn: HTMLButtonElement, allowEmpty = false) {
  const sync = () => {
    const n = 280 - ta.value.length;
    out.textContent = String(n);
    out.className = 'count' + (n < 0 ? ' over' : n <= 20 ? ' warn' : '');
    btn.disabled = (!allowEmpty && ta.value.trim().length === 0) || n < 0;
  };
  ta.addEventListener('input', sync); sync(); ta.focus();
}

async function act(fn: () => Promise<{ ok: boolean; why?: string }>, good: string) {
  flash = { text: 'Signing…' }; render();
  const r = await fn();
  flash = r.ok ? { text: good } : { text: r.why ?? 'Failed', bad: true };
  await refresh();
}

function wire() {
  document.getElementById('back')?.addEventListener('click', () => { view = { kind: 'feed' }; refresh(); });
  document.getElementById('settings')?.addEventListener('click', () => { settingsOpen = true; render(); });
  document.getElementById('closepane')?.addEventListener('click', () => { settingsOpen = false; sheet = null; menuFor = null; render(); });
  document.getElementById('scrim')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('scrim')) { settingsOpen = false; sheet = null; menuFor = null; render(); }
  });

  // compose
  const txt = document.getElementById('txt') as HTMLTextAreaElement | null;
  const send = document.getElementById('send') as HTMLButtonElement | null;
  const cnt = document.getElementById('count');
  if (txt && send && cnt) {
    countWatch(txt, cnt, send);
    send.addEventListener('click', () => act(() => post(ME!.mask, txt.value.trim()), 'Posted on chain.'));
  }

  // reply / quote / edit sheet
  const stxt = document.getElementById('stxt') as HTMLTextAreaElement | null;
  const ssend = document.getElementById('ssend') as HTMLButtonElement | null;
  const scnt = document.getElementById('scount');
  if (stxt && ssend && scnt && sheet) {
    countWatch(stxt, scnt, ssend, sheet.mode === 'quote');
    const s = sheet;
    ssend.addEventListener('click', () => {
      const v = stxt.value.trim();
      sheet = null;
      if (s.mode === 'edit') return act(() => edit(s.target.id, v), 'Updated on chain.');
      if (s.mode === 'reply') return act(() => post(ME!.mask, v, s.target.id, 0), 'Replied on chain.');
      return act(() => post(ME!.mask, v, 0, s.target.id), 'Quoted on chain.');
    });
  }

  // settings
  document.getElementById('savep')?.addEventListener('click', () => {
    const g = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value ?? '';
    const name = g('s_name'), tg = g('s_tg'), x = g('s_x'), bio = g('s_bio');
    settingsOpen = false;
    act(async () => { const r = await saveProfile(name, tg, x, bio); if (r.ok) forgetWho(ME?.mask); return r; }, 'Saved on chain.');
  });
  document.getElementById('usepeople')?.addEventListener('click', async () => {
    const n = await suggestedName();
    const el = document.getElementById('s_name') as HTMLInputElement | null;
    if (el) el.value = n || el.value;
    if (!n) { flash = { text: 'The host did not report a People chain username.', bad: true }; render(); }
  });

  document.getElementById('claim')?.addEventListener('click', () => {
    const label = (document.getElementById('dotlabel') as HTMLInputElement)?.value ?? '';
    act(async () => { const r = await claimMask(label); if (r.ok) ME = await me(); return r; }, 'Mask claimed — it is yours and cannot be moved.');
  });

  // per-post actions
  const find = (id: number) => [...LIST, ...THREAD.replies, ...THREAD.parents, THREAD.post].find((x) => x && x.id === id) as Post | undefined;
  app.querySelectorAll<HTMLElement>('[data-like]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); act(() => toggleLike(Number(b.dataset.like)), 'Done.');
  }));
  app.querySelectorAll<HTMLElement>('[data-repost]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const p = find(Number(b.dataset.repost));
    if (p) act(() => toggleRepost(p.id, ME!.mask), p.reposted ? 'Repost undone.' : 'Reposted.');
  }));
  app.querySelectorAll<HTMLElement>('[data-reply]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const p = find(Number(b.dataset.reply));
    if (p) { sheet = { mode: 'reply', target: p }; render(); }
  }));
  app.querySelectorAll<HTMLElement>('[data-share]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const p = find(Number(b.dataset.share));
    if (!p) return;
    const text = `${nameOf(p)} on chirp: "${p.body}"`;
    // The chain is the permalink: there is no server to link to.
    const url = `https://assethub-paseo.subscan.io/account/${CHIRP}`;
    try {
      if (navigator.share) await navigator.share({ text, url });
      else { await navigator.clipboard.writeText(text + ' — ' + url); flash = { text: 'Copied.' }; render(); }
    } catch { /* dismissed */ }
  }));
  app.querySelectorAll<HTMLElement>('[data-more]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const p = find(Number(b.dataset.more));
    if (!p) return;
    followLabel = (await isFollowing(p.mask)) ? 'Unfollow' : 'Follow';
    menuFor = p.id; render();
  }));
  app.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.m, id = Number(b.dataset.id), p = id ? find(id) : undefined;
    menuFor = null;
    if (m === 'close' || !p) return render();
    if (m === 'edit') { sheet = { mode: 'edit', target: p }; return render(); }
    if (m === 'quote') { sheet = { mode: 'quote', target: p }; return render(); }
    if (m === 'del') return act(() => remove(p.id), 'Deleted on chain.');
    if (m === 'follow') return act(() => toggleFollow(p.mask), 'Done.');
    if (m === 'copy') { void navigator.clipboard.writeText(p.body); flash = { text: 'Copied.' }; return render(); }
    if (m === 'chain') { window.open(`https://assethub-paseo.subscan.io/account/${CHIRP}`, '_blank'); return render(); }
    render();
  }));

  // open a thread
  app.querySelectorAll<HTMLElement>('[data-open]').forEach((c) => c.addEventListener('click', () => {
    const id = Number(c.dataset.open);
    if (view.kind === 'thread' && THREAD.post?.id === id) return;
    view = { kind: 'thread', id }; refresh();
  }));
}

async function refresh() {
  if (view.kind === 'thread') THREAD = await thread(view.id).catch(() => THREAD);
  else LIST = await feed().catch(() => LIST);
  render();
}

/* --------------------------------------------------------------------- boot */
app.innerHTML = header() + '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
warmUp();
(async () => {
  ME = await me().catch(() => null);
  LIST = await feed().catch(() => []);
  render();
})();
