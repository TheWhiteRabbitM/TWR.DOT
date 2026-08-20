import { useState } from 'react';
import { check, band, predatesLLMs, MIN_CHARS, type Result } from './aicheck';

/**
 * "Read the writing" on a single post. Collapsed until asked, because a score
 * shown unbidden on somebody's old post is an accusation nobody invited.
 */
export function WritingCheck({
  id,
  text,
  when,
}: {
  id: string;
  text: string;
  /** ISO date of the post, so writing from before the tools existed says so. */
  when?: string | null;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'short'>('idle');
  const [res, setRes] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);

  async function run() {
    if (state === 'done' || state === 'short') {
      setOpen((o) => !o);
      return;
    }
    setState('busy');
    const r = await check(id, text);
    setRes(r);
    setState(r ? 'done' : 'short');
    setOpen(true);
  }

  const old = predatesLLMs(when);

  return (
    <div className="wcheck">
      <button className="act" onClick={run} title="look for AI writing patterns in this post">
        {state === 'busy' ? 'reading…' : '⌕ writing'}
        {res && !open ? <em className={`wscore ${band(res.score)}`}>{res.score}</em> : null}
      </button>

      {open && state === 'short' ? (
        <p className="wnote na">
          Too short to read. Below about {MIN_CHARS} characters there is not enough text for any of
          this to mean anything.
        </p>
      ) : null}

      {open && res ? (
        <div className={`wpanel ${band(res.score)}`}>
          <div className="wtop">
            <span className={`wbig ${band(res.score)}`}>{res.score}</span>
            <div>
              <strong>{res.label}</strong>
              <p className="na">
                {res.issues.length
                  ? `${res.issues.length} ${res.issues.length === 1 ? 'pattern' : 'patterns'} found`
                  : 'no patterns found'}
              </p>
            </div>
          </div>

          {res.issues.length ? (
            <ul className="wlist">
              {dedupe(res.issues).slice(0, 8).map((i) => (
                <li key={`${i.type}-${i.text}`}>
                  <code>{i.text}</code>
                  <span className="na">{i.type.replace(/[-_]/g, ' ')}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="wsmall na">
            {old
              ? 'Written before ChatGPT existed, so whatever this found, a model did not write it. Prose that reads like a machine is usually prose a machine learned from.'
              : 'Patterns, not proof. Plenty of people write this way and plenty of generated text does not. Read the post, not the number.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function dedupe(issues: Result['issues']) {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.type}:${i.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
