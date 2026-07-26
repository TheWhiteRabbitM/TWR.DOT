import { useEffect, useRef, useState } from 'react';

/**
 * The dashboard's mascot: an original coin-creature drawn from scratch.
 *
 * Deliberately not the $WUD project's artwork and not a likeness of any real
 * person — this page needs a face of its own rather than borrowing a brand.
 * The pupils track the pointer, which is what makes it read as a character
 * rather than a logo.
 */
export function Mascot({ size = 200 }: { size?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      // Clamp so pupils stay inside the eye whites.
      const reach = Math.min(dist, 260) / 260;
      setLook({ x: (dx / dist) * 3.6 * reach, y: (dy / dist) * 3.2 * reach });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  return (
    <svg
      ref={ref}
      className="mascot"
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label="WUD community mascot"
    >
      <defs>
        <radialGradient id="body" cx="36%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#ff6fb5" />
          <stop offset="55%" stopColor="#e6007a" />
          <stop offset="100%" stopColor="#8d004a" />
        </radialGradient>
        <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.25" />
        </linearGradient>
        <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* ground shadow */}
      <ellipse cx="100" cy="176" rx="46" ry="9" fill="#000" opacity="0.45" filter="url(#soft)" />

      <g className="mascot-bob">
        {/* arms */}
        <g stroke="#c0006a" strokeWidth="9" strokeLinecap="round" fill="none">
          <path className="arm-left" d="M46 112c-12 6-18 14-19 24" />
          <path className="arm-right" d="M154 112c12 6 18 14 19 24" />
        </g>

        {/* coin body */}
        <circle cx="100" cy="98" r="62" fill="url(#body)" />
        <circle cx="100" cy="98" r="62" fill="url(#rim)" />
        <circle cx="100" cy="98" r="62" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="3" />
        <circle cx="100" cy="98" r="50" fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="2" />

        {/* engraved W */}
        <path
          d="M74 78l9 34 11-24 11 24 9-34"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.22"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* eyes */}
        <g className="mascot-eyes">
          <ellipse cx="80" cy="90" rx="14" ry="15" fill="#fff" />
          <ellipse cx="120" cy="90" rx="14" ry="15" fill="#fff" />
          <circle cx={80 + look.x} cy={92 + look.y} r="6.4" fill="#220d18" />
          <circle cx={120 + look.x} cy={92 + look.y} r="6.4" fill="#220d18" />
          <circle cx={77.6 + look.x} cy={89 + look.y} r="2.1" fill="#fff" opacity="0.9" />
          <circle cx={117.6 + look.x} cy={89 + look.y} r="2.1" fill="#fff" opacity="0.9" />
        </g>

        {/* blush */}
        <ellipse cx="62" cy="112" rx="9" ry="5.5" fill="#ff9ed0" opacity="0.5" />
        <ellipse cx="138" cy="112" rx="9" ry="5.5" fill="#ff9ed0" opacity="0.5" />

        {/* grin */}
        <path
          d="M78 120c7 10 37 10 44 0"
          stroke="#fff"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
      </g>

      {/* sparkles */}
      <g className="mascot-spark">
        <path d="M168 44l3.4 8.4 8.4 3.4-8.4 3.4L168 68l-3.4-8.8-8.4-3.4 8.4-3.4z" fill="#ffd166" />
      </g>
      <g className="mascot-spark2">
        <path d="M32 58l2.4 6 6 2.4-6 2.4L32 75l-2.4-6.2-6-2.4 6-2.4z" fill="#7ee2a8" />
      </g>
    </svg>
  );
}
