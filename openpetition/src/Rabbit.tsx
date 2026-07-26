import { useEffect } from 'react';

/**
 * The white rabbit. Hops across the screen once, then unmounts itself.
 * Inert (`pointer-events: none`) and self-cleaning: `animationend` plus a
 * timer fallback for pages that are not compositing.
 */
export function Rabbit({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 6200);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="rabbit-lane" aria-hidden="true" onAnimationEnd={onDone}>
      <div className="rabbit-hop">
        <svg className="rabbit" viewBox="0 0 64 48">
          <g fill="#fff" stroke="#1E2134" strokeWidth="1.6" strokeLinejoin="round">
            <ellipse cx="40" cy="11" rx="2.8" ry="9" transform="rotate(-14 40 11)" />
            <ellipse cx="47" cy="12" rx="2.8" ry="9" transform="rotate(5 47 12)" />
            <circle cx="44.5" cy="25" r="7.5" />
            <ellipse cx="26" cy="30" rx="16" ry="11" />
            <circle cx="10.5" cy="26" r="4.2" />
            <ellipse cx="20" cy="39" rx="7.5" ry="4" />
            <ellipse cx="38" cy="39.5" rx="5" ry="3" />
          </g>
          <circle cx="47.5" cy="23" r="1.3" fill="#E6007A" />
        </svg>
      </div>
    </div>
  );
}

const CODE = '4815162342';

/** Keyboard-only easter egg: type the numbers, anywhere on the page. */
export function useRabbitSequence(onMatch: () => void) {
  useEffect(() => {
    let buffer = '';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.length !== 1 || event.key < '0' || event.key > '9') return;
      buffer = (buffer + event.key).slice(-CODE.length);
      if (buffer === CODE) {
        buffer = '';
        onMatch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onMatch]);
}
