import { useEffect, useRef } from 'react';
import { PALETTE, SIDE } from './chain';

/**
 * The board, drawn at device resolution with smoothing off, because a pixel
 * here is a pixel in storage and softening it would be a lie about the data.
 */
export function Canvas({
  pixels,
  hover,
  onHover,
  onPick,
  preview,
}: {
  pixels: Uint8Array;
  hover: number | null;
  onHover: (i: number | null) => void;
  onPick: (i: number) => void;
  /** colour to paint under the cursor before it is committed */
  preview: number | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(SIDE, SIDE);
    for (let i = 0; i < pixels.length; i += 1) {
      const hex = PALETTE[pixels[i]] ?? PALETTE[0];
      img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
      img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i * 4 + 3] = 255;
    }
    if (hover != null && preview != null) {
      const hex = PALETTE[preview];
      img.data[hover * 4] = parseInt(hex.slice(1, 3), 16);
      img.data[hover * 4 + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[hover * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    }
    ctx.putImageData(img, 0, 0);
  }, [pixels, hover, preview]);

  const locate = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIDE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * SIDE);
    if (x < 0 || y < 0 || x >= SIDE || y >= SIDE) return null;
    return y * SIDE + x;
  };

  return (
    <canvas
      ref={ref}
      className="board"
      width={SIDE}
      height={SIDE}
      onMouseMove={(e) => onHover(locate(e))}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        const i = locate(e);
        if (i != null) onPick(i);
      }}
    />
  );
}
