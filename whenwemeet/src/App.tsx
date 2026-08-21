import { useCallback, useEffect, useRef, useState } from 'react';
import { recentPolls, myBallot, nameOfMask, WHENWE, type Poll } from './chain';
import { getSigner, resetSigner, openPoll, castVote, type Signer } from './vote';

/**
 * When We.
 *
 * Everybody has used the web2 version: a link arrives, you tick the slots that
 * suit you, and in exchange somebody learns who you meet, when you are free and
 * what your email address is. None of that is needed to answer the question.
 *
 * What is needed is a list of options, one tick per person per option, and a
 * guarantee that one person cannot tick fifty times. The first two are a
 * contract; the third is a mask. Nothing else about you is collected, because
 * there is nowhere to collect it to.
 */
type Conn = Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout' | 'checking';

export function App() {
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [conn, setConn] = useState<Conn>('checking');
  const [name, setName] = useState('');
  const [making, setMaking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await recentPolls();
      if (alive.current) {
        setPolls(list);
        setErr(null);
      }
    } catch (e) {
      if (alive.current) setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const t = setInterval(refresh, 12000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  const identify = useCallback(async (fresh = false) => {
    if (fresh) resetSigner();
    setConn('checking');
    try {
      const s = await getSigner(fresh);
      setConn(s);
      if (typeof s === 'object') setName(await nameOfMask(s.mask));
    } catch {
      setConn('timeout');
    }
  }, []);
  useEffect(() => {
    void identify();
  }, [identify]);

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="dot" aria-hidden="true" />
          <h1>When We</h1>
        </div>
        <p className="tagline">
          Tick the times that suit you and see what suits everyone. One person is one vote, there is
          no account to make and no email to hand over, and nobody is left holding your diary.
        </p>
        <div className="who-line">
          {typeof conn === 'object' ? (
            <>
              <span className="chip on">{name || `mask #${conn.mask}`}</span>
              <button className="primary" onClick={() => setMaking((m) => !m)}>
                {making ? 'never mind' : 'Ask a question'}
              </button>
            </>
          ) : (
            <>
              <span className="chip">{hint(conn)}</span>
              {conn === 'nowallet' || conn === 'timeout' ? (
                <button className="primary" onClick={() => identify(true)}>
                  Log in
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>

      {making && typeof conn === 'object' ? (
        <NewPoll
          signer={conn}
          onDone={async () => {
            setMaking(false);
            await refresh();
          }}
        />
      ) : null}

      <main>
        {err ? <p className="note">the chain did not answer: {err}</p> : null}
        {polls === null ? (
          <p className="na">reading the chain…</p>
        ) : polls.length === 0 ? (
          <p className="na">Nothing asked yet. If you hold a mask, ask the first question.</p>
        ) : (
          <ul className="polls">
            {polls.map((p) => (
              <PollCard
                key={p.id}
                poll={p}
                conn={conn}
                expanded={open === p.id}
                onToggle={() => setOpen(open === p.id ? null : p.id)}
                onVoted={refresh}
              />
            ))}
          </ul>
        )}
      </main>

      <footer className="foot">
        <p>
          A poll here is a row in a contract at {WHENWE.slice(0, 10)}…{WHENWE.slice(-6)}: a title, up
          to sixteen options, and a count for each. Voting again replaces your last answer, which is
          what changing your mind looks like somewhere nothing can be deleted.
        </p>
        <p className="na">
          There is no owner. The person who opened a poll cannot close it, delete it or remove a
          vote, and neither can I.
        </p>
        <p className="na indie">
          None of my projects are paid for, funded or endorsed by Parity, W3F, PCF, PBA or anyone
          connected to them. I do all of it on my own.
        </p>
      </footer>
    </div>
  );
}

/* --------------------------------------------------------------- a poll -- */
function PollCard({
  poll,
  conn,
  expanded,
  onToggle,
  onVoted,
}: {
  poll: Poll;
  conn: Conn;
  expanded: boolean;
  onToggle: () => void;
  onVoted: () => Promise<void>;
}) {
  const [mine, setMine] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof conn !== 'object' || !expanded) return;
    void myBallot(poll.id, conn.mask).then((b) => {
      setMine(b.bitmap);
      setAnswered(b.answered);
    });
  }, [conn, poll.id, expanded]);

  const best = Math.max(1, ...poll.tallies);
  const winner = poll.tallies.indexOf(Math.max(...poll.tallies));

  async function send() {
    if (typeof conn !== 'object' || mine === null) return;
    setBusy(true);
    setMsg(null);
    try {
      await castVote(conn, poll.id, mine);
      setMsg(answered ? 'answer replaced.' : 'answer recorded.');
      setAnswered(true);
      await onVoted();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`poll ${expanded ? 'open' : ''}`}>
      <button className="poll-head" onClick={onToggle}>
        <span className="poll-title">{poll.title}</span>
        <span className="na poll-meta">
          {poll.people} {poll.people === 1 ? 'answer' : 'answers'}
        </span>
      </button>

      <div className="rows">
        {poll.options.map((o, i) => {
          const n = poll.tallies[i] ?? 0;
          const picked = mine != null && ((mine >> i) & 1) === 1;
          return (
            <div className={`row ${i === winner && n > 0 ? 'best' : ''}`} key={o + i}>
              <button
                className={`tick ${picked ? 'on' : ''} ${expanded && typeof conn === 'object' ? '' : 'idle'}`}
                disabled={!expanded || typeof conn !== 'object' || busy}
                onClick={() => setMine((m) => (m == null ? 1 << i : m ^ (1 << i)))}
                aria-label={picked ? 'suits me' : 'does not suit me'}
              >
                {picked ? '✓' : ''}
              </button>
              <span className="opt">{o}</span>
              <span className="bar">
                <i style={{ width: `${(n / best) * 100}%` }} />
              </span>
              <span className="num">{n}</span>
            </div>
          );
        })}
      </div>

      {expanded ? (
        <div className="poll-foot">
          {typeof conn === 'object' ? (
            <>
              <button className="primary" disabled={busy || mine === null} onClick={send}>
                {busy ? 'signing…' : answered ? 'Change my answer' : 'Send my answer'}
              </button>
              <span className="na">{answered ? 'you have answered this one' : 'one answer per person'}</span>
            </>
          ) : (
            <span className="na">{hint(conn)}</span>
          )}
          {msg ? <span className="na">{msg}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------ new poll -- */
function NewPoll({ signer, onDone }: { signer: Signer; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [raw, setRaw] = useState('Tue 14:00 UTC\nWed 09:00 UTC\nWed 16:00 UTC');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const options = raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 16);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      await openPoll(signer, title.trim(), options);
      await onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <section className="panel maker">
      <h2>Ask</h2>
      <label className="field">
        <span>What are we deciding?</span>
        <input
          value={title}
          maxLength={140}
          placeholder="When shall we do the call?"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="field">
        <span>The options, one per line — up to sixteen</span>
        <textarea rows={5} value={raw} onChange={(e) => setRaw(e.target.value)} />
      </label>
      <div className="poll-foot">
        <button className="primary" disabled={busy || !title.trim() || options.length === 0} onClick={send}>
          {busy ? 'signing…' : `Open it with ${options.length} options`}
        </button>
        <span className="na">it goes on chain and nobody can take it down, including you</span>
      </div>
      {msg ? <p className="note">{msg}</p> : null}
    </section>
  );
}

function hint(c: Exclude<Conn, Signer>): string {
  if (c === 'checking') return 'looking for your wallet…';
  if (c === 'nohost') return 'Open this in the Polkadot app to answer. Reading works anywhere.';
  if (c === 'nowallet') return 'Log in to answer';
  if (c === 'timeout') return 'your wallet did not answer in time';
  return 'answering needs a Peoplebook mask, which is what makes one answer one person';
}
