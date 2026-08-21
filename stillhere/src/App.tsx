import { useCallback, useEffect, useRef, useState } from 'react';
import { allWatches, blockNow, nameOfMask, human, STILLHERE, MIN_WINDOW, type Watch } from './chain';
import { getSigner, resetSigner, startWatch, checkIn, endWatch, type Signer } from './keep';

/**
 * Still Here.
 *
 * The web2 version of this asks for an enormous act of faith: you write
 * something that matters, hand it to a company, and trust that the company still
 * exists on the day it is needed, still has your file, still has a working mail
 * server and still intends to honour the arrangement. Four promises, from people
 * with no obligation to keep any of them.
 *
 * Here the promise is arithmetic. A watch has a window; coming back resets it;
 * if the window closes the message is due. Nobody has to remember you and nobody
 * can decide otherwise, including whoever wrote this.
 */
type Conn = Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout' | 'checking';

export function App() {
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [block, setBlock] = useState<number | null>(null);
  const [conn, setConn] = useState<Conn>('checking');
  const [name, setName] = useState('');
  const [making, setMaking] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [w, b] = await Promise.all([allWatches(), blockNow()]);
      if (alive.current) {
        setWatches(w);
        setBlock(b);
      }
    } catch { /* the page says so below */ }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const t = setInterval(refresh, 10000);
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

  const mine = typeof conn === 'object' ? (watches ?? []).filter((w) => w.mask === conn.mask) : [];
  const due = (watches ?? []).filter((w) => w.due);

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="dot" aria-hidden="true" />
          <h1>Still Here</h1>
        </div>
        <p className="tagline">
          Set a watch and a message. Coming back resets the clock. If the clock runs out the message
          becomes due, and no company has to still exist for that to happen.
        </p>
        <div className="who-line">
          {typeof conn === 'object' ? (
            <>
              <span className="chip on">{name || `mask #${conn.mask}`}</span>
              <button className="primary" onClick={() => setMaking((m) => !m)}>
                {making ? 'never mind' : 'Set a watch'}
              </button>
            </>
          ) : (
            <>
              <span className="chip">{hint(conn)}</span>
              {conn === 'nowallet' || conn === 'timeout' ? (
                <button className="primary" onClick={() => identify(true)}>Log in</button>
              ) : null}
            </>
          )}
          {block ? <span className="na mono">block {block.toLocaleString()}</span> : null}
        </div>
      </header>

      {making && typeof conn === 'object' ? (
        <NewWatch
          signer={conn}
          onDone={async () => {
            setMaking(false);
            await refresh();
          }}
        />
      ) : null}

      <main>
        {due.length ? (
          <section className="due-block">
            <h2>Due</h2>
            <p className="na">
              These watches ran past their window. Nobody delivered them; the contract simply stopped
              saying they were waiting.
            </p>
            {due.map((w) => (
              <WatchCard key={w.id} w={w} conn={conn} onChanged={refresh} />
            ))}
          </section>
        ) : null}

        {typeof conn === 'object' && mine.length ? (
          <section>
            <h2>Yours</h2>
            {mine.map((w) => (
              <WatchCard key={w.id} w={w} conn={conn} onChanged={refresh} />
            ))}
          </section>
        ) : null}

        <section>
          <h2>Every watch</h2>
          {watches === null ? (
            <p className="na">reading the chain…</p>
          ) : watches.length === 0 ? (
            <p className="na">No watches yet.</p>
          ) : (
            watches.map((w) => <WatchCard key={w.id} w={w} conn={conn} onChanged={refresh} />)
          )}
        </section>
      </main>

      <footer className="foot">
        <p>
          Two things are true here and both are inconvenient. Nothing is secret: a chain cannot keep
          a secret and pretending otherwise would be the dangerous kind of lie, so the words are
          public from the moment they are written and the window only governs when they are
          presented. And nothing can be unsaid: ending a watch stops it being due, it does not remove
          what was written.
        </p>
        <p className="na">
          Contract {STILLHERE.slice(0, 10)}…{STILLHERE.slice(-6)}. No owner, no pause, nobody who can
          deliver early or late. Write for a public room and it is a good tool; write for a private
          one and it is the wrong one.
        </p>
        <p className="na indie">
          None of my projects are paid for, funded or endorsed by Parity, W3F, PCF, PBA or anyone
          connected to them. I do all of it on my own.
        </p>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- watch -- */
function WatchCard({ w, conn, onChanged }: { w: Watch; conn: Conn; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [show, setShow] = useState(w.due);
  const isMine = typeof conn === 'object' && conn.mask === w.mask;
  const pct = w.window ? Math.max(0, Math.min(100, (w.blocksLeft / w.window) * 100)) : 0;
  const state = w.cancelled ? 'ended' : w.due ? 'due' : 'watching';

  async function act(fn: 'in' | 'end') {
    if (typeof conn !== 'object') return;
    setBusy(true);
    setMsg(null);
    try {
      if (fn === 'in') await checkIn(conn, w.id);
      else await endWatch(conn, w.id);
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`watch ${state}`}>
      <div className="watch-head">
        <span className="label">{w.label || 'untitled'}</span>
        <span className={`state ${state}`}>{state}</span>
      </div>

      {state === 'watching' ? (
        <>
          <div className="meter">
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="na small">
            {w.blocksLeft.toLocaleString()} blocks left, about {human(w.blocksLeft)}. The window is{' '}
            {w.window.toLocaleString()} blocks.
          </p>
        </>
      ) : state === 'due' ? (
        <p className="na small">The window closed. This has been readable by anyone since.</p>
      ) : (
        <p className="na small">The keeper ended this watch. The words below stay where they were.</p>
      )}

      {show ? (
        <blockquote className="msg">{w.message}</blockquote>
      ) : (
        <button className="linkbtn" onClick={() => setShow(true)}>
          read it anyway
        </button>
      )}

      {isMine && !w.cancelled ? (
        <div className="watch-foot">
          <button className="primary" disabled={busy} onClick={() => act('in')}>
            {busy ? 'signing…' : 'Still here'}
          </button>
          <button className="ghost" disabled={busy} onClick={() => act('end')}>
            End the watch
          </button>
        </div>
      ) : null}
      {msg ? <p className="note">{msg}</p> : null}
    </article>
  );
}

/* ------------------------------------------------------------ new watch -- */
function NewWatch({ signer, onDone }: { signer: Signer; onDone: () => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [window_, setWindow] = useState(3000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      await startWatch(signer, label.trim(), message.trim(), window_);
      await onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <section className="panel maker">
      <h2>A new watch</h2>
      <p className="na small">
        Write it for a public room, because that is where it will be read. If it must stay private,
        this is the wrong tool and saying so is more use than a checkbox.
      </p>
      <label className="field">
        <span>What is this?</span>
        <input value={label} maxLength={100} placeholder="If I go quiet" onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="field">
        <span>What should it say?</span>
        <textarea rows={4} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Silence that means gone: {window_.toLocaleString()} blocks, about {human(window_)}
        </span>
        <input
          type="range"
          min={MIN_WINDOW}
          max={1_296_000}
          step={300}
          value={window_}
          onChange={(e) => setWindow(Number(e.target.value))}
        />
      </label>
      <div className="watch-foot">
        <button className="primary" disabled={busy || !label.trim() || !message.trim()} onClick={send}>
          {busy ? 'signing…' : 'Start the watch'}
        </button>
        <span className="na">nobody can stop it once it runs, including you and me</span>
      </div>
      {msg ? <p className="note">{msg}</p> : null}
    </section>
  );
}

function hint(c: Exclude<Conn, Signer>): string {
  if (c === 'checking') return 'looking for your wallet…';
  if (c === 'nohost') return 'Open this in the Polkadot app to keep a watch. Reading works anywhere.';
  if (c === 'nowallet') return 'Log in to keep a watch';
  if (c === 'timeout') return 'your wallet did not answer in time';
  return 'keeping a watch needs a Peoplebook mask';
}
