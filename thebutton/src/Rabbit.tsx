/**
 * The white rabbit. Hops across the screen once, then unmounts itself.
 *
 * Purely decorative and inert: `pointer-events: none` so it can never sit
 * between the user and the button.
 */
import { useEffect } from 'react';

export function Rabbit({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    // `animationend` never fires while the page is not compositing — a hidden
    // tab, a background window, or a browser that honours reduced motion by
    // dropping the animation. Without this fallback the rabbit would be
    // stranded on screen. Slightly longer than the 5.2s crossing.
    const timer = setTimeout(onDone, 6200);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="rabbit-lane" aria-hidden="true" onAnimationEnd={onDone}>
      <div className="rabbit-hop">
        <svg className="rabbit" viewBox="0 0 64 48" fill="currentColor">
          {/* ears */}
          <ellipse cx="40" cy="11" rx="2.8" ry="9" transform="rotate(-14 40 11)" />
          <ellipse cx="47" cy="12" rx="2.8" ry="9" transform="rotate(5 47 12)" />
          {/* head */}
          <circle cx="44.5" cy="25" r="7.5" />
          {/* body */}
          <ellipse cx="26" cy="30" rx="16" ry="11" />
          {/* tail */}
          <circle cx="10.5" cy="26" r="4.2" />
          {/* hind + front leg */}
          <ellipse cx="20" cy="39" rx="7.5" ry="4" />
          <ellipse cx="38" cy="39.5" rx="5" ry="3" />
          {/* eye */}
          <circle cx="47.5" cy="23" r="1.3" fill="#0b0c0e" />
        </svg>
      </div>
    </div>
  );
}
