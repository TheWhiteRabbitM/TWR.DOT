import { useCallback, useEffect, useRef, useState } from 'react';
import { readBoard, waitFor, placedBy, nameOfMask, PALETTE, CANVAS, type Snapshot } from './chain';
import { getSigner, resetSigner, place, type Signer } from './place';
import { Score, STEPS } from './Score';
import { Canvas } from './Canvas';
import { Choir, noteOf, VOICES } from './audio';

/**
 * Block Choir.
 *
 * A choir was a definition of proof of personhood long before the phrase
 * existed: many people, one voice each. Here the voices are cells in contract
 * storage, one mask may add a note every thirty blocks, and the scale is
 * pentatonic, so whatever a stranger adds is consonant with whatever is already
 * there. Nobody can make it ugly, so nobody needs to be in charge of it.
 *
 * The same storage renders twice, as a score and as a picture. That is a
 * twenty-year-old idea rather than a new one: Content-based visualisation to aid
 * common navigation of musical audio, G. Wood, 2005.
 */
type Conn = Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout' | 'checking';

const BPM = 96;
const STEP_MS = 60_000 / BPM / 2;

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [conn, setConn] = useState<Conn>('checking');
  const [name, setName] = useState('');
  const [wait, setWait] = useState<number | null>(null);
  const [mine, setMine] = useState(0);
  const [colour, setColour] = useState(2);
  const [hover, setHover] = useState<number | null>(null);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<'score' | 'picture'>('score');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const choir = useRef<Choir>(new Choir());
  const board = useRef<Uint8Array | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const s = await readBoard();
      if (!alive.current) return;
      setSnap(s);
      board.current = s.pixels;
    } catch {
      /* the panel below says when the chain is quiet */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const t = setInterval(refresh, 8000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  useEffect(() => {
    if (!playing) {
      setStep(-1);
      return;
    }
    let s = 0;
    const tick = () => {
      const px = board.current;
      if (px) {
        for (let r = 0; r < VOICES; r += 1) {
          const v = px[r * 64 + s];
          if (v) choir.current.pluck(noteOf(r), v);
        }
      }
      setStep(s);
      s = (s + 1) % STEPS;
    };
    tick();
    const t = setInterval(tick, STEP_MS);
    return () => clearInterval(t);
  }, [playing]);

  const identify = useCallback(async (fresh = false) => {
    if (fresh) resetSigner();
    setConn('checking');
    try {
      const s = await getSigner(fresh);
      setConn(s);
      if (typeof s === 'object') {
        setName(await nameOfMask(s.mask));
        setWait(await waitFor(s.mask));
        setMine(await placedBy(s.mask));
      }
    } catch {
      setConn('timeout');
    }
  }, []);
  useEffect(() => {
    void identify();
  }, [identify]);

  useEffect(() => {
    if (typeof conn !== 'object') return;
    const t = setInterval(async () => {
      const w = await waitFor(conn.mask).catch(() => null);
      if (w != null && alive.current) setWait(w);
    }, 8000);
    return () => clearInterval(t);
  }, [conn]);

  const ready = typeof conn === 'object' && (wait ?? 1) === 0 && !busy;

  async function put(index: number) {
    const row = Math.floor(index / 64);
    const col = index % 64;
    if (typeof conn !== 'object') {
      setNote(hint(conn));
      return;
    }
    // hearing it before committing it is the point of a preview
    choir.current.resume();
    choir.current.pluck(noteOf(row), colour || 8);
    if ((wait ?? 0) > 0) {
      setNote(`${wait} more blocks before your next note.`);
      return;
    }
    setBusy(true);
    setNote('signing...');
    try {
      await place(conn, index, colour);
      setNote(`note added at step ${col + 1}. It is in the contract now.`);
      await refresh();
      setWait(await waitFor(conn.mask).catch(() => 30));
      setMine((n) => n + 1);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setNote(/StillWaiting/i.test(m) ? 'The contract says you are still inside your cooldown.' : m);
    } finally {
      setBusy(false);
    }
  }

  const notes = snap ? countNotes(snap.pixels) : 0;

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="dot" aria-hidden="true" />
          <h1>Block Choir</h1>
        </div>
        <p className="tagline">
          A piece of music that lives in contract storage. One person may add one note every thirty
          blocks, and the scale is pentatonic, so whatever anyone adds is consonant with whatever is
          already there. Nobody can make it ugly, so nobody has to be in charge of it.
        </p>
      </header>

      <main className="grid">
        <section className="stage">
          <div className="transport">
            <button
              className={`play ${playing ? 'on' : ''}`}
              onClick={() => {
                choir.current.resume();
                setPlaying((p) => !p);
              }}
            >
              {playing ? 'stop' : 'listen'}
            </button>
            <div className="views">
              <button className={view === 'score' ? 'on' : ''} onClick={() => setView('score')}>
                score
              </button>
              <button className={view === 'picture' ? 'on' : ''} onClick={() => setView('picture')}>
                picture
              </button>
            </div>
            <span className="na count">
              {snap ? `${notes} notes, block ${snap.block.toLocaleString()}` : 'reading the chain...'}
            </span>
          </div>

          {snap ? (
            view === 'score' ? (
              <Score
                pixels={snap.pixels}
                step={step}
                hover={hover}
                onHover={setHover}
                onPick={put}
                preview={ready ? colour : null}
              />
            ) : (
              <Canvas
                pixels={snap.pixels}
                hover={hover}
                onHover={setHover}
                onPick={put}
                preview={ready ? colour : null}
              />
            )
          ) : (
            <div className="score placeholder">reading the chain...</div>
          )}

          <p className="na legend">
            {view === 'score'
              ? 'Rows are notes, low at the bottom. Columns are moments. Click to hear one, and to place it when it is your turn.'
              : 'The same sixty-four words, drawn instead of played. A note is a pixel, and the picture is the score seen from above.'}
          </p>
        </section>

        <section className="side">
          <Identity conn={conn} name={name} wait={wait} mine={mine} onRetry={() => identify(true)} />

          <div className="panel">
            <h2>Voice</h2>
            <div className="palette">
              {PALETTE.map((hex, i) => (
                <button
                  key={hex}
                  className={`swatch ${colour === i ? 'on' : ''}`}
                  style={{ background: hex }}
                  title={i === 0 ? 'silence, which takes a note back' : `strength ${i}`}
                  onClick={() => setColour(i)}
                />
              ))}
            </div>
            <p className="na small">
              Brighter is struck harder. The first is silence, which is how a note gets taken back.
            </p>
          </div>

          {note ? <p className="note">{note}</p> : null}

          <div className="panel facts">
            <h2>Where this lives</h2>
            <dl>
              <div>
                <dt>contract</dt>
                <dd className="mono">
                  {CANVAS.slice(0, 10)}...{CANVAS.slice(-6)}
                </dd>
              </div>
              <div>
                <dt>the piece</dt>
                <dd>64 words of storage</dd>
              </div>
              <div>
                <dt>a turn</dt>
                <dd>30 blocks</dd>
              </div>
              <div>
                <dt>admin</dt>
                <dd>none, including me</dd>
              </div>
            </dl>
          </div>
        </section>
      </main>

      <footer className="foot">
        <p>
          A choir was a definition of proof of personhood long before the phrase existed: many
          people, one voice each. Take the personhood away and it stops being a choir, because
          whoever automates fastest sings every part. That is the argument for the primitive this
          platform is being built around, and it is easier to hear than to read.
        </p>
        <p className="na">
          The scale is fixed and pentatonic on purpose. No arrangement of these notes clashes, so
          strangers cannot write something ugly together and nothing here needs a moderator. The
          same storage renders as a score and as a picture, which is a twenty-year-old idea rather
          than a new one: Content-based visualisation to aid common navigation of musical audio,
          G. Wood, 2005.
        </p>
        <p className="na indie">
          None of my projects are paid for, funded or endorsed by Parity, W3F, PCF, PBA or anyone
          connected to them. I do all of it on my own.
        </p>
      </footer>
    </div>
  );
}

function countNotes(px: Uint8Array): number {
  let n = 0;
  for (let r = 0; r < VOICES; r += 1) for (let s = 0; s < STEPS; s += 1) if (px[r * 64 + s]) n += 1;
  return n;
}

/* ----------------------------------------------------------- identity ---- */
function Identity({
  conn,
  name,
  wait,
  mine,
  onRetry,
}: {
  conn: Conn;
  name: string;
  wait: number | null;
  mine: number;
  onRetry: () => void;
}) {
  if (typeof conn === 'object') {
    const w = wait ?? 0;
    return (
      <div className="panel who">
        <h2>Your voice</h2>
        <p className="name">
          {name || `mask #${conn.mask}`}
          {conn.verified ? <span className="ok"> {conn.verified}.dot</span> : null}
        </p>
        <div className={`cool ${w === 0 ? 'ready' : ''}`}>
          {w === 0 ? (
            <>
              <strong>your turn</strong>
              <span className="na">add a note</span>
            </>
          ) : (
            <>
              <strong>{w}</strong>
              <span className="na">{w === 1 ? 'block to wait' : 'blocks to wait'}</span>
            </>
          )}
        </div>
        <p className="na small">{mine} notes are yours</p>
      </div>
    );
  }
  return (
    <div className="panel who">
      <h2>Your voice</h2>
      <p className="na">{hint(conn)}</p>
      {conn === 'nowallet' || conn === 'timeout' ? (
        <button className="primary" onClick={onRetry}>
          Log in to sing
        </button>
      ) : null}
      {conn === 'nomask' ? (
        <a className="primary" href="https://peoplebook.dot.li" target="_blank" rel="noreferrer">
          Claim a mask
        </a>
      ) : null}
    </div>
  );
}

function hint(c: Exclude<Conn, Signer>): string {
  if (c === 'checking') return 'looking for your wallet...';
  if (c === 'nohost') return 'Open this in the Polkadot app to add a note. Listening works anywhere.';
  if (c === 'nowallet') return 'Log in and one of these voices is yours.';
  if (c === 'timeout') return 'Your wallet did not answer in time.';
  return 'Singing needs a Peoplebook mask, which is what makes one voice one person.';
}
