import { useState } from 'react';

const PATH =
  'M12 2.4l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.8l1.1-6.5L2.6 9.2l6.5-.9z';

function Star({ fill }: { fill: 'full' | 'half' | 'empty' }) {
  const id = `h${Math.round(Math.random() * 1e6)}`;
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      {fill === 'half' && (
        <defs>
          <linearGradient id={id}>
            <stop offset="50%" stopColor="currentColor" />
            <stop offset="50%" stopColor="transparent" />
          </linearGradient>
        </defs>
      )}
      <path
        d={PATH}
        fill={fill === 'full' ? 'currentColor' : fill === 'half' ? `url(#${id})` : 'transparent'}
        stroke="currentColor"
        strokeWidth={fill === 'empty' ? 1.4 : 0}
        opacity={fill === 'empty' ? 0.32 : 1}
      />
    </svg>
  );
}

/** Read-only star rating, supports halves. */
export function Stars({ value, size }: { value: number; size?: 'lg' }) {
  return (
    <span
      className={`stars${size === 'lg' ? ' lg' : ''}`}
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const d = value - i;
        return <Star key={i} fill={d >= 0.75 ? 'full' : d >= 0.25 ? 'half' : 'empty'} />;
      })}
    </span>
  );
}

const BIG =
  'M12 2l2.9 6.3 6.9.9-5 4.9 1.2 6.9L12 17.8 5.9 21l1.2-6.9-5-4.9 6.9-.9z';

/** Interactive rating picker with a spring pop on the chosen star. */
export function RatePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [popped, setPopped] = useState<number | null>(null);
  return (
    <div className="rate" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={`${n <= value ? 'on' : ''} ${popped === n ? 'pop' : ''}`}
          onClick={() => {
            onChange(n);
            setPopped(n);
            window.setTimeout(() => setPopped((p) => (p === n ? null : p)), 360);
          }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d={BIG}
              fill={n <= value ? 'currentColor' : 'transparent'}
              stroke="currentColor"
              strokeWidth={n <= value ? 0 : 1.5}
              opacity={n <= value ? 1 : 0.35}
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
