/**
 * A rating, drawn the way a shopper reads one.
 *
 * Five glyphs with a clipped overlay rather than rounding to the nearest whole
 * star: 4.4 and 4.6 are a real difference to someone choosing between two
 * sellers, and rounding both to "four stars" throws away the only signal the
 * contract went to the trouble of making unforgeable.
 *
 * `count` is not decoration either. 5.0 from one sale and 4.6 from ninety are
 * opposite claims, and showing the average alone flatters the first.
 */
export function Stars({ x100, count }: { x100: number; count: number }) {
  if (count === 0) {
    return <span className="rating none">no reviews yet</span>;
  }
  const pct = Math.max(0, Math.min(100, (x100 / 500) * 100));
  return (
    <span className="rating" title={`${(x100 / 100).toFixed(2)} out of 5 from ${count}`}>
      <span className="stars-track" aria-hidden="true">
        <span className="stars-off">★★★★★</span>
        <span className="stars-on" style={{ width: `${pct}%` }}>
          ★★★★★
        </span>
      </span>
      <span className="rating-n">{count}</span>
      <span className="sr">
        {(x100 / 100).toFixed(1)} out of 5 from {count} {count === 1 ? 'review' : 'reviews'}
      </span>
    </span>
  );
}

/**
 * Amazon's price shape: the whole number carries the weight and the decimals
 * ride small and high. It reads faster in a grid than one flat number, which is
 * the entire job of a price in a grid.
 *
 * WITH ONE CORRECTION, because the shape only works on currency.
 * Amazon can raise the fraction because a dollar price always has exactly two
 * decimals, so a small "99" beside a large "12" can only mean 12.99. Here the
 * fraction is whatever the price happens to be: 1.2 rendered as a large 1 and a
 * small 2 reads equally as 1.2 or 1.02, and on a market that is not a cosmetic
 * problem.
 *
 * So one and two digit fractions are padded to two — 1.2 becomes 1 and "20",
 * which is unambiguous and still currency-shaped. Anything longer keeps a
 * full-size decimal point instead, because a raised "0001" is a puzzle.
 */
export function Price({ text, unit = 'PAS' }: { text: string; unit?: string }) {
  const [whole, frac = ''] = text.split('.');
  if (frac.length > 2) {
    return (
      <span className="pricetag">
        <span className="cur">{unit}</span>
        <span className="whole">
          {whole}.{frac}
        </span>
      </span>
    );
  }
  return (
    <span className="pricetag">
      <span className="cur">{unit}</span>
      <span className="whole">{whole}</span>
      <span className="frac">{frac ? frac.padEnd(2, '0') : '00'}</span>
    </span>
  );
}
