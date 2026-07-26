import { useEffect, useState } from 'react';

const CHECK = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.2 14.2l-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z" />
  </svg>
);

/** Launch moment (~3.5s): the lock mark, the promise, then it lifts away. */
export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  // A splash that swallows taps reads as "the app is broken" in the host
  // shell — any tap skips it immediately.
  const skip = () => {
    setLeaving(true);
    window.setTimeout(onDone, 300);
  };

  useEffect(() => {
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
        <svg width="64" height="64" viewBox="0 0 32 32">
          <path
            d="M16 4c-4.4 0-8 3.6-8 8v4c0 4.4 3.6 8 8 8s8-3.6 8-8v-4c0-4.4-3.6-8-8-8z"
            fill="none"
            stroke="#3fb6a8"
            strokeWidth="2.4"
          />
          <circle cx="16" cy="15" r="3.4" fill="#3fb6a8" />
          <path d="M16 18.4V23" stroke="#3fb6a8" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </div>
      <div className="splash-word">Discreet</div>
      <div className="splash-tag">Private bookings for real people</div>
      <div className="splash-points">
        <span>{CHECK} No name, no phone, no email — ever</span>
        <span>{CHECK} One verified human per booking</span>
        <span>{CHECK} Deposits held in escrow, not by us</span>
      </div>
      <div className="splash-foot">on Polkadot</div>
    </div>
  );
}
