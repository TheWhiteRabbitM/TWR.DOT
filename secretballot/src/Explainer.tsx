import { useEffect, useState } from 'react';

/**
 * How it works, shown rather than described.
 *
 * "Linkable ring signature" means nothing to anyone the first time they read it,
 * and the property it buys — a ballot that proves who may vote without recording
 * who did — is the whole reason to be here. So it gets five drawings and
 * twenty seconds, on the way in, once.
 */
const STEPS = [
  {
    k: 'enrol',
    title: 'Your mask joins once',
    body: 'Identity is used at the door and nowhere else: your mask enrols before anybody has voted, and the poll learns that one more person may answer.',
  },
  {
    k: 'ring',
    title: 'Everyone enrolled forms a ring',
    body: 'The ring is public. Being in it says you are allowed to vote. It says nothing about whether you have.',
  },
  {
    k: 'sign',
    title: 'A ballot is proved, not signed',
    body: 'The proof runs around the whole ring and closes on itself. It only closes if one of these keys was known — and the arithmetic leaves no trace of which one.',
  },
  {
    k: 'image',
    title: 'One key, one ballot',
    body: 'Each voter also produces a key image: the same value every time they vote here, and unrelated to their identity. A second ballot carrying it is refused. The first stays anonymous.',
  },
  {
    k: 'count',
    title: 'The count is public, the ballot is not',
    body: 'Anyone can verify the tally and nobody can verify how you voted, which is what a secret ballot has always meant.',
  },
] as const;

const N = 9;

export function Explainer({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => {
      if (i < STEPS.length - 1) setI(i + 1);
    }, i === 2 ? 5200 : 4200);
    return () => clearTimeout(t);
  }, [i, paused]);

  const step = STEPS[i];
  const pt = (k: number, r = 40) => {
    const a = (k / N) * Math.PI * 2 - Math.PI / 2;
    return [80 + r * Math.cos(a), 70 + r * Math.sin(a)] as const;
  };

  return (
    <section
      className="explainer"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className={`stage s-${step.k}`}>
        <svg viewBox="0 0 160 140" role="img" aria-label={step.title}>
          {/* the door: a mask arriving, only on the first step */}
          <g className="door">
            <rect x="6" y="52" width="26" height="34" rx="5" />
            <circle cx="19" cy="63" r="5" />
            <path d="M9 82 q10 -10 20 0" />
          </g>

          {/* the ring itself */}
          <circle className="orbit" cx="80" cy="70" r="40" />
          {Array.from({ length: N }, (_, k) => {
            const [x, y] = pt(k);
            return <circle key={k} className="member" style={{ ['--k' as string]: String(k) }} cx={x} cy={y} r="5" />;
          })}

          {/* the chain of challenges, drawn as chords that light in turn */}
          {Array.from({ length: N }, (_, k) => {
            const [x1, y1] = pt(k);
            const [x2, y2] = pt((k + 1) % N);
            return (
              <line
                key={k}
                className="link"
                style={{ ['--k' as string]: String(k) }}
                x1={x1} y1={y1} x2={x2} y2={y2}
              />
            );
          })}

          {/* the key image: one stamp, then a duplicate turned away */}
          <g className="stamp first">
            <rect x="112" y="102" width="30" height="22" rx="4" />
            <path d="M118 113 h18" />
          </g>
          <g className="stamp second">
            <rect x="112" y="102" width="30" height="22" rx="4" />
            <path d="M116 106 l22 14 M138 106 l-22 14" className="cross" />
          </g>

          {/* the tally */}
          <g className="tally">
            <rect className="b1" x="18" y="118" width="34" height="8" rx="4" />
            <rect className="b2" x="18" y="106" width="52" height="8" rx="4" />
          </g>
        </svg>
      </div>

      <div className="words">
        <div className="steps">
          {STEPS.map((s, k) => (
            <button
              key={s.k}
              className={`pipd ${k === i ? 'on' : ''} ${k < i ? 'past' : ''}`}
              onClick={() => setI(k)}
              aria-label={s.title}
            />
          ))}
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="ex-foot">
          {i < STEPS.length - 1 ? (
            <button className="linkish" onClick={() => setI(i + 1)}>next</button>
          ) : null}
          <button className="linkish" onClick={onDone}>
            {i === STEPS.length - 1 ? 'go to the referenda' : 'skip'}
          </button>
        </div>
      </div>
    </section>
  );
}
