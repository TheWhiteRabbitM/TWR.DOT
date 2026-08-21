import { useEffect, useState } from 'react';

/**
 * The ring, drawn while it signs.
 *
 * A ring signature is hard to believe from a description, so this shows the
 * shape of it. Each dot is somebody enrolled. The chain of challenges runs from
 * one to the next and closes on itself, and the whole point is what you cannot
 * see: which dot it started from. The signer is in there, the arithmetic proves
 * it, and the picture is symmetrical because the mathematics is.
 *
 * Nothing here is decorative telemetry — the number of dots is the real ring
 * size, and the animation runs for exactly as long as the proof is being built.
 */
export function Ring({ size, active, done }: { size: number; active: boolean; done: boolean }) {
  const [step, setStep] = useState(0);
  const n = Math.max(2, Math.min(size, 24));

  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    const t = setInterval(() => setStep((s) => s + 1), 130);
    return () => clearInterval(t);
  }, [active]);

  const R = 46;
  const pt = (i: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [60 + R * Math.cos(a), 60 + R * Math.sin(a)] as const;
  };

  return (
    <svg className={`ring-svg ${done ? 'done' : ''}`} viewBox="0 0 120 120" role="img" aria-label={`ring of ${size}`}>
      <circle className="ring-path" cx="60" cy="60" r={R} />
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = pt(i);
        const lit = active && step % n === i;
        const passed = active && step >= i;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={lit ? 5.5 : 4}
            className={`node ${lit ? 'lit' : ''} ${passed || done ? 'passed' : ''}`}
          />
        );
      })}
      {done ? <circle className="closed" cx="60" cy="60" r={R} /> : null}
    </svg>
  );
}
