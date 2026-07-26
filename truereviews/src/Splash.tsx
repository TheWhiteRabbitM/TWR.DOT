import { useEffect, useState } from 'react';

/**
 * Launch splash — the first thing a visitor sees, so the app opens like an app,
 * not a page that pops into existence. A tinted gradient, the star mark drawn
 * with a spring, the wordmark, then the whole sheet lifts away. Total budget
 * ~1.4s; reduced-motion users get a fast fade instead (see CSS).
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  // A splash that swallows taps reads as "the app is broken" inside the host
  // shell — so any tap skips it immediately.
  const skip = () => {
    setLeaving(true);
    window.setTimeout(onDone, 300);
  };

  useEffect(() => {
    // ~3.5s on screen: long enough to land as a moment, not a flicker.
    const t1 = window.setTimeout(() => setLeaving(true), 3100);
    const t2 = window.setTimeout(onDone, 3550);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onDone]);

  return (
    <div className={`splash${leaving ? ' is-leaving' : ''}`} aria-hidden="true" onClick={skip}>
      <div className="splash-mark">
        <svg width="88" height="88" viewBox="0 0 24 24">
          <path
            className="splash-star"
            d="M12 2.4l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.8l1.1-6.5L2.6 9.2l6.5-.9z"
            fill="#fff"
          />
        </svg>
      </div>
      <div className="splash-word">TrueReviews</div>
      <div className="splash-tag">Real people. Real reviews.</div>
      <div className="splash-foot">on Polkadot</div>
    </div>
  );
}
