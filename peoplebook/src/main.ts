/**
 * peoplebook — the identity every other app in this suite is built on.
 *
 * WHAT IT IS NOW, AND WHAT IT WAS
 *   It used to be a coin-op machine that dispensed foil cards. That was fun and
 *   it said nothing true. It holds the mask the whole suite resolves people
 *   through, so it has to read like a document somebody would show you, not
 *   like a prize.
 *
 * THE ONE IDEA THIS APP IS ABOUT
 *   Some things here were CHECKED by a contract. Others were TYPED by a person.
 *   Every interface in this business shows them in the same weight and lets you
 *   assume. This one refuses to: proved facts are green and say what proved
 *   them, claims are plain and say they are claims. Somebody can copy this
 *   stylesheet in an afternoon and will still have to decide whether to draw
 *   that line, and drawing it is expensive because it means admitting how
 *   little is actually proved.
 *
 * WHAT ONLY THIS APP CAN DO
 *   Show one person across the whole suite: the mask that cannot be
 *   transferred, the handle that is unique, the mailbox that letters seal to.
 *   Not a design. A set of reads against contracts that exist because we
 *   deployed them.
 */
import './style.css';
import data from './data.json';
import { icon, logo } from './icons';
import { reachOf, type Where } from './reach';
import { claim, setProfile, warmUp, signerInfo, myMask, type ClaimStep, type Socials } from './claim';

type User = { name: string; owner: string; tier?: number; social?: Socials };
const D = data as { chain: string; genesis: string; contract: string; stats: Record<string, number>; users: User[] };

const app = document.getElementById('app')!;
const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const hashCode = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/* ---------------------------------------------------- the mask, generated
 *
 * Kept from the arcade version, because it is the one piece of this app that
 * was always ours: the shapes mirror what the contract itself draws on chain.
 * A copy can take the outline; it cannot take the contract that mints it.
 */
const PAL = ['#4f8cff', '#a855f7', '#ec4899', '#22d3ee', '#2dd4bf', '#f59e0b', '#f472b6', '#818cf8', '#34d399', '#fb7185'];
function avatar(name: string): string {
  const n = hashCode(name), S = 40;
  const c1 = PAL[n % PAL.length], c2 = PAL[(n >> 3) % PAL.length];
  const round = 6 + (n % 6), visorY = 17 + (n % 4), eye = n % 3, antenna = (n >> 2) % 2;
  const hx = 10, hw = 20, hy = 8, hh = 24, gid = 'v' + n, W = 'rgba(255,255,255,.95)';
  let visor: string;
  if (eye === 0) visor = `<rect x="${hx + 3}" y="${visorY}" width="${hw - 6}" height="2.4" rx="1.2" fill="${W}"/>`;
  else if (eye === 1) visor = `<circle cx="${hx + 5.5}" cy="${visorY + 1.2}" r="1.7" fill="${W}"/><circle cx="${hx + hw - 5.5}" cy="${visorY + 1.2}" r="1.7" fill="${W}"/>`;
  else visor = `<rect x="${hx + 3}" y="${visorY}" width="${hw / 2 - 3}" height="2.4" rx="1.2" fill="${W}"/><rect x="${hx + hw / 2}" y="${visorY}" width="${hw / 2 - 3}" height="2.4" rx="1.2" fill="${W}"/>`;
  const mouth = `<rect x="${hx + 6}" y="${hy + hh - 6}" width="${hw - 12}" height="1.5" rx="0.75" fill="${W}" opacity="0.6"/>`;
  const ant = antenna ? `<circle cx="${hx + hw / 2}" cy="${hy - 2.5}" r="1.4" fill="${W}"/><line x1="${hx + hw / 2}" y1="${hy}" x2="${hx + hw / 2}" y2="${hy - 1.5}" stroke="${W}" stroke-width="1"/>` : '';
  const helmet = `<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" rx="${round}" fill="none" stroke="${W}" stroke-width="1.6"/>`;
  return `<svg viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${S}" height="${S}" fill="url(#${gid})"/><circle cx="12" cy="10" r="16" fill="#fff" opacity="0.12"/>${ant}${helmet}${visor}${mouth}</svg>`;
}

const TIERS = ['Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];

/* ------------------------------------------------------------------ state */

type Mine = { id: number; tier: number; verified: string; socials: Socials };
let MINE: Mine | null = null;
let MYADDR = '';
/** `null` while looking; the distinction between that and "you have none" is
 *  the whole reason this app exists, so it is not collapsed here either. */
let looked = false;
let REACH: Where[] | null = null;
let query = '';
let busy = '';
let flash: { text: string; bad?: boolean } | null = null;
let editing = false;

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/* ------------------------------------------------------------------ views */

/** A fact the chain checked, or a thing a person typed. Never the same weight. */
const proved = (text: string) => `<span class="fact proved">${icon.check}${esc(text)}</span>`;
const claimed = (text: string) => `<span class="fact claimed">${icon.claimed}${esc(text)}</span>`;
const plain = (text: string) => `<span class="fact">${esc(text)}</span>`;

function identityCard(): string {
  if (!looked) {
    return `<div class="card"><p class="dim" style="margin:0">Reading your mask from the chain…</p></div>`;
  }
  if (!MINE) {
    return `<div class="card">
      <h3>You do not hold a mask yet</h3>
      <p class="dim">A mask is the identity chirp and dotmail resolve you through. One per
      account, and it cannot be transferred, so there is nothing to squat and nothing to buy.</p>
      <div class="row">
        <button class="btn solid" id="claim">${icon.spark} Claim your mask</button>
      </div>
      ${MYADDR ? `<p class="dim small" style="margin-top:14px">It will belong to
        <span class="mono">${esc(short(MYADDR))}</span>, the account this suite knows you by.</p>` : ''}
    </div>`;
  }

  const s = MINE.socials;
  const name = s.name?.trim();
  return `<div class="card idcard">
    <div class="mask">${avatar(String(MINE.id))}</div>
    <div>
      <div class="idname">${esc(name || `Mask ${MINE.id}`)}</div>
      <div class="idhandle mono">${esc(short(MYADDR))}</div>

      <div class="facts">
        ${proved(`Mask ${MINE.id}, held by this account`)}
        ${proved(`${TIERS[MINE.tier] ?? 'Unknown'} tier, rolled on chain`)}
        ${MINE.verified ? proved(`${MINE.verified} checked against the registry`) : ''}
        ${name ? claimed('Display name, typed by you') : ''}
        ${s.telegram ? claimed('Telegram, typed by you') : ''}
        ${s.x ? claimed('X, typed by you') : ''}
      </div>

      ${s.bio?.trim() ? `<p style="margin:14px 0 0">${esc(s.bio)}</p>` : ''}

      <div class="row">
        <button class="btn" id="edit">${icon.profile} Edit profile</button>
      </div>
    </div>
  </div>

  <div class="note">${icon.claimed}<div><strong>Green was checked by a contract. Plain was typed
  by a person.</strong> A display name, a Telegram handle and a bio are whatever their owner
  wrote; nothing on this chain can confirm them, so nothing here pretends to. The mask, the tier
  and a <span class="mono">.dot</span> are different: a contract verified each one, and that is
  why they are marked.</div></div>`;
}

function reachSection(): string {
  if (!MINE) return '';
  const rows = REACH ?? [];
  return `<section class="sec">
    <div class="sechead">${icon.reach}<h2>Where you are reachable</h2></div>
    <p class="lede">One identity, read live from each app's own registry. Nothing here is
    remembered from a previous visit.</p>
    <div class="reach">
      ${(rows.length ? rows : [
        { app: 'chirp', as: '', on: null, note: 'reading…' },
        { app: 'dotmail', as: '', on: null, note: 'reading…' },
      ] as Where[]).map((w) => `
        <div class="reachrow ${w.on === true ? 'on' : ''}">
          <span class="mark">${w.on === true ? icon.check : icon.claimed}</span>
          <span>
            <span class="app">${esc(w.app)}</span>
            ${w.as ? `<span class="as"> &middot; ${esc(w.as)}</span>` : ''}
            <br><span class="as">${esc(w.note)}</span>
          </span>
          <span class="state ${w.on === true ? 'on' : ''}">${
            w.on === true ? 'reachable' : w.on === false ? 'not yet' : 'could not ask'
          }</span>
        </div>`).join('')}
    </div>
  </section>`;
}

function editView(): string {
  const s = MINE?.socials ?? { name: '', telegram: '', x: '', bio: '' };
  return `<section class="sec">
    <div class="sechead">${icon.profile}<h2>Your profile</h2></div>
    <p class="lede">Written on chain by the account that holds the mask, so only you can change
    it. None of it is verified, and the card says so.</p>
    <div class="card">
      <label class="lbl">Display name</label>
      <input id="p_name" value="${esc(s.name ?? '')}" maxlength="40" autocomplete="off">
      <label class="lbl">Telegram</label>
      <input id="p_tg" value="${esc(s.telegram ?? '')}" placeholder="@handle" autocomplete="off">
      <label class="lbl">X</label>
      <input id="p_x" value="${esc(s.x ?? '')}" placeholder="@handle" autocomplete="off">
      <label class="lbl">Bio</label>
      <textarea id="p_bio" maxlength="240">${esc(s.bio ?? '')}</textarea>
      <div class="row">
        <button class="btn solid" id="save">Save on chain</button>
        <button class="btn" id="cancel">${icon.close} Cancel</button>
      </div>
    </div>
  </section>`;
}

function registerSection(): string {
  const q = query.trim().toLowerCase();
  const list = D.users
    .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.social?.name ?? '').toLowerCase().includes(q))
    .slice(0, 60);
  return `<section class="sec">
    <div class="sechead">${icon.register}<h2>The register</h2></div>
    <p class="lede">${D.users.length.toLocaleString('en')} masks have been claimed. Each one belongs
    to exactly one account and cannot be moved to another.</p>
    <div class="searchwrap">
      ${icon.search}
      <input id="q" value="${esc(query)}" placeholder="Search the register">
    </div>
    <div class="people">
      ${list.length ? list.map((u) => `
        <div class="person">
          <span class="mask">${avatar(u.name)}</span>
          <span>
            <span class="nm">${esc(u.social?.name || u.name)}</span><br>
            <span class="hd">${esc(u.name)}</span>
          </span>
          <span class="tier">${TIERS[u.tier ?? 4] ?? ''}</span>
        </div>`).join('')
        : '<p class="dim">Nobody matches that.</p>'}
    </div>
  </section>`;
}

function render() {
  app.innerHTML = `
  <header class="top">
    <span class="brand">${logo(26)} peoplebook</span>
    <span class="grow"></span>
    ${MYADDR ? `<span class="who">${MINE ? `<span class="mask" style="width:22px;height:22px;border-radius:6px;overflow:hidden">${avatar(String(MINE.id))}</span>` : ''}${esc(short(MYADDR))}</span>` : ''}
  </header>

  <main>
    <h1>Who you are, everywhere at once</h1>
    <p class="lede">One mask, held by one account, that chirp and dotmail both resolve you
    through. This page is where it lives, and where the difference between what was checked and
    what was merely typed is kept visible.</p>

    <section class="sec">
      <div class="sechead">${icon.identity}<h2>Your identity</h2></div>
      ${identityCard()}
    </section>

    ${editing ? editView() : ''}
    ${reachSection()}
    ${registerSection()}
  </main>

  ${busy ? `<div class="flash">${esc(busy)}</div>` : ''}
  ${flash && !busy ? `<div class="flash ${flash.bad ? 'bad' : ''}">${esc(flash.text)}</div>` : ''}`;
  bind();
}

/* ---------------------------------------------------------------- actions */

async function loadMine() {
  const info = await signerInfo().catch(() => null);
  MYADDR = info?.address ?? '';
  MINE = await myMask().catch(() => null);
  looked = true;
  render();
  if (MINE) {
    REACH = await reachOf(MINE.id).catch(() => null);
    render();
  }
}

function bind() {
  document.getElementById('claim')?.addEventListener('click', async () => {
    busy = 'Cranking the machine…';
    render();
    const said: Record<ClaimStep, string> = {
      connecting: 'Connecting your wallet…',
      preparing: 'Preparing the claim…',
      signing: 'Waiting for your signature…',
      minting: 'Minting on chain…',
      done: 'Done.',
    };
    const r = await claim(undefined, (s) => { busy = said[s]; render(); });
    busy = '';
    flash = r.ok
      ? { text: `Mask ${r.id} is yours. It cannot be transferred, so it stays yours.` }
      : { text: r.why, bad: true };
    render();
    await loadMine();
  });

  document.getElementById('edit')?.addEventListener('click', () => { editing = true; render(); });
  document.getElementById('cancel')?.addEventListener('click', () => { editing = false; render(); });

  document.getElementById('save')?.addEventListener('click', async () => {
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement)?.value ?? '';
    const s: Socials = { name: get('p_name'), telegram: get('p_tg'), x: get('p_x'), bio: get('p_bio') };
    const r = await setProfile(s, (m) => { busy = m; render(); });
    busy = '';
    flash = r.ok ? { text: 'Saved on chain.' } : { text: r.why, bad: true };
    if (r.ok) editing = false;
    render();
    await loadMine();
  });

  const q = document.getElementById('q') as HTMLInputElement | null;
  q?.addEventListener('input', () => {
    query = q.value;
    const sec = q.closest('section');
    if (!sec) return;
    // Repaint only the list, so typing does not steal focus from the box.
    const holder = sec.querySelector('.people');
    if (holder) {
      const tmp = document.createElement('div');
      tmp.innerHTML = registerSection();
      const fresh = tmp.querySelector('.people');
      if (fresh) holder.innerHTML = fresh.innerHTML;
    }
  });
}

/* ------------------------------------------------------------------- boot */

warmUp();
render();
void loadMine();
