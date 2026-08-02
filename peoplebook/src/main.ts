/**
 * peoplebook — COIN-OP // THE MASK MACHINE
 *
 * The directory and the generated masks are static; the CLAIM is real. You crank
 * the machine, it costs nothing but gas, the contract mints an NFT and
 * rolls its rarity on chain, and a capsule cracks open into a foil card. Once you
 * own a mask you can attach your links (Telegram, X, a bio) — written on chain by
 * the token owner via setProfile, and shown on the card. Claimed handles carry the
 * tier + links the chain recorded (baked at build, refreshed hourly).
 */
import './style.css';
import data from './data.json';
import { claim, setProfile, warmUp, signerInfo, myMask, diagnose, type ClaimStep, type Socials } from './claim';

/** The mask this account holds — the app is about YOURS, not a handle you pick. */
let MINE: { id: number; tier: number; verified: string; socials: Socials } | null = null;
let MYADDR = '';

type User = { name: string; owner: string; tier?: number; social?: Socials };
const D = data as { chain: string; genesis: string; contract: string; stats: Record<string, number>; users: User[] };
const N = D.users.length;

const app = document.getElementById('app')!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const hashCode = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- generative mask (mirrors the contract's on-chain SVG in spirit) ---- */
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

/* ---- tiers (index matches the contract: 0 Legendary … 4 Common) ---- */
const TIERS = [
  { name: 'Legendary', v: 'var(--leg)', hex: '#ffc531' },
  { name: 'Epic', v: 'var(--epi)', hex: '#b24bff' },
  { name: 'Rare', v: 'var(--rar)', hex: '#2e7dff' },
  { name: 'Uncommon', v: 'var(--unc)', hex: '#34d399' },
  { name: 'Common', v: 'var(--com)', hex: '#9aa1ab' },
];
/* segment order in the odds dial: common → legendary. Base = contract bands;
 * boosted = what the contract's ×0.65 shift actually does to a uniform roll. */
const DIAL = [
  { cls: 'com', base: 37, boost: 3 },
  { cls: 'unc', base: 30, boost: 46 },
  { cls: 'rar', base: 20, boost: 31 },
  { cls: 'epi', base: 10, boost: 15 },
  { cls: 'leg', base: 3, boost: 5 },
];

const split = (name: string): [string, string] => {
  const m = name.match(/^(.*?)(\.[0-9]+)$/);
  return m ? [m[1], m[2]] : [name, ''];
};
const tgUrl = (h: string) => 'https://t.me/' + encodeURIComponent(h.replace(/^@/, ''));
const xUrl = (h: string) => 'https://x.com/' + encodeURIComponent(h.replace(/^@/, ''));

/* ---- page ---- */
const dialSegs = (boost: boolean) => DIAL.map((d) => `<span class="seg ${d.cls}" style="flex-basis:${boost ? d.boost : d.base}%"></span>`).join('');

app.innerHTML = `
  <canvas id="fx"></canvas>
  <div class="room">
    <section class="stage">
      <div class="machine" id="machine">
        <div class="marquee"><span class="wm">PEOPLEBOOK</span><span class="sub">CAPSULE MACHINE // DEVNET</span></div>
        <div class="dome"><div class="caps" id="caps"></div></div>
        <div class="oddswrap">
          <span class="oddslbl">PULL RATES</span>
          <div class="odds-dial">${dialSegs(false)}</div>
        </div>
        <div class="controls">
          <div class="slot"><span class="slotmouth"></span><span class="slotlbl">FREE<br>PLAY</span></div>
          <button class="pull" id="crank">TURN<small>crank a random mask</small></button>
        </div>
        <div class="tray" id="tray"></div>
      </div>
      <div class="pitch">
        <h1 class="headline">Claim your<br>mask.</h1>
        <p class="lede">167 handles on the devnet — every one wears a generated mask. Crank yours on chain — <span class="pas">free</span>, you only sign — and the machine rolls its rarity. Own a <b>.dot</b>? Slot it in for better odds. Then pin your <b>Telegram</b> and <b>X</b> to it.</p>
        <div class="connect" id="wallet"><span class="led"></span><span id="wtext">CONNECT</span></div>
        <div class="scoreboard" id="hud"></div>
      </div>
    </section>

    <section class="registry">
      <div class="sechead"><span class="secn">§</span><h2>The Binder</h2><span class="rule"></span><span class="count" id="count"></span></div>
      <div class="panel">
        <label class="slotsearch">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="q" type="search" placeholder="Find a handle" autocomplete="off" spellcheck="false" aria-label="Search handles">
        </label>

      </div>
      <div class="binder" id="grid"></div>
    </section>

    <footer id="foot"></footer>
  </div>

  <div class="claim" id="lb">
    <div class="chamber" id="sheet">
      <button class="x" id="lbx" aria-label="Close">✕</button>
      <div id="ribbonslot"></div>
      <div class="cardstage">
        <div class="burst" id="burst" hidden></div>
        <div class="capsule-card" id="cc">
          <div class="card-inner">
            <div class="card-face card-back" id="cback"></div>
            <div class="card-face card-front" id="cfront"></div>
          </div>
        </div>
      </div>
      <div class="chn" id="lbhn"></div>
      <div class="mini-dial" id="minidial" hidden>${dialSegs(false)}</div>
      <input id="lbdot" placeholder="your .dot for better odds (optional)" autocomplete="off" spellcheck="false" hidden>
      <div class="st" id="lbst"></div>
      <div class="prof" id="prof" hidden>
        <div class="plabel">Telegram</div><input id="ptg" placeholder="handle (without @)" maxlength="32" autocomplete="off" spellcheck="false">
        <div class="plabel">X</div><input id="px" placeholder="handle (without @)" maxlength="32" autocomplete="off" spellcheck="false">
        <div class="plabel">Bio</div><input id="pbio" placeholder="one line about you" maxlength="160" autocomplete="off">
        <button class="psave" id="psave">Save links to chain</button>
      </div>
      <button class="pull small" id="lbgo">TURN</button>
      <div class="acts" id="acts" hidden></div>
    </div>
  </div>`;

/* dome capsules */
document.getElementById('caps')!.innerHTML = D.users
  .filter((_, i) => i % Math.max(1, Math.floor(N / 15)) === 0)
  .slice(0, 15)
  .map((u, i) => `<div class="capsule" style="--i:${i}">${avatar(u.name)}</div>`)
  .join('');

/* scoreboard */
function hud() {
  const el = document.getElementById('hud')!;
  el.innerHTML = [
    [D.stats.people, 'recognised people', 0],
    [N, 'registered handles', 0],
    [D.stats.activeMembers, 'active ring members', 0],
  ].map(([v, l, hot]) => `<div class="cell${hot ? ' hot' : ''}"><b data-n="${v}">0</b><span>${l}</span></div>`).join('');
  el.querySelectorAll<HTMLElement>('.cell b[data-n]').forEach((b) => {
    const target = +b.dataset.n!;
    if (reduce) { b.textContent = String(target); return; }
    const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / 800); b.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

/* binder */
const grid = document.getElementById('grid')!;
const countEl = document.getElementById('count')!;
const q = document.getElementById('q') as HTMLInputElement;

function socialChips(u: User): string {
  const s = u.social;
  if (!s) return '';
  const bits: string[] = [];
  if (s.telegram) bits.push(`<a class="social" href="${esc(tgUrl(s.telegram))}" target="_blank" rel="noopener">✆ ${esc(s.telegram)}</a>`);
  if (s.x) bits.push(`<a class="social" href="${esc(xUrl(s.x))}" target="_blank" rel="noopener">𝕏 ${esc(s.x)}</a>`);
  return bits.join('');
}
/** A row in the directory. Read-only on purpose: these are people who registered
 *  a handle on the People chain, and a mask now belongs to an account rather
 *  than to a name — so there is nothing here to claim, and nothing to squat. */
function card(u: User, i: number): string {
  const [b, s] = split(u.name);
  const cls = 'card unclaimed';
  const style = `animation-delay:${Math.min(i * 10, 380)}ms`;
  const foot = socialChips(u);
  return `<div class="sleeve" style="${style}"><div class="${cls}"><div class="tab"></div>
    <div class="art">${avatar(u.name)}</div>
    <div class="who"><div class="handle">${esc(b)}<span class="sfx">${esc(s)}</span></div><div class="owner">${esc(u.owner)}</div></div>
    <div class="foot">${foot}</div></div></div>`;
}
function visible(): User[] {
  const t = q.value.trim().toLowerCase();
  return t ? D.users.filter((u) => u.name.toLowerCase().includes(t)) : D.users;
}
function render() {
  const list = visible();
  grid.innerHTML = list.length ? list.map(card).join('') : '<p class="empty">No handle matches that.</p>';
  countEl.textContent = list.length + (list.length === N ? ' handles' : ' of ' + N);
}

/* ---- capsule reveal + real claim + profile ---- */
const lb = document.getElementById('lb')!;
const sheet = document.getElementById('sheet')!;
const fx = document.getElementById('fx') as HTMLCanvasElement;
const fctx = fx.getContext('2d')!;
const goBtn = document.getElementById('lbgo') as HTMLButtonElement;
const dotInput = document.getElementById('lbdot') as HTMLInputElement;
const prof = document.getElementById('prof')!;
const acts = document.getElementById('acts')!;
const minidial = document.getElementById('minidial')!;
const ptg = document.getElementById('ptg') as HTMLInputElement;
const px = document.getElementById('px') as HTMLInputElement;
const pbio = document.getElementById('pbio') as HTMLInputElement;
const psave = document.getElementById('psave') as HTMLButtonElement;
let parts: { x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number; c: string; s: number }[] = [];
let raf = 0;
let current: string | null = null;

function sizeFx() { const r = Math.min(2, devicePixelRatio || 1); fx.width = innerWidth * r; fx.height = innerHeight * r; fctx.setTransform(r, 0, 0, r, 0, 0); }
function confetti(color: string, n: number) {
  const cx = innerWidth / 2;
  for (let i = 0; i < n; i++) parts.push({ x: cx + (Math.random() - 0.5) * 180, y: innerHeight * 0.4, vx: (Math.random() - 0.5) * 4, vy: -4 - Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35, life: 1, c: Math.random() < 0.55 ? color : ['#ff4a1c', '#ffb020', '#b24bff', '#2e7dff'][i % 4], s: 3 + Math.random() * 4 });
  if (!raf) loop();
}
function loop() {
  fctx.clearRect(0, 0, innerWidth, innerHeight);
  parts.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.14; p.rot += p.vr; p.life -= 0.008;
    fctx.save(); fctx.globalAlpha = Math.max(0, p.life); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillStyle = p.c; fctx.shadowColor = p.c; fctx.shadowBlur = 6; fctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); fctx.restore(); });
  parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 30);
  raf = parts.length ? requestAnimationFrame(loop) : 0;
}

const STEP_TEXT: Record<ClaimStep, string> = {
  connecting: 'Connecting your wallet…',
  preparing: 'Loading the capsule…',
  signing: 'Approve the claim in your wallet…',
  minting: 'Cranking the machine…',
  done: '',
};

function setDial(el: HTMLElement, boost: boolean) {
  el.querySelectorAll<HTMLElement>('.seg').forEach((seg, i) => { seg.style.flexBasis = (boost ? DIAL[i].boost : DIAL[i].base) + '%'; });
}
function ribbon(tier: number | null) {
  const slot = document.getElementById('ribbonslot')!;
  slot.innerHTML = tier === null ? '' : `<span class="ribbon" style="--tc:${TIERS[tier].v}">${TIERS[tier].name}</span>`;
}
function reveal(handle: string, tier: number) {
  const cc = document.getElementById('cc')!;
  const t = TIERS[tier];
  document.getElementById('cfront')!.innerHTML = avatar(handle);
  (document.getElementById('cfront') as HTMLElement).className = 'card-face card-front foil' + tier;
  sheet.style.setProperty('--tc', t.v);
  cc.classList.add('flipped');
  ribbon(tier);
  const burst = document.getElementById('burst')!;
  burst.hidden = false; burst.style.color = t.v;
  if (!reduce) { confetti(t.hex, [150, 100, 60, 34, 18][tier] ?? 18); }
}

/* open the chamber in 'claim' (sealed → crank) or 'edit' (owned mask → links) */
function openSheet(mode: 'claim' | 'edit') {
  current = MYADDR;
  // The chamber is always about YOUR mask now, so it is titled by the name you
  // proved rather than by a handle you picked off a list.
  const [b, s] = MINE?.verified ? [MINE.verified, '.dot'] : ['your mask', ''];
  sizeFx(); lb.classList.add('on');
  sheet.classList.remove('rolling'); sheet.style.removeProperty('--tc');
  document.getElementById('cback')!.innerHTML = avatar(MYADDR || 'you') + '<span class="seal">SEALED</span>';
  document.getElementById('cfront')!.innerHTML = '';
  document.getElementById('cc')!.classList.remove('flipped');
  document.getElementById('burst')!.hidden = true;
  document.getElementById('lbhn')!.innerHTML = esc(b) + `<span class="sfx">${esc(s)}</span>`;
  document.getElementById('lbst')!.textContent = '';
  ribbon(null);
  acts.hidden = true; acts.innerHTML = '';
  prof.hidden = true;

  if (mode === 'edit') {
    reveal(MYADDR, MINE?.tier ?? 4);
    ptg.value = MINE?.socials.telegram ?? '';
    px.value = MINE?.socials.x ?? '';
    pbio.value = MINE?.socials.bio ?? '';
    prof.hidden = false;
    minidial.hidden = true; dotInput.hidden = true;
    goBtn.hidden = true;
    document.getElementById('lbst')!.textContent = 'Edit your links — only the mask owner can save.';
    psave.disabled = false; psave.textContent = 'Save links to chain';
  } else {
    minidial.hidden = false; setDial(minidial, false);
    dotInput.hidden = false; dotInput.value = '';
    goBtn.hidden = false; goBtn.disabled = false; goBtn.textContent = 'TURN'; goBtn.dataset.mode = 'go';
  }
}

async function runClaim() {
  const stEl = document.getElementById('lbst')!;
  goBtn.disabled = true; dotInput.hidden = true; minidial.hidden = true;
  sheet.classList.add('rolling');

  const res = await claim(dotInput.value || undefined, (step) => { stEl.textContent = STEP_TEXT[step]; });
  sheet.classList.remove('rolling');

  if (!res.ok) {
    stEl.textContent = res.why;
    goBtn.hidden = false; goBtn.textContent = 'Try again'; goBtn.disabled = false; goBtn.dataset.mode = 'retry';
    return;
  }

  MINE = { id: res.id, tier: res.tier, verified: res.verified, socials: { telegram: '', x: '', bio: '' } };
  reveal(MYADDR, res.tier);
  stEl.textContent = res.verified
    ? `Minted — ${res.verified}.dot verified against the registry. Pin your links (optional):`
    : 'Minted — bound to your account, and it cannot be moved. Pin your links (optional):';
  goBtn.hidden = true;
  ptg.value = ''; px.value = ''; pbio.value = '';
  prof.hidden = false; psave.disabled = false; psave.textContent = 'Save links to chain';
  showActs();
  hud(); render();
}

function showActs() {
  acts.hidden = false;
  acts.innerHTML = `<button class="primary" data-done="1">Done</button>`;
}

async function runSave() {
  const stEl = document.getElementById('lbst')!;
  psave.disabled = true;
  const s: Socials = { telegram: ptg.value.trim(), x: px.value.trim(), bio: pbio.value.trim() };
  const res = await setProfile(s, (m) => { stEl.textContent = m; });
  if (!res.ok) {
    stEl.textContent = res.why;
    psave.disabled = false;
    return;
  }
  if (MINE) MINE.socials = { telegram: s.telegram.replace(/^@/, ''), x: s.x.replace(/^@/, ''), bio: s.bio };
  stEl.textContent = 'Saved on chain ✓';
  psave.textContent = 'Saved ✓';
  showActs();
  render();
}

function closeLb() { lb.classList.remove('on'); parts = []; current = null; render(); }

goBtn.addEventListener('click', () => {
  if (goBtn.dataset.mode === 'done') return closeLb();
  runClaim();
});
psave.addEventListener('click', () => { runSave(); });
acts.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-done]')) closeLb(); });
document.getElementById('lbx')!.addEventListener('click', closeLb);
dotInput.addEventListener('input', () => setDial(minidial, !!dotInput.value.trim()));
lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
addEventListener('resize', () => { if (lb.classList.contains('on')) sizeFx(); });

document.getElementById('crank')!.addEventListener('click', () => {
  // The machine only ever deals in YOUR mask: claim it, or edit its links if you
  // already hold one. With no account connected there is nothing to crank.
  if (!MYADDR) {
    document.querySelector('.registry')!.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    return;
  }
  openSheet(MINE ? 'edit' : 'claim');
});

/** Put the connected account, and whatever mask it holds, on the machine. */
function showMine() {
  const crank = document.getElementById('crank')!;
  if (!MYADDR) { crank.innerHTML = 'TURN<small>open in the Polkadot app</small>'; return; }
  crank.innerHTML = MINE
    ? `YOUR MASK<small>${MINE.verified ? esc(MINE.verified) + '.dot · ' : ''}pin your links</small>`
    : 'CLAIM<small>your mask · one per account</small>';
}
q.addEventListener('input', render);

document.getElementById('foot')!.innerHTML =
  `The directory is read from <code>Resources.usernameOwnerOf</code> on ${esc(D.chain)} — who registered a handle, nothing more. ` +
  `Your mask is minted by <a href="https://assethub-paseo.subscan.io/account/0x03a484cCD0f1832084dEEFca4bF6438d79Fe8db6" target="_blank" rel="noopener">PeoplebookMasks</a> ` +
  `on the devnet Asset Hub: one per account, generated from your address, and <b>not transferable</b> — so nobody can claim or buy someone else's identity. ` +
  `A <b>.dot</b> is the one name provable here, so the contract checks it against the registry before showing it. Rarity is rolled on chain; the image and your links live on chain. Addresses truncated.` +
  `<span class="build">build ${esc(__BUILD__)} · free · <a href="#" id="diag">diagnostics</a></span>`;

// A claim that hangs reports nothing, because every layer here fails quietly.
// This prints what each step actually returned, so a stuck signature can be read
// off the screen instead of guessed at.
document.getElementById('diag')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const box = document.getElementById('foot')!;
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;text-align:left;font-size:11px;opacity:.85;margin-top:12px';
  pre.textContent = 'running…';
  box.appendChild(pre);
  pre.textContent = (await diagnose()).join('\n');
});

/* boot */
hud();
render();
warmUp();
showMine();
signerInfo().then(async (info) => {
  const w = document.getElementById('wallet')!, t = document.getElementById('wtext')!;
  if (!info) { t.textContent = 'OPEN IN THE POLKADOT APP'; return; }
  const { address: addr, kind } = info;
  MYADDR = addr;
  w.classList.add('on');
  // Say WHICH account pays. An app-scoped account is one the host derives for
  // peoplebook — it is not the wallet the person funded, so a claim from it
  // fails until it is topped up. Naming it beats a cryptic on-chain revert.
  t.innerHTML = kind === 'app'
    ? `APP ACCOUNT · ${esc(addr.slice(0, 6))}…${esc(addr.slice(-6))}<small style="display:block;opacity:.7">fund this address to claim</small>`
    : `${esc(addr.slice(0, 6))}…${esc(addr.slice(-6))}`;
  // Whatever mask this account already holds, so the machine opens on yours.
  MINE = await myMask().catch(() => null);
  showMine();
  hud();
});
