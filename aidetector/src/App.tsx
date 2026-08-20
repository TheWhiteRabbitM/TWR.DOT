import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AIDetector, { type Issue, type Result } from './detector.js';
import { editsFor, notesFor, applyEdit, REWRITES, type Edit } from './fix';
import { SAMPLES } from './samples';

/**
 * Is it AI? — paste text, see the patterns, fix the ones a machine can fix.
 *
 * Everything happens in this tab. The text is never uploaded, because it never
 * needs to be: the detector is a few hundred rules and some arithmetic, and it
 * runs in a millisecond on a paragraph. An app that promised privacy while
 * posting your draft to a server would be the wrong shape for this ecosystem.
 */
export function App() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'general' | 'technical'>('general');
  const [applied, setApplied] = useState<string[]>([]);
  const [tab, setTab] = useState<'findings' | 'fix'>('findings');

  const result: Result | null = useMemo(() => {
    if (text.trim().length < 40) return null;
    try {
      return AIDetector.analyzeText(text, { contextMode: mode });
    } catch {
      return null;
    }
  }, [text, mode]);

  const edits = useMemo(() => (result ? editsFor(text, result.issues) : []), [result, text]);
  const notes = useMemo(() => (result ? notesFor(result.issues) : []), [result]);
  const rewrites = useMemo(() => REWRITES.filter((r) => r.applies(text)), [text]);

  const doEdit = useCallback((e: Edit) => {
    setText((t) => applyEdit(t, e));
    setApplied((a) => [`${e.from} → ${e.to}`, ...a].slice(0, 12));
  }, []);

  const fixEverything = useCallback(() => {
    setText((t) => {
      let next = t;
      for (const r of REWRITES) if (r.applies(next)) next = r.run(next);
      let pass = AIDetector.analyzeText(next, { contextMode: mode });
      for (let i = 0; i < 3; i += 1) {
        const list = editsFor(next, pass.issues);
        if (!list.length) break;
        for (const e of list) next = applyEdit(next, e);
        pass = AIDetector.analyzeText(next, { contextMode: mode });
      }
      return next;
    });
    setApplied((a) => ['everything a machine can fix', ...a].slice(0, 12));
  }, [mode]);

  return (
    <div className="page">
      <Header />
      <main className="grid">
        <section className="pane">
          <div className="pane-head">
            <h2>Your text</h2>
            <div className="seg">
              <button className={mode === 'general' ? 'on' : ''} onClick={() => setMode('general')}>
                general
              </button>
              <button className={mode === 'technical' ? 'on' : ''} onClick={() => setMode('technical')}>
                technical
              </button>
            </div>
          </div>
          <textarea
            value={text}
            spellCheck={false}
            placeholder="Paste anything: a blog post, a PR description, an email you are about to send."
            onChange={(e) => setText(e.target.value)}
          />
          <div className="under">
            <span className="na">
              {text.trim() ? `${text.trim().split(/\s+/).length} words` : 'nothing yet'}
              {text.trim().length > 0 && text.trim().length < 40 ? ' · needs about 40 characters' : ''}
            </span>
            <span className="samples">
              {SAMPLES.map((s) => (
                <button key={s.name} onClick={() => { setText(s.text); setApplied([]); }}>
                  {s.name}
                </button>
              ))}
              {text ? <button onClick={() => { setText(''); setApplied([]); }}>clear</button> : null}
            </span>
          </div>
        </section>

        <section className="pane verdict">
          <Verdict result={result} />
        </section>
      </main>

      {result ? (
        <section className="results">
          <div className="tabs">
            <button className={tab === 'findings' ? 'on' : ''} onClick={() => setTab('findings')}>
              What it found <em>{result.issues.length}</em>
            </button>
            <button className={tab === 'fix' ? 'on' : ''} onClick={() => setTab('fix')}>
              Fix it <em>{edits.length + rewrites.length}</em>
            </button>
          </div>
          {tab === 'findings' ? (
            <Findings issues={notes.length ? notes : result.issues} all={result.issues} />
          ) : (
            <FixPanel
              edits={edits}
              rewrites={rewrites}
              applied={applied}
              onEdit={doEdit}
              onRewrite={(r) => {
                setText((t) => r.run(t));
                setApplied((a) => [r.label.toLowerCase(), ...a].slice(0, 12));
              }}
              onAll={fixEverything}
            />
          )}
        </section>
      ) : (
        <Empty hasText={text.trim().length > 0} />
      )}
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------- header ----- */
function Header() {
  return (
    <header className="top">
      <div className="brand">
        <span className="dot" aria-hidden="true" />
        <h1>Is it AI?</h1>
      </div>
      <p className="tagline">
        Paste text. See which AI writing patterns are in it, where they are, and what to write
        instead. Nothing leaves this tab.
      </p>
    </header>
  );
}

/* ------------------------------------------------------------ verdict ----- */
/** The number, drawn. A ring that sweeps and a figure that counts, because a
 *  score that simply appears reads as an assertion; one that moves reads as a
 *  measurement. */
function Verdict({ result }: { result: Result | null }) {
  const target = result?.score ?? 0;
  const shown = useCounter(target);
  const R = 68;
  const C = 2 * Math.PI * R;

  const tone = target >= 60 ? 'hot' : target >= 25 ? 'warm' : 'cool';

  return (
    <div className={`verdict-in ${result ? 'live' : 'idle'} ${tone}`}>
      <div className="ring-wrap">
        <svg viewBox="0 0 160 160" className="ring" role="img" aria-label={`score ${target} of 100`}>
          <circle className="ring-bg" cx="80" cy="80" r={R} />
          <circle
            className="ring-fg"
            cx="80"
            cy="80"
            r={R}
            style={{ strokeDasharray: C, strokeDashoffset: C - (C * (result ? target : 0)) / 100 }}
          />
        </svg>
        <div className="ring-mid">
          <span className="score">{result ? shown : '—'}</span>
          <span className="of">/100</span>
        </div>
      </div>
      <p className="label">{result ? result.label : 'waiting for text'}</p>
      {result ? (
        <>
          <Probabilities p={result.class_probabilities} />
          <dl className="facts">
            <div>
              <dt>words</dt>
              <dd>{String(result.stats.wordCount)}</dd>
            </div>
            <div>
              <dt>findings</dt>
              <dd>{result.issues.length}</dd>
            </div>
            <div>
              <dt>confidence</dt>
              <dd>{result.confidence_category}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="na hint">
          Forty characters is enough to start. The score is 0 for writing with no tells in it, and
          climbs as they stack up.
        </p>
      )}
    </div>
  );
}

function Probabilities({ p }: { p: { human: number; mixed: number; ai: number } }) {
  const row = [
    { k: 'human', v: p.human },
    { k: 'mixed', v: p.mixed },
    { k: 'ai', v: p.ai },
  ];
  return (
    <div className="probs">
      {row.map((r, i) => (
        <div className="prob" key={r.k} style={{ ['--i' as string]: String(i) }}>
          <span className="prob-k">{r.k}</span>
          <span className="prob-bar">
            <i className={`fill ${r.k}`} style={{ width: `${Math.round(r.v * 100)}%` }} />
          </span>
          <span className="prob-v">{Math.round(r.v * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/** Count toward a target with an ease-out, honouring reduced motion. */
function useCounter(target: number) {
  const [n, setN] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const dur = 520;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setN(Math.round(a + (target - a) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    // rAF does not run in a hidden tab, and a score frozen at its old value
    // would be worse than no animation at all. Land it either way.
    const settle = setTimeout(() => {
      setN(target);
      from.current = target;
    }, dur + 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [target]);
  return n;
}

/* ------------------------------------------------------------ findings ---- */
const PRETTY: Record<string, string> = {
  tier1: 'overused word',
  tier2: 'overused word',
  tier3: 'overused word',
  tier1_phrase: 'stock phrase',
  tier3_phrase: 'stock phrase',
  'em-dash': 'em dashes',
  formatting: 'formatting',
  'hollow-intensifier': 'hollow intensifier',
  'copula-avoidance': 'says serves as, means is',
  'negative-parallelism': 'not X but Y',
  'vague-attribution': 'vague attribution',
  'significance-inflation': 'inflated significance',
  'chatbot-artifact': 'chatbot artifact',
  'generic-conclusion': 'formulaic ending',
  filler: 'filler',
  'title-case-heading': 'title case heading',
  'rule-of-three': 'rule of three',
};
const pretty = (t: string) => PRETTY[t] ?? t.replace(/[-_]/g, ' ');

function Findings({ issues, all }: { issues: Issue[]; all: Issue[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of all) {
      const k = pretty(i.type);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [all]);

  if (!all.length) {
    return (
      <div className="clean">
        <span className="tick" aria-hidden="true">
          ✓
        </span>
        <p>
          Nothing flagged. That does not certify a human wrote it, and no tool can. It means the
          patterns this looks for are not here.
        </p>
      </div>
    );
  }

  return (
    <div className="cards">
      {groups.map(([name, list], gi) => (
        <article className="card" key={name} style={{ ['--i' as string]: String(gi) }}>
          <header>
            <h3>{name}</h3>
            <span className="count">{list.length}</span>
          </header>
          <ul>
            {list.slice(0, 6).map((i, k) => (
              <li key={`${i.text}-${k}`}>
                <code>{i.text}</code>
                {i.suggestion ? <span className="arrow">→ {i.suggestion}</span> : null}
              </li>
            ))}
          </ul>
          {list.length > 6 ? <p className="na more">and {list.length - 6} more</p> : null}
        </article>
      ))}
      <p className="na credit-line">
        {issues.length} distinct {issues.length === 1 ? 'pattern' : 'patterns'} across {all.length}{' '}
        {all.length === 1 ? 'finding' : 'findings'}.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- fix ---- */
function FixPanel({
  edits,
  rewrites,
  applied,
  onEdit,
  onRewrite,
  onAll,
}: {
  edits: Edit[];
  rewrites: typeof REWRITES;
  applied: string[];
  onEdit: (e: Edit) => void;
  onRewrite: (r: (typeof REWRITES)[number]) => void;
  onAll: () => void;
}) {
  const total = edits.length + rewrites.length;
  if (!total) {
    return (
      <div className="clean">
        <span className="tick" aria-hidden="true">
          ✓
        </span>
        <p>
          Nothing left that a machine should touch. What remains, if anything, is in the findings
          tab and needs a person: a claim to make specific, a sentence to cut.
        </p>
      </div>
    );
  }
  return (
    <div className="fix">
      <div className="fix-head">
        <p className="na">
          These are swaps, not judgement. Everything here is reversible, and the text stays yours.
        </p>
        <button className="primary" onClick={onAll}>
          Fix all {total}
        </button>
      </div>

      {rewrites.length ? (
        <div className="cards">
          {rewrites.map((r, i) => (
            <article className="card act" key={r.id} style={{ ['--i' as string]: String(i) }}>
              <header>
                <h3>{r.label}</h3>
                <button onClick={() => onRewrite(r)}>apply</button>
              </header>
              <p className="na">{r.detail}</p>
            </article>
          ))}
        </div>
      ) : null}

      {edits.length ? (
        <ul className="swaps">
          {edits.map((e, i) => (
            <li key={e.from} style={{ ['--i' as string]: String(i) }}>
              <code className="was">{e.from}</code>
              <span className="arrow">→</span>
              <code className="now">{e.to}</code>
              {e.count > 1 ? <span className="na times">×{e.count}</span> : null}
              <button onClick={() => onEdit(e)}>swap</button>
            </li>
          ))}
        </ul>
      ) : null}

      {applied.length ? (
        <div className="log">
          <h4>Done</h4>
          <ul>
            {applied.map((a, i) => (
              <li key={`${a}-${i}`}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- rest ---- */
function Empty({ hasText }: { hasText: boolean }) {
  return (
    <section className="empty">
      <p>
        {hasText
          ? 'A little more text and the reading starts.'
          : 'Paste something above, or try one of the samples.'}
      </p>
      <div className="tells">
        {[
          ['delve, robust, seamless', 'words that cluster in generated prose'],
          ['serves as, stands as', 'a copula avoided for no reason'],
          ['not just X, but Y', 'the parallelism that never stops'],
          ['— everywhere', 'em dashes at twice the human rate'],
          ['In conclusion,', 'an ending that says nothing'],
        ].map(([a, b], i) => (
          <div className="tell" key={a} style={{ ['--i' as string]: String(i) }}>
            <code>{a}</code>
            <span className="na">{b}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <p>
        The rules and the scoring come from{' '}
        <a href="https://github.com/conorbronsdon/avoid-ai-writing" target="_blank" rel="noreferrer">
          avoid-ai-writing
        </a>{' '}
        by Conor Bronsdon, MIT licensed, running here unmodified. This page adds the interface and
        the swaps.
      </p>
      <p className="na">
        A score is evidence about patterns, not proof about a person. Plenty of people write with
        em dashes, and plenty of generated text has none. Read the findings, not the number.
      </p>
      <p className="na indie">
        None of my projects are paid for, funded or endorsed by Parity, W3F, PCF, PBA or anyone
        connected to them. I do all of it on my own.
      </p>
    </footer>
  );
}
