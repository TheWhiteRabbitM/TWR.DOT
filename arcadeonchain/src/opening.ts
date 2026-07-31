/**
 * Opening time.
 *
 * The shutter goes up, the tubes strike, and the three machines roll into the
 * room. It runs once and then the arcade is just open.
 *
 * WHY THE ROOM IS ALREADY THERE BEHIND IT
 *   The shutter is a layer over a room that is fully built and fully working.
 *   Nothing here gates anything: if this file throws, if an animation never
 *   fires, if someone lands with reduced-motion on — the fallback below strips
 *   the shutter and the arcade is open. An entrance that can lock the door is
 *   not an entrance, it is a bug with a curtain.
 *
 * WHY IT IS ONCE PER SESSION
 *   A shutter is a lovely thing to watch and a terrible thing to sit through on
 *   every reload while you are trying to play. It plays on arrival and is
 *   skipped for the rest of the session; a click or a key skips it on the spot.
 */

/** How long the whole thing takes, and what happens when. */
const CUES = [
  /* the shutter starts to lift — a beat first, so the closed sign is read */
  { at: 650, cls: 'lifting' },
  /* the tubes strike while it is still rising, so the light spills out under it */
  { at: 1250, cls: 'lit' },
  /* the machines roll in */
  { at: 2500, cls: 'stocked' },
  /* open for business: shutter gone, coin slots blinking */
  { at: 3500, cls: 'open' },
] as const;

const ONCE = 'arcade-opened';

/** The bar and the slats, plus the sign that says we are shut. */
const SHUTTER = `
  <div class="shutter" id="shutter">
    <div class="curtain"></div>
    <div class="housing"></div>
    <p class="closed">
      <b>ARCADE ON CHAIN</b>
      <span>opening</span>
    </p>
  </div>`;

/**
 * Play it, unless it has been played.
 *
 * @param room  the `.room` element every cue class lands on
 * @param onOpen called exactly once, whether the sequence ran, was skipped, or
 *        failed — this is where the arcade actually starts working.
 */
export function open(room: HTMLElement, onOpen: () => void): void {
  const skip =
    sessionStorage.getItem(ONCE) === '1' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  let done = false;
  const timers: number[] = [];

  // The cue lands on the room AND on the shutter: the shutter is a fixed
  // overlay, not something a sibling selector should have to find.
  const cue = (cls: string) => {
    room.classList.add(cls);
    document.getElementById('shutter')?.classList.add(cls);
  };

  const finish = () => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    // `shut` stays. It marks that the sequence ran at all, and every "not yet"
    // rule is written as `.shut:not(.lit)` and so on — so a room carrying all
    // four cues is fully open, and a room carrying none of them (reduced
    // motion, a second visit, a failed import) is open too.
    for (const c of CUES) cue(c.cls);
    document.getElementById('shutter')?.remove();
    removeEventListener('pointerdown', finish);
    removeEventListener('keydown', finish);
    sessionStorage.setItem(ONCE, '1');
    onOpen();
  };

  if (skip) {
    finish();
    return;
  }

  room.classList.add('shut');
  room.insertAdjacentHTML('afterend', SHUTTER);

  for (const c of CUES) {
    timers.push(setTimeout(() => cue(c.cls), c.at));
  }
  // The shutter is a fixed overlay: it must go, or nothing under it is
  // clickable. Tied to the last cue rather than to a transition event, because
  // a transition that never starts never ends either.
  timers.push(setTimeout(finish, CUES[CUES.length - 1].at));

  // Anyone who has seen it once can get past it immediately.
  addEventListener('pointerdown', finish, { once: true });
  addEventListener('keydown', finish, { once: true });

  // Last resort. If a cue is dropped or a timer is throttled in a background
  // tab, the room still opens.
  timers.push(setTimeout(finish, 8000));
}
