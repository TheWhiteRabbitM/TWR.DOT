/**
 * chirp — a microblog that lives in a contract.
 *
 * The timeline is read straight from Chirp on the devnet Asset Hub and posting
 * goes through your mask, so there is no server in the loop and nothing to take
 * a post down. The identity story is the point: PeoplebookMasks gives one mask
 * per account and refuses transfers, so "posting as a mask" is the same as
 * "posting as that account" — a chirp cannot be forged, and the only name ever
 * shown with a tick is a `.dot` the contract itself verified against the registry.
 */
import './style.css';
import { keccak_256 } from '@noble/hashes/sha3';
import { warmUp, me, feed, post, edit, like, claimMask, CHIRP, MASKS, type Chirp, type Me } from './chain';

const app = document.getElementById('app')!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/* ---- the mask, drawn exactly as the contract draws it: seeded by the address
        (keccak of the 20 raw bytes), so the page and the NFT always agree. ---- */
const PAL = ['#4f8cff', '#a855f7', '#ec4899', '#22d3ee', '#2dd4bf', '#f59e0b', '#f472b6', '#818cf8', '#34d399', '#fb7185'];
function avatar(addr: string): string {
  const hex = (addr || '0x0').replace(/^0x/, '').padStart(40, '0').slice(0, 40);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  const h = keccak_256(bytes);
  // The contract works on the hash as one big number; the low bytes are enough
  // to reproduce the same choices here.
  let s = 0n;
  for (const b of h) s = (s << 8n) | BigInt(b);
  const n = (d: bigint, m: bigint) => Number((s / d) % m);
  const c1 = PAL[n(1n, 10n)], c2 = PAL[n(10n, 10n)];
  const round = 6 + n(1n, 6n), visorY = 17 + n(7n, 4n), eye = n(13n, 3n);
  const W = 'rgba(255,255,255,.95)';
  let visor: string;
  if (eye === 0) visor = `<rect x="13" y="${visorY}" width="14" height="2.4" rx="1.2" fill="${W}"/>`;
  else if (eye === 1) visor = `<circle cx="15.5" cy="${visorY + 1}" r="1.7" fill="${W}"/><circle cx="24.5" cy="${visorY + 1}" r="1.7" fill="${W}"/>`;
  else visor = `<rect x="13" y="${visorY}" width="6" height="2.4" rx="1.2" fill="${W}"/><rect x="21" y="${visorY}" width="6" height="2.4" rx="1.2" fill="${W}"/>`;
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
const TICK = `<svg class="tick" viewBox="0 0 24 24" fill="currentColor"><path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg>`;
const HEART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`;
const PEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;

let ME: Me | null = null;
let LIST: Chirp[] = [];
let editing = 0;

/* -------------------------------------------------------------------- views */

function chirpRow(c: Chirp): string {
  const mine = ME && c.author.toLowerCase() === ME.address.toLowerCase();
  const isMyMask = ME && ME.mask === c.mask;
  const name = isMyMask && ME?.name ? ME.name + '.dot' : 'mask #' + c.mask;
  return `<article class="chirp">
    <div class="av">${avatar(c.author)}</div>
    <div class="grow">
      <div class="head">
        <span class="nm">${esc(name)}</span>${isMyMask && ME?.name ? TICK : ''}
        <span class="at">${esc(short(c.author))}</span>
        <span class="dot">·</span><span class="ts">${ago(c.time)}</span>
        ${c.edited ? '<span class="edited">· edited</span>' : ''}
      </div>
      <div class="body">${esc(c.body)}</div>
      <div class="acts">
        <button class="act like" data-like="${c.id}">${HEART}<span>${c.likes || ''}</span></button>
        ${mine ? `<button class="act edit" data-edit="${c.id}">${PEN}<span>Edit</span></button>` : ''}
      </div>
    </div>
  </article>`;
}

function composeBox(): string {
  if (!ME) return '';
  if (!ME.mask) {
    return `<section class="gate">
      <h2>Claim your mask to post</h2>
      <p>A mask is bound to your account and cannot be transferred, so nobody can post as you.
      Own a <b>.dot</b>? Put the label in and the contract will verify it on chain and show it with a tick.</p>
      <input id="dotlabel" placeholder="your .dot label, without the suffix (optional)" autocomplete="off" spellcheck="false">
      <button class="primary" id="claim">Claim my mask</button>
    </section>`;
  }
  return `<section class="compose">
    <div class="av">${avatar(ME.address)}</div>
    <div class="grow">
      <textarea id="txt" maxlength="400" placeholder="${editing ? 'Rewrite your chirp…' : "What's happening on chain?"}"></textarea>
      <div class="composebar">
        ${editing ? '<button class="ghost" id="cancel">Cancel</button>' : ''}
        <span class="count" id="count">280</span>
        <button class="primary" id="send" disabled>${editing ? 'Save' : 'Chirp'}</button>
      </div>
    </div>
  </section>`;
}

function header(): string {
  const right = !ME
    ? '<span>open in the Polkadot app</span>'
    : `<b>${ME.mask ? (ME.name ? esc(ME.name) + '.dot' : 'mask #' + ME.mask) : 'no mask yet'}</b><span>${esc(short(ME.address))}${ME.kind === 'app' ? ' · app account' : ''}</span>`;
  return `<header class="top">
    <h1>chirp</h1>
    ${ME?.mask ? `<span class="tier t${ME.tier}">${TIERS[ME.tier]}</span>` : ''}
    <div class="who">${right}</div>
  </header>`;
}

function render(msg?: { text: string; bad?: boolean }) {
  app.innerHTML =
    header() +
    (msg ? `<div class="msg ${msg.bad ? 'bad' : 'good'}">${esc(msg.text)}</div>` : '') +
    composeBox() +
    (LIST.length
      ? LIST.map(chirpRow).join('')
      : `<div class="note">No chirps yet. ${ME?.mask ? '<b>Be the first.</b>' : ''}</div>`) +
    `<footer class="foot">
      Every chirp is a row in the <a href="https://assethub-paseo.subscan.io/account/${CHIRP}" target="_blank" rel="noopener">Chirp contract</a>
      on the devnet Asset Hub — no server, no Bulletin, nothing to expire. You post as a
      <a href="https://assethub-paseo.subscan.io/account/${MASKS}" target="_blank" rel="noopener">mask</a> that is bound to your
      account and cannot be transferred, so a chirp can only come from its author. A tick means the contract
      checked that <code>.dot</code> against the registry. Posts are editable by their author; the chain records that they changed.
      <span style="display:block;margin-top:10px;opacity:.6">build ${esc(__BUILD__)}</span>
    </footer>`;
  wire();
}

/* ------------------------------------------------------------------- wiring */

function wire() {
  const txt = document.getElementById('txt') as HTMLTextAreaElement | null;
  const send = document.getElementById('send') as HTMLButtonElement | null;
  const count = document.getElementById('count');
  if (txt && send && count) {
    if (editing) {
      const c = LIST.find((x) => x.id === editing);
      if (c) txt.value = c.body;
    }
    const sync = () => {
      const n = 280 - txt.value.length;
      count.textContent = String(n);
      count.className = 'count' + (n < 0 ? ' over' : n <= 20 ? ' warn' : '');
      send.disabled = txt.value.trim().length === 0 || n < 0;
    };
    txt.addEventListener('input', sync);
    sync();
    txt.focus();
    send.addEventListener('click', async () => {
      const body = txt.value.trim();
      send.disabled = true;
      send.textContent = editing ? 'Saving…' : 'Chirping…';
      const r = editing ? await edit(editing, body) : await post(ME!.mask, body);
      if (!r.ok) { render({ text: r.why, bad: true }); return; }
      editing = 0;
      await refresh({ text: 'Posted on chain.' });
    });
  }

  document.getElementById('cancel')?.addEventListener('click', () => { editing = 0; render(); });

  document.getElementById('claim')?.addEventListener('click', async () => {
    const label = (document.getElementById('dotlabel') as HTMLInputElement)?.value ?? '';
    const btn = document.getElementById('claim') as HTMLButtonElement;
    btn.disabled = true; btn.textContent = 'Claiming…';
    const r = await claimMask(label);
    if (!r.ok) { render({ text: r.why, bad: true }); return; }
    ME = await me();
    await refresh({ text: 'Mask claimed — it is yours and cannot be moved.' });
  });

  app.querySelectorAll<HTMLElement>('[data-like]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = Number(b.dataset.like);
      b.classList.add('on');
      const r = await like(id);
      if (!r.ok) { render({ text: r.why, bad: true }); return; }
      await refresh();
    }),
  );

  app.querySelectorAll<HTMLElement>('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => { editing = Number(b.dataset.edit); render(); }),
  );
}

async function refresh(msg?: { text: string; bad?: boolean }) {
  LIST = await feed().catch(() => LIST);
  render(msg);
}

/* --------------------------------------------------------------------- boot */

app.innerHTML = header() + '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
warmUp();
(async () => {
  ME = await me().catch(() => null);
  LIST = await feed().catch(() => []);
  render();
})();
