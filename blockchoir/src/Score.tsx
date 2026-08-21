import { useEffect, useRef } from 'react';
import { PALETTE } from './chain';
import { VOICES } from './audio';

export const STEPS = 64;

/**
 * The score.
 *
 * This is the same storage the picture is drawn from, read as music: a column is
 * a moment, a row is a note, the nibble is how hard it was struck. Gavin Wood's
 * doctorate was on content-based visualisation of musical audio, and twenty
 * years later the most direct thing to do with a chain is show you what it
 * sounds like.
 */
export function Score({
  pixels,
  step,
  hover,
  onHover,
  onPick,
  preview,
}: {
  pixels: Uint8Array;
  /** column currently sounding, or -1 when stopped */
  step: number;
  hover: number | null;
  onHover: (i: number | null) => void;
  onPick: (i: number) => void;
  preview: number | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    const cw = W / STEPS, ch = H / VOICES;
    ctx.clearRect(0, 0, W, H);

    // ground, with a lane every five rows so the eye can count intervals
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#171412';
    for (let r = 0; r < VOICES; r += 1) if (r % 5 === 0) ctx.fillRect(0, r * ch, W, ch);
    ctx.strokeStyle = '#221f1d';
    ctx.lineWidth = 1;
    for (let s = 0; s <= STEPS; s += 4) {
      ctx.beginPath();
      ctx.moveTo(s * cw, 0);
      ctx.lineTo(s * cw, H);
      ctx.stroke();
    }

    // the column being played
    if (step >= 0) {
      ctx.fillStyle = 'rgba(255,38,112,0.14)';
      ctx.fillRect(step * cw, 0, cw, H);
    }

    // notes
    for (let r = 0; r < VOICES; r += 1) {
      for (let s = 0; s < STEPS; s += 1) {
        const v = pixels[r * 64 + s];
        if (!v) continue;
        const x = s * cw, y = r * ch;
        const sounding = s === step;
        ctx.fillStyle = PALETTE[v];
        const pad = sounding ? 0.5 : 1.5;
        round(ctx, x + pad, y + pad, cw - pad * 2, ch - pad * 2, 3);
        ctx.fill();
        if (sounding) {
          ctx.strokeStyle = '#fafaf9';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // the cell under the cursor
    if (hover != null) {
      const r = Math.floor(hover / 64), s = hover % 64;
      if (r < VOICES && s < STEPS) {
        ctx.strokeStyle = preview != null ? PALETTE[preview] : '#57534e';
        ctx.lineWidth = 2;
        round(ctx, s * cw + 1, r * ch + 1, cw - 2, ch - 2, 3);
        ctx.stroke();
      }
    }
  }, [pixels, step, hover, preview]);

  const locate = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const s = Math.floor(((e.clientX - b.left) / b.width) * STEPS);
    const r = Math.floor(((e.clientY - b.top) / b.height) * VOICES);
    if (s < 0 || r < 0 || s >= STEPS || r >= VOICES) return null;
    return r * 64 + s;
  };

  return (
    <canvas
      ref={ref}
      className="score"
      width={STEPS * 16}
      height={VOICES * 16}
      onMouseMove={(e) => onHover(locate(e))}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        const i = locate(e);
        if (i != null) onPick(i);
      }}
    />
  );
}

function round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
