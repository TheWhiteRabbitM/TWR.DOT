import { useCallback, useEffect, useRef, useState } from 'react';
import { loadReferenda, readBallot, isEnrolled, messageFor, BALLOT, type Referendum, type Ballot } from './chain';
import { getSigner, resetSigner, enrolKey, castBallot, type Signer } from './enrol';
import { votingKey } from './keys';
import { sign } from './blsag';
import { Ring } from './Ring';
import { Explainer } from './Explainer';

/**
 * Secret Ballot.
 *
 * These are real referenda, taken from OpenGov as they stand, with the tally the
 * chain actually recorded. Beside each is the same question counted a different
 * way: one person, one vote, on a ballot nobody can read.
 *
 * Token weight is not a design choice anyone made on purpose. It is what you are
 * forced into when identities are free, because the only scarce thing left to
 * count is money. Give a chain a way to tell one human from ten thousand and the
 * other way of counting becomes available for the first time. Whether it gives a
 * better answer is exactly what this is for.
 */
type Conn = Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout' | 'checking';

export function App() {
  const [refs, setRefs] = useState<Referendum[] | null>(null);
  const [conn, setConn] = useState<Conn>('checking');
  const [err, setErr] = useState<string | null>(null);
  const [totals, setTotals] = useState({ ballots: 0, enrolled: 0, disagree: 0 });
  // shown once, then remembered: an explainer that reappears every visit is an ad
  const [explain, setExplain] = useState(() => {
    try { return localStorage.getItem('secretballot.seen') !== '1'; } catch { return true; }
  });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    loadReferenda()
      .then((r) => alive.current && setRefs(r))
      .catch((e) => alive.current && setErr(String(e)));
    return () => {
      alive.current = false;
    };
  }, []);

  /** The headline numbers, re-read from the chain rather than accumulated in the
   *  page: a count that drifts from what the contract says is worse than none. */
  const tally = useCallback(async (list: Referendum[]) => {
    const seen = await Promise.all(
      list.map(async (r) => {
        const b = await readBallot(r.pollId!).catch(() => null);
        if (!b) return { ballots: 0, enrolled: 0, disagree: 0 };
        const tokenSays = r.ayes === r.nays ? null : r.ayes > r.nays ? 'Aye' : 'Nay';
        const top = b.tallies.indexOf(Math.max(...b.tallies));
        const peopleSays = b.cast > 0 ? b.options[top] : null;
        const differs =
          tokenSays && peopleSays && peopleSays !== 'Abstain' && peopleSays !== tokenSays ? 1 : 0;
        return { ballots: b.cast, enrolled: b.ringSize, disagree: differs };
      }),
    );
    if (!alive.current) return;
    setTotals(
      seen.reduce((a, x) => ({ ballots: a.ballots + x.ballots, enrolled: a.enrolled + x.enrolled, disagree: a.disagree + x.disagree }), { ballots: 0, enrolled: 0, disagree: 0 }),
    );
  }, []);

  useEffect(() => {
    if (!refs) return;
    void tally(refs);
    const t = setInterval(() => void tally(refs), 15000);
    return () => clearInterval(t);
  }, [refs, tally]);

  const identify = useCallback(async (fresh = false) => {
    if (fresh) resetSigner();
    setConn('checking');
    try {
      setConn(await getSigner(fresh));
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
        <div className="masthead">
          <h1>Secret&nbsp;Ballot</h1>
          <p className="kicker">one person, one vote &middot; nobody can read it</p>
        </div>
        <p className="tagline">
          Real OpenGov referenda, counted a second way: one person, one vote, on a ballot nobody can
          read. What the tokens decided is on the left. What the people say is on the right.
        </p>
        <div className="who-line">
          {typeof conn === 'object' ? (
            <span className="chip on">mask #{String(conn.mask)} — enrolled polls only</span>
          ) : (
            <>
              <span className="chip">{hint(conn)}</span>
              {conn === 'nowallet' || conn === 'timeout' ? (
                <button className="primary" onClick={() => identify(true)}>Log in</button>
              ) : null}
            </>
          )}
        </div>
      </header>

      <main>
        {explain ? (
          <Explainer
            onDone={() => {
              setExplain(false);
              try { localStorage.setItem('secretballot.seen', '1'); } catch { /* private mode */ }
            }}
          />
        ) : (
          <button className="linkish reopen" onClick={() => setExplain(true)}>
            how does this work?
          </button>
        )}
        {err ? <p className="note">{err}</p> : null}
        {refs ? (
          <section className="summary">
            <div className="stat">
              <strong><Count to={refs.length} /></strong>
              <span>referenda</span>
            </div>
            <div className="stat">
              <strong><Count to={totals.enrolled} /></strong>
              <span>enrolled</span>
            </div>
            <div className="stat">
              <strong><Count to={totals.ballots} /></strong>
              <span>ballots cast</span>
            </div>
            <div className="stat diverge">
              <strong><Count to={totals.disagree} /></strong>
              <span>people disagree</span>
            </div>
          </section>
        ) : null}
        {refs === null ? (
          <p className="na">loading the referenda…</p>
        ) : (
          refs.map((r) => <RefCard key={r.index} ref_={r} conn={conn} />)
        )}
      </main>

      <footer className="foot">
        <p>
          A ballot here carries no identity at all. It carries a linkable ring signature: a proof
          that the sender is one of the people enrolled in this poll, without saying which one, and
          a key image that is the same every time that person signs here and reveals nothing about
          who they are. Two ballots with one key image are one person voting twice, and the second
          is refused while the first stays anonymous.
        </p>
        <p className="na">
          The proof is checked inside the contract at {BALLOT.slice(0, 10)}…{BALLOT.slice(-6)},
          using the elliptic curve precompiles this chain exposes. No trusted setup, no ceremony and
          no circuit compiler: the scheme is arithmetic, and the arithmetic runs on chain.
        </p>
        <p className="na">
          Referendum titles and token tallies come from subsquare.io and are shown as they stand.
          This is an experiment beside OpenGov rather than a replacement for it, and it decides
          nothing.
        </p>
        <p className="na indie">
          None of my projects are paid for, funded or endorsed by Parity, W3F, PCF, PBA or anyone
          connected to them. I do all of it on my own.
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------ one card -- */
function RefCard({ ref_, conn }: { ref_: Referendum; conn: Conn }) {
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [joined, setJoined] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [proving, setProving] = useState(false);
  const [justVoted, setJustVoted] = useState(false);
  const id = ref_.pollId!;

  const load = useCallback(async () => {
    const b = await readBallot(id).catch(() => null);
    if (b) setBallot(b);
    if (typeof conn === 'object') setJoined(await isEnrolled(id, conn.mask).catch(() => false));
  }, [id, conn]);

  useEffect(() => {
    void load();
  }, [load]);

  async function join() {
    if (typeof conn !== 'object') return;
    setBusy(true);
    setMsg(null);
    try {
      const { pub } = votingKey();
      await enrolKey(conn, id, pub);
      setMsg('enrolled. Your key is in the ring and your mask is done with this poll.');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function vote(option: number) {
    if (typeof conn !== 'object' || !ballot) return;
    setBusy(true);
    setMsg('proving…');
    try {
      const { secret, pub } = votingKey();
      const index = ballot.ring.findIndex((p) => p[0] === pub[0] && p[1] === pub[1]);
      if (index < 0) throw new Error('your voting key is not in this ring');
      const message = await messageFor(id, option);
      setProving(true);
      // yield once so the ring starts turning before the maths blocks the thread
      await new Promise((r) => setTimeout(r, 30));
      const sig = sign(message, ballot.ring, index, secret);
      setProving(false);
      setMsg('signing…');
      await castBallot(conn, id, option, sig.c0, sig.s, sig.keyImage);
      setMsg('counted. Nothing on chain says it was you.');
      setJustVoted(true);
      await load();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg(/AlreadyVoted/i.test(m) ? 'this key has already voted here' : m);
    } finally {
      setProving(false);
      setBusy(false);
    }
  }

  const tokenTotal = ref_.ayes + ref_.nays || 1;
  const people = ballot?.tallies ?? [];
  const peopleTotal = people.reduce((a, b) => a + b, 0) || 1;
  const canVote = typeof conn === 'object' && joined && ballot && ballot.ring.length >= 2;

  // the comparison this whole thing exists for: does the count by person agree
  // with the count by stake? Only meaningful once somebody has actually voted.
  const tokenSays = ref_.ayes === ref_.nays ? null : ref_.ayes > ref_.nays ? 'Aye' : 'Nay';
  const peopleSays =
    ballot && ballot.cast > 0
      ? ballot.options[people.indexOf(Math.max(...people))] ?? null
      : null;
  const verdict =
    tokenSays && peopleSays && peopleSays !== 'Abstain'
      ? peopleSays === tokenSays
        ? 'agree'
        : 'disagree'
      : null;

  return (
    <article className={`ref ${verdict === 'disagree' ? 'split' : ''}`}>
      <header className="ref-head">
        <span className="idx">#{ref_.index}</span>
        <a className="ref-title" href={ref_.url} target="_blank" rel="noreferrer">
          {ref_.title}
        </a>
        <span className={`pill ${ref_.state.toLowerCase()}`}>{ref_.state}</span>
        {verdict ? (
          <span className={`disagree ${verdict === 'agree' ? 'agree' : ''}`}>
            {verdict === 'agree' ? 'people agree with the tokens' : 'people disagree with the tokens'}
          </span>
        ) : null}
      </header>

      <div className="two">
        <section className="side-a">
          <h3>What the tokens said</h3>
          <div className="bar-row">
            <span className="lab aye">Aye</span>
            <span className="track"><i className="aye" style={{ width: `${(ref_.ayes / tokenTotal) * 100}%` }} /></span>
            <span className="val">{Math.round(ref_.ayes).toLocaleString('en-US')} DOT</span>
          </div>
          <div className="bar-row">
            <span className="lab nay">Nay</span>
            <span className="track"><i className="nay" style={{ width: `${(ref_.nays / tokenTotal) * 100}%` }} /></span>
            <span className="val">{Math.round(ref_.nays).toLocaleString('en-US')} DOT</span>
          </div>
          <p className="fine">on chain, weighted by stake</p>
        </section>

        <section className="side-b">
          <h3>What the people say</h3>
          {ballot && ballot.cast > 0 ? (
            ballot.options.map((o, i) => (
              <div className="bar-row" key={o}>
                <span className={`lab ${o.toLowerCase()}`}>{o}</span>
                <span className="track">
                  <i className={o.toLowerCase()} style={{ width: `${((people[i] ?? 0) / peopleTotal) * 100}%` }} />
                </span>
                <span className="val">{people[i] ?? 0}</span>
              </div>
            ))
          ) : (
            <p className="fine empty">No ballots yet. {ballot ? `${ballot.ringSize} enrolled.` : ''}</p>
          )}
          <p className="fine">
            {ballot ? `${ballot.cast} ${ballot.cast === 1 ? 'ballot' : 'ballots'}, one per person` : ''}
          </p>
        </section>
      </div>

      {tokenSays || peopleSays ? (
        <div className="verdict-row">
          <span className="vs">verdict</span>
          <span className="tokens">
            tokens: <b>{tokenSays ?? 'no majority'}</b>
          </span>
          <span className="arrowy">&middot;</span>
          <span className="humans">
            people: <b>{peopleSays ?? 'not yet'}</b>
          </span>
        </div>
      ) : null}

      <footer className="ref-foot">
        {typeof conn !== 'object' ? (
          <span className="fine">{hint(conn)}</span>
        ) : joined === false ? (
          <>
            <button className="primary" disabled={busy} onClick={join}>
              {busy ? 'signing…' : 'Enrol to vote'}
            </button>
            <span className="fine">your mask joins the ring once, before anyone has voted</span>
          </>
        ) : canVote ? (
          <>
            <Ring size={ballot!.ring.length} active={proving} done={justVoted} />
            {ballot!.options.map((o, i) => (
              <button key={o} className="ballot-btn" disabled={busy} onClick={() => vote(i)}>
                {o}
              </button>
            ))}
            <span className="fine">the ballot carries a proof, not your name</span>
          </>
        ) : (
          <span className="fine">
            {ballot && ballot.ring.length < 2
              ? 'a ring of one hides nobody: waiting for a second voter before ballots can be cast'
              : 'enrolled'}
          </span>
        )}
        {msg ? <span className="msg-inline">{msg}</span> : null}
      </footer>
    </article>
  );
}

/** A number that arrives rather than appears, and lands exactly on the value
 *  even when the tab is hidden and animation frames never run. */
function Count({ to }: { to: number }) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const a = from.current;
    if (a === to) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(to);
      from.current = to;
      return;
    }
    const start = performance.now();
    const dur = 600;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      setN(Math.round(a + (to - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = to;
    };
    raf = requestAnimationFrame(step);
    const settle = setTimeout(() => {
      setN(to);
      from.current = to;
    }, dur + 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [to]);
  return <>{n.toLocaleString('en-US')}</>;
}

function hint(c: Exclude<Conn, Signer>): string {
  if (c === 'checking') return 'looking for your wallet…';
  if (c === 'nohost') return 'Open this in the Polkadot app to vote. Reading works anywhere.';
  if (c === 'nowallet') return 'Log in to vote';
  if (c === 'timeout') return 'your wallet did not answer in time';
  return 'voting needs a Peoplebook mask — that is what makes one vote one person';
}
