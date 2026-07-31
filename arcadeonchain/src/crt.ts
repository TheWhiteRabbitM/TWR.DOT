/**
 * How a frame gets from the emulator to the glass.
 *
 * WHY THERE IS ANYTHING HERE AT ALL
 *   `putImageData` at native size and `image-rendering: pixelated` is honest and
 *   it looks like a screenshot. These games were never seen that way. They were
 *   drawn for a phosphor tube, and the tube was part of the art: bright pixels
 *   bloomed into their neighbours, every other line was darker than the one
 *   above it, and the whole picture sat behind curved glass. Sprite artists
 *   worked WITH that — dithering that looks like checkerboard noise on an LCD
 *   was a smooth gradient on a CRT.
 *
 *   So this is not a filter dropped on top for the look of it. It is closer to
 *   the display the pixels were authored for.
 *
 * HOW THE BLOOM IS DONE, AND WHY NOT WITH A BLUR
 *   `ctx.filter = 'blur(4px)'` on a 768x720 draw, sixty times a second, is a
 *   real cost and in some browsers it is not on the GPU at all. Downscaling to
 *   a quarter and scaling back up with smoothing on IS a blur — two tiny
 *   drawImage calls, both hardware paths, no filter string. The glow is added
 *   with `lighter`, so it only ever brightens; dark areas stay dark.
 *
 * WHY THE CANVAS IS THREE TIMES NATIVE
 *   The scanlines and the glow need somewhere to live. At native resolution
 *   there is no room between two emulated lines to put a dark one. At 3x each
 *   emulated line is three rows: two lit, one dark — which is the ratio a
 *   slot-mask tube actually showed. The upscale itself stays nearest-neighbour,
 *   so no pixel is ever softened; only the glow layered on top is smooth.
 */

/** Rows of real canvas per emulated line. Three is the smallest that fits a scanline. */
const SCALE = 3;

/** How much of the frame's own light comes back as glow. Above ~0.45 it fogs. */
const BLOOM = 0.34;

/** How dark the gap between two lines gets. A tube was nearer 0.5; that reads as broken. */
const SCANLINE = 0.26;

export class Presenter {
  private ctx: CanvasRenderingContext2D;

  /** The frame as the emulator produced it, at the machine's own resolution. */
  private native: HTMLCanvasElement;
  private nativeCtx: CanvasRenderingContext2D;

  /** A quarter-size copy of the frame. Scaled back up, it is the phosphor glow. */
  private small: HTMLCanvasElement;
  private smallCtx: CanvasRenderingContext2D;

  /** The scanline grille, built once and reused as a fill pattern. */
  private lines: CanvasPattern | null = null;

  readonly image: ImageData;

  constructor(
    private canvas: HTMLCanvasElement,
    private w: number,
    private h: number,
  ) {
    canvas.width = w * SCALE;
    canvas.height = h * SCALE;
    this.ctx = canvas.getContext('2d', { alpha: false })!;

    this.native = document.createElement('canvas');
    this.native.width = w;
    this.native.height = h;
    this.nativeCtx = this.native.getContext('2d', { alpha: false })!;
    this.image = this.nativeCtx.createImageData(w, h);

    // A quarter in each axis: small enough to be free, large enough that the
    // glow still has the shape of what is on screen.
    this.small = document.createElement('canvas');
    this.small.width = Math.max(1, w >> 2);
    this.small.height = Math.max(1, h >> 2);
    this.smallCtx = this.small.getContext('2d', { alpha: false })!;

    this.buildScanlines();
  }

  /**
   * One dark row in every SCALE, as a repeating pattern.
   *
   * Drawn into a tile rather than stroked line by line: 720 strokes a frame is
   * work for nothing when the browser can repeat a 1x3 bitmap.
   */
  private buildScanlines(): void {
    const tile = document.createElement('canvas');
    tile.width = 1;
    tile.height = SCALE;
    const t = tile.getContext('2d')!;
    t.fillStyle = `rgba(0,0,0,${SCANLINE})`;
    t.fillRect(0, SCALE - 1, 1, 1);
    this.lines = this.ctx.createPattern(tile, 'repeat');
  }

  /**
   * Put the current `image` on the glass.
   *
   * Called once per emulated frame by whichever core owns this presenter; the
   * core writes its pixels into `image` and calls this.
   */
  draw(): void {
    const { ctx, w, h } = this;
    const W = w * SCALE;
    const H = h * SCALE;

    this.nativeCtx.putImageData(this.image, 0, 0);

    // The picture itself: nearest-neighbour, so a pixel stays a pixel.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.native, 0, 0, W, H);

    // The scanlines go under the glow, not over it — a bright sprite on a CRT
    // bleeds ACROSS the dark line, it does not get cut by it.
    if (this.lines) {
      ctx.fillStyle = this.lines;
      ctx.fillRect(0, 0, W, H);
    }

    // Phosphor glow: down to a quarter and back up, added rather than blended.
    this.smallCtx.imageSmoothingEnabled = true;
    this.smallCtx.drawImage(this.native, 0, 0, this.small.width, this.small.height);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = BLOOM;
    ctx.drawImage(this.small, 0, 0, W, H);
    ctx.restore();
  }

  /**
   * The frame at the machine's own resolution.
   *
   * For anything that wants the pixels rather than the picture — the poster
   * capture, and the checks that count colours to prove a game booted. Reading
   * those off the glass would be measuring the bloom.
   */
  nativeCanvas(): HTMLCanvasElement {
    return this.native;
  }
}
