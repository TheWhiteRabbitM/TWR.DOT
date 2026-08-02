/**
 * The arcade: three cabinets in a dark room; choose one and walk up to it.
 *
 * WHY THE CABINETS ARE THE PRODUCT AND THE GAMES ARE CONTENT
 *   The room, the cabinets and the walk-up are built here and work with nothing
 *   plugged in. Which game sits in which cabinet is one line of `CABINETS`, so a
 *   title arriving later — or a permission arriving later — costs an edit, not a
 *   rebuild. Slots with nothing in them are shown dark and honest rather than
 *   hidden, because an arcade filling up as permissions land is a better thing
 *   to watch than one that pretended to be full.
 *
 * WHAT MAY BE PLUGGED IN
 *   Only cartridges we are allowed to redistribute: an explicit licence, or an
 *   author's permission. That is a property of the ROM, not of this file, and
 *   the manifest records which applies to each.
 */
import { CABINETS, SCREENS, makeMachine, posterOf, type Cabinet, type Machine } from './cabinets';
import { open } from './opening';
import { insertCoin, warmUp, payer, PRICE, type CoinStep } from './coin';
import './room.css';


const root = document.getElementById('app')!;
let machine: Machine | null = null;
let playing: number | null = null;

/* -------------------------------------------------------------------- room */

function render() {
  root.innerHTML = `
    <div class="room" id="room">
      <div class="tubes" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="masthead">
        <h1>ARCADE ON CHAIN</h1>
        <p>Three cabinets. Pick one and walk up to it — the room moves, the screen
           fills your view, and you play. Everything runs in this page.</p>
      </header>

      <div class="row" id="row">
        ${CABINETS.map(
          (c, i) => `
          <button class="cab${c.rom ? '' : ' empty'}" data-i="${i}"
                  style="--ar:${c.system ? SCREENS[c.system].ar : '4 / 3'};--lines:${c.system ? SCREENS[c.system].h : 240}"
                  ${c.rom ? '' : 'aria-disabled="true"'}>
            <span class="body">
              <span class="marquee"><span>${esc(c.title)}</span></span>
              <span class="bezel">
                <span class="screen">
                  <canvas width="${c.system ? SCREENS[c.system].w : 256}"
                          height="${c.system ? SCREENS[c.system].h : 240}"
                          data-screen="${i}"></canvas>
                  ${
                    posterOf(c)
                      ? `<img class="poster" data-poster="${i}" src="${posterOf(c)}" alt="" aria-hidden="true">`
                      : ''
                  }
                  <span class="idle" data-idle="${i}">${esc(c.rom ? 'PRESS START' : c.note ?? 'EMPTY').replace(/\n/g, '<br>')}</span>
                </span>
              </span>
              <span class="panel">
                <span class="stick" aria-hidden="true"></span>
                <span class="buttons" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
              </span>
              <span class="coin" data-coin="${i}">INSERT COIN · ${PRICE} PAS</span>
            </span>
            <span class="plaque">
              <b>${esc(c.rom ? c.title : 'No cartridge')}</b>
              ${esc(c.rom ? `${c.author ?? ''}${c.license ? ' · ' + c.license : ''}` : 'this slot is waiting for a game we are allowed to show')}
            </span>
          </button>`,
        ).join('')}
      </div>

      <footer class="colophon">
        <p>Cabinets hold only games their authors permit us to show — an explicit
           licence, or permission asked for and given. Empty slots stay empty until
           then.</p>
        <p class="payer" id="payer" hidden></p>
      </footer>
    </div>`;

  root.querySelectorAll<HTMLButtonElement>('.cab').forEach((el) =>
    el.addEventListener('click', () => chooseCabinet(Number(el.dataset.i))),
  );
}

/* ---------------------------------------------------------------- the coin */

/**
 * Credits, per machine.
 *
 * One coin buys one go at the cabinet you put it in — which is what a coin
 * bought. A shared pool across the row would be a wallet, not an arcade, and it
 * would make the coin door on each machine a lie.
 */
const credits = new Map<number, number>();

/** Is the slot busy? Two taps must not become two coins. */
const paying = new Set<number>();

/**
 * Ask for a coin, then let them play.
 *
 * Every stage is shown on the cabinet itself. A signature request that opens in
 * another window with nothing said here reads as a machine that ignored you,
 * and the fix people reach for is pressing it again — which is the one thing
 * that must not cost twice.
 */
async function chooseCabinet(index: number) {
  const cab = CABINETS[index];
  if (!cab.rom || !cab.system) return; // an empty cabinet is not a door
  if (playing === index || paying.has(index)) return;

  if ((credits.get(index) ?? 0) > 0) {
    walkUp(index);
    return;
  }

  const el = root.querySelector<HTMLElement>(`[data-i="${index}"]`);
  const slot = root.querySelector<HTMLElement>(`[data-coin="${index}"]`);
  const say = (s: string) => slot && (slot.textContent = s.toUpperCase());

  paying.add(index);
  el?.classList.add('paying');

  const outcome = await insertCoin((step: CoinStep) => say(step));

  paying.delete(index);
  el?.classList.remove('paying');

  if (!outcome.paid) {
    say(outcome.why);
    // Leave the reason up long enough to read, then offer the slot again.
    setTimeout(() => say(`insert coin · ${PRICE} PAS`), 4000);
    return;
  }

  credits.set(index, (credits.get(index) ?? 0) + 1);
  say(outcome.free ? 'free play' : 'credit 1');
  walkUp(index);
}

/* ------------------------------------------------------------- the walk-up */

/**
 * Walk up to a cabinet.
 *
 * The row scales and slides until the chosen screen fills the view, rather than
 * swapping to a different layout. The neighbours stay where they are, dimmed —
 * which is what keeps it a room rather than a canvas on a page.
 *
 * The factor is measured from the live geometry, never a constant: a scale that
 * frames the screen at one window size misses at every other.
 */
function focusCabinet(index: number | null) {
  const room = root.querySelector<HTMLElement>('#room');
  const row = root.querySelector<HTMLElement>('#row');
  if (!room || !row) return;

  room.classList.toggle('playing', index !== null);
  root.querySelectorAll('.cab').forEach((el, i) => el.classList.toggle('live', i === index));

  if (index === null) {
    row.style.transition = '';
    row.style.transform = '';
    return;
  }

  const screen = root.querySelector<HTMLElement>(`[data-screen="${index}"]`);
  if (!screen) return;

  // Measure unscaled, or a second walk-up compounds the first — and measure
  // with the transition switched off, because a rect read mid-animation is the
  // interpolated one. Reading it while the row was still easing back gave a
  // screen already two-thirds scaled, so the maths asked for ×1.1 more and the
  // walk-up stopped happening at all.
  row.style.transition = 'none';
  row.style.transform = '';
  const s = screen.getBoundingClientRect(); // forces the untransformed layout
  const r = row.getBoundingClientRect();
  row.style.transition = '';
  void row.offsetHeight; // ...and flush it, so the move below animates
  if (!s.width) return;

  // Fit the screen to whatever is left after the credit bar and the way out,
  // measuring BOTH axes from the screen's own rect. Deriving the height from a
  // hardcoded 4:3 pushed the 10:9 Game Boy cabinets off the top of the window.
  const scale = Math.max(
    1,
    Math.min(3.2, (window.innerWidth - 40) / s.width, (window.innerHeight - 150) / s.height),
  );

  // Bring the screen's centre to the viewport's centre, in the row's own
  // pre-transform coordinates.
  const originX = r.left + r.width * 0.5;
  const originY = r.top + r.height * 0.3;
  const cx = s.left + s.width / 2;
  const cy = s.top + s.height / 2;
  const dx = (window.innerWidth / 2 - originX - (cx - originX) * scale) / scale;
  const dy = (window.innerHeight * 0.42 - originY - (cy - originY) * scale) / scale;

  row.style.transform = `scale(${scale}) translate(${dx}px, ${dy}px)`;
}

async function walkUp(index: number) {
  const cab = CABINETS[index];
  if (!cab.rom || !cab.system) return; // an empty cabinet is not a door
  if (playing === index) return; // already standing at it

  playing = index;
  focusCabinet(index);

  // The cabinet is a button and it keeps focus, so START and the fire buttons —
  // Enter and Space — would re-activate it under the game. Hand the keyboard to
  // the machine.
  (document.activeElement as HTMLElement | null)?.blur();

  const canvas = root.querySelector<HTMLCanvasElement>(`[data-screen="${index}"]`)!;
  const idle = root.querySelector<HTMLElement>(`[data-idle="${index}"]`);
  const poster = root.querySelector<HTMLElement>(`[data-poster="${index}"]`);
  machine?.stop();

  // The core arrives with the choice, so a cabinet nobody walks up to costs
  // nothing. Both awaits can fail: a missing chunk and a missing ROM read the
  // same to a player, and both belong on the screen rather than in the console.
  try {
    machine = await makeMachine(cab.system, canvas);
    await machine.load(cab.rom);
  } catch (e) {
    if (idle) idle.textContent = (e as Error).message.toUpperCase();
    return;
  }

  // Another cabinet may have been chosen while the core was loading; the last
  // choice wins and this one must not start behind it.
  if (playing !== index) {
    machine.stop();
    return;
  }

  // The still steps aside for the thing it was a picture of.
  idle?.remove();
  poster?.remove();
  machine.start();
  showBar(cab);
}

function leave() {
  // The credit is spent on the way out. A coin bought one go; leaving and
  // walking back up is a second go, and it costs a second coin.
  if (playing !== null) credits.set(playing, Math.max(0, (credits.get(playing) ?? 1) - 1));
  playing = null;
  machine?.stop();
  machine = null;
  root.querySelector('.leave')?.remove();
  root.querySelector('.credit')?.remove();
  focusCabinet(null);
  render();
}

/**
 * Who made this, and under what terms.
 *
 * Fixed to the viewport rather than drawn on the cabinet: a 4:3 arcade screen
 * belongs to the game, and a credit painted on it would cost picture and still
 * be harder to read.
 */
function showBar(cab: Cabinet) {
  const bar = document.createElement('p');
  bar.className = 'credit';
  bar.innerHTML = `<strong>${esc(cab.title)}</strong>${cab.author ? ' by ' + esc(cab.author) : ''}${
    cab.license ? ', under ' + esc(cab.license) : ''
  }${cab.source ? ` · <a href="${cab.source}" target="_blank" rel="noopener">source</a>` : ''}`;

  const out = document.createElement('button');
  out.className = 'leave';
  out.textContent = '< BACK TO THE ARCADE';
  out.addEventListener('click', leave);

  root.append(bar, out);
}

/* ---------------------------------------------------------------- controls */

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (playing !== null && e.code === 'Escape') {
    e.preventDefault();
    leave();
    return;
  }
  if (machine?.key(e, true)) e.preventDefault();
});

addEventListener('keyup', (e) => {
  if (machine?.key(e, false)) e.preventDefault();
});

// The walk-up is measured from the layout, so it must be recomputed when the
// layout changes underneath it.
addEventListener('resize', () => {
  if (playing !== null) focusCabinet(playing);
});

addEventListener('visibilitychange', () => {
  if (document.hidden) machine?.stop();
  else if (playing !== null) machine?.start();
});

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

render();

/*
 * Opening time.
 *
 * The shutter goes up, the tubes strike, the machines roll in. The handshake
 * with the wallet starts the moment the room is open rather than on the first
 * coin: it takes seconds it can spend while somebody is still deciding which
 * cabinet to walk to, and every failure in it is rediscovered — and reported —
 * on the coin itself.
 */
open(document.getElementById('room')!, () => {
  warmUp();
  void nameThePayer();
});

/**
 * Say whose money the coins come out of, but only when it isn't obvious.
 *
 * Paying from the player's own account needs no notice — that is what a coin
 * slot means. The app-scoped account the shell derives for arcadeonchain does:
 * it is an address the player has never seen, it holds nothing until somebody
 * sends it something, and a coin drawn on an empty one fails for a reason that
 * looks like a broken machine. Naming it is the difference between a cabinet
 * that is out of order and one that is waiting for change.
 */
async function nameThePayer() {
  const who = await payer().catch(() => null);
  const el = root.querySelector<HTMLElement>('#payer');
  if (!el || !who || who.kind !== 'app') return; // free play, or their own wallet
  el.hidden = false;
  el.textContent =
    `Coins are paid from ${who.address} — the address the Polkadot app derived for ` +
    `arcadeonchain, not your wallet. Send it a little PAS to play.`;
}

// Exposed for verification: a headless check can assert the walk-up landed and
// a cabinet is running, rather than trusting a screenshot.
//
// `frame()` hands back the emulator's own output rather than the glass. The
// visible canvas carries scanlines and phosphor glow, so a colour count taken
// off it measures the tube — every game would pass, including a dead one.
(window as unknown as { __arcade: unknown }).__arcade = {
  cabinets: CABINETS,
  playing: () => playing,
  frames: () => machine?.frames ?? 0,
  frame: () => machine?.nativeCanvas().toDataURL('image/png') ?? null,
  // Measured in the page rather than shipped out as a quarter-million numbers:
  // a frame of pixel data crosses the debug protocol as JSON, and doing that
  // sixty times a run costs more than the emulation.
  look: async () => {
    const c = machine?.nativeCanvas();
    if (!c) return null;
    const ctx = c.getContext('2d')!;
    const read = () => ctx.getImageData(0, 0, c.width, c.height).data;
    const a = read();
    const seen = new Set<number>();
    for (let i = 0; i < a.length; i += 4) seen.add((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]);
    await new Promise((r) => setTimeout(r, 250));
    const b = read();
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) changed++;
    return {
      w: c.width,
      h: c.height,
      colours: seen.size,
      changed,
      // Two parts in a thousand — enough for three balls crossing a static
      // playfield, not enough for a blinking cursor on a menu.
      moving: changed > (a.length / 4) * 0.002,
    };
  },
  walkUp,
  choose: chooseCabinet,
  credits: (i: number) => credits.get(i) ?? 0,
  // Jump the opening. A headless check should not have to sit through four
  // seconds of shutter, and clicking to skip it would be a click the room then
  // has to not misread as choosing a cabinet.
  openNow: () => {
    const room = document.getElementById('room');
    document.getElementById('shutter')?.remove();
    for (const cls of ['lifting', 'lit', 'stocked', 'open']) room?.classList.add(cls);
  },
  leave,
};


