/**
 * SF Symbol shapes, drawn.
 *
 * The store used Unicode characters for its glyphs — ★ for a rating, ⌕ for
 * search, ‹ for back, ☀/☾ for appearance. Every one of those renders as
 * whatever the platform's emoji or text font happens to contain: on Windows the
 * star is a different star, the magnifier is a different magnifier, and the moon
 * is sometimes in colour. That is the fastest way to make an interface look
 * *almost* like Apple's.
 *
 * These are the SF Symbols geometries as paths, so the shape is the same
 * everywhere and inherits `currentColor` and the surrounding font size. Stroked
 * symbols use round caps and joins, which is what gives SF Symbols their soft
 * ends; filled symbols are single paths.
 *
 * Sizes follow Apple's optical convention: the glyph is drawn in a square box
 * and sized in `em`, so it scales with the text it sits beside rather than
 * needing a pixel value at every call site.
 */

interface GlyphProps {
  /** Size in em, relative to the surrounding text. Apple's default is ~1em. */
  size?: number;
  className?: string;
  title?: string;
}

function box(size: number | undefined, className: string | undefined, title: string | undefined) {
  return {
    width: `${size ?? 1}em`,
    height: `${size ?? 1}em`,
    viewBox: '0 0 16 16',
    fill: 'none' as const,
    xmlns: 'http://www.w3.org/2000/svg',
    className,
    role: title ? ('img' as const) : undefined,
    'aria-hidden': title ? undefined : (true as const),
    'aria-label': title,
    focusable: false,
  };
}

/** `magnifyingglass` — a circle and a handle at 45°, stroked. */
export function Magnifier(p: GlyphProps) {
  return (
    <svg {...box(p.size, p.className, p.title)}>
      <circle
        cx="6.6"
        cy="6.6"
        r="4.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M10.1 10.1 L14 14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** `chevron.left` — the back glyph. Apple's is noticeably narrow and tall. */
export function ChevronLeft(p: GlyphProps) {
  return (
    <svg {...box(p.size, p.className, p.title)}>
      <path
        d="M10.2 2.6 L4.9 8 l5.3 5.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * `star.fill` — the five-pointed star, filled.
 *
 * Apple's star is wider than the geometric pentagram and its inner radius is
 * larger, which makes the arms shorter and blunter than the star you get from
 * the ★ character in most fonts.
 */
export function StarFill(p: GlyphProps) {
  return (
    <svg {...box(p.size, p.className, p.title)}>
      <path
        d="M8 1.35 5.94 5.6 1.3 6.24l3.38 3.2-.83 4.6L8 11.86l4.15 2.18-.83-4.6 3.38-3.2-4.64-.64z"
        fill="currentColor"
      />
    </svg>
  );
}

/** `star` — the same outline, unfilled, for the empty half of a rating. */
export function StarOutline(p: GlyphProps) {
  return (
    <svg {...box(p.size, p.className, p.title)}>
      <path
        d="M8 1.35 5.94 5.6 1.3 6.24l3.38 3.2-.83 4.6L8 11.86l4.15 2.18-.83-4.6 3.38-3.2-4.64-.64z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** `circle.lefthalf.filled` — Apple's own glyph for "match the system". */
export function CircleHalf(p: GlyphProps) {
  return (
    <svg {...box(p.size, p.className, p.title)}>
      <circle cx="8" cy="8" r="6.1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1.9 A6.1 6.1 0 0 0 8 14.1 Z" fill="currentColor" />
    </svg>
  );
}

/** `sun.max.fill` — a disc with eight rays. */
export function SunFill(p: GlyphProps) {
  return (
    <svg {...box(p.size, p.className, p.title)}>
      <circle cx="8" cy="8" r="3.1" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M8 .9V2.5M8 13.5v1.6M.9 8h1.6M13.5 8h1.6" />
        <path d="M2.98 2.98 4.1 4.1M11.9 11.9l1.12 1.12M13.02 2.98 11.9 4.1M4.1 11.9l-1.12 1.12" />
      </g>
    </svg>
  );
}

/** `moon.fill` — the crescent, cut by a second circle rather than drawn freehand. */
export function MoonFill(p: GlyphProps) {
  return (
    <svg {...box(p.size, p.className, p.title)}>
      <path
        d="M13.4 10.35A5.9 5.9 0 0 1 6.05 2.7a6.35 6.35 0 1 0 7.35 7.65z"
        fill="currentColor"
      />
    </svg>
  );
}
