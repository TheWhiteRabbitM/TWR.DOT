import { useCallback, useEffect, useRef, useState } from 'react';
import type { ButtonState } from './lib/types';
import { DEVNET } from './lib/config';
import { NUMBERS, useSequence } from './lib/useSequence';
import { sfx } from './lib/sfx';
import { Rabbit } from './Rabbit';

/** Minimum digits on the split-flap display. */
const FLAP_WIDTH = 4;

function clock(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `-${hh}:${mm}:${ss}`;
}

function shorten(alias: string): string {
  return alias.length > 18 ? `${alias.slice(0, 10)}…${alias.slice(-4)}` : alias;
}

/**
 * The station sigil: a segmented octagon around a single dot.
 *
 * Drawn blocky on purpose — thick strokes, crisp edges — so it reads like the
 * character graphics of a late-70s terminal rather than a modern icon.
 */
function Sigil({ size }: { size: 'boot' | 'header' }) {
  const bars = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg
      className={`sigil is-${size}`}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <polygon
        points="35,4 85,4 116,35 116,85 85,116 35,116 4,85 4,35"
        stroke="currentColor"
        strokeWidth="4"
      />
      <polygon
        points="46,24 74,24 96,46 96,74 74,96 46,96 24,74 24,46"
        stroke="currentColor"
        strokeWidth="3"
      />
      {bars.map((angle) => (
        <g key={angle} transform={`rotate(${angle} 60 60)`} fill="currentColor">
          <rect x="45" y="8" width="30" height="3.5" />
          <rect x="41" y="13.5" width="38" height="3.5" />
          <rect x="37" y="19" width="46" height="3.5" />
        </g>
      ))}
      <circle cx="60" cy="60" r="17" stroke="currentColor" strokeWidth="3.5" />
      <circle cx="60" cy="60" r="7" fill="currentColor" />
    </svg>
  );
}

/** Boot screen: what the tube shows while the chain path comes up. */
function Boot({ step }: { step: string | null }) {
  return (
    <div className="boot">
      <p className="boot-loading">
        LOADING<span className="boot-dots">.......</span>
      </p>
      <Sigil size="boot" />
      <p className="boot-station">STATION Ø : THE DOT</p>
      <p className="boot-sub">DEVNET TERMINAL // ASSET HUB {DEVNET.assetHubEvmChainId}</p>
      <p className="boot-step">
        &gt; {(step ?? 'STANDBY').toUpperCase()}
        <span className="cursor" />
      </p>
      <p className="boot-prompt">
        LOAD THEBUTTON.001 (Y/N)? Y<span className="cursor" />
      </p>
    </div>
  );
}

/** Copy for the screen, one line per row. */
function lines(state: ButtonState, canSimulate: boolean): { text: string; alert?: boolean }[] {
  switch (state.phase) {
    case 'ready':
      return [
        { text: 'IDENTITY CONFIRMED :: PERSONHOOD VERIFIED' },
        { text: 'ONE EXECUTION PERMITTED PER PERSON' },
        { text: 'AWAITING INPUT' },
      ];
    case 'pressing':
      return [{ text: (state.step ?? 'transmitting').toUpperCase() }];
    case 'pressed':
      return [
        { text: 'EXECUTION LOGGED' },
        { text: 'RECORD IS PERMANENT :: REINSTALL WILL NOT RESET IT' },
        { text: 'NO FURTHER INPUT ACCEPTED', alert: true },
      ];
    case 'not-human':
      return [
        { text: `PERSONHOOD TIER ${state.tier} :: FULL PERSONHOOD REQUIRED`, alert: true },
        { text: 'GRANTED TO A LIMITED SET OF ACCOUNTS ON THIS DEVNET' },
        {
          text: canSimulate
            ? 'PRESS SIMULATE TO WALK THROUGH IT ANYWAY'
            : 'EXPLORE IN A NORMAL BROWSER (SIMULATION MODE)',
        },
      ];
    case 'outside-host':
      return [
        { text: 'NO HOST CONTAINER DETECTED', alert: true },
        { text: 'OPEN VIA THE POLKADOT APP OR WEB GATEWAY' },
        ...(canSimulate ? [{ text: 'OR PRESS SIMULATE TO WALK THROUGH IT HERE' }] : []),
      ];
    default:
      return [];
  }
}

function Flaps({ value, logged }: { value: number; logged: boolean }) {
  const digits = String(value).padStart(FLAP_WIDTH, '0').split('');
  return (
    <div className={`flaps${logged ? ' is-logged' : ''}`} role="img" aria-label={String(value)}>
      {digits.map((digit, index) => (
        // Keyed on the digit so a change remounts the cell and replays the flip.
        <span className="flap" key={`${index}-${digit}`} aria-hidden="true">
          <i>{digit}</i>
        </span>
      ))}
    </div>
  );
}

export interface ButtonScreenProps {
  state: ButtonState;
  onPress: () => void;
  /**
   * Swap the chain for the local simulation. Personhood is granted to a handful
   * of accounts on this devnet, so without this anyone else reaches a screen
   * they can never act on — telling them to go open a different browser is not
   * a working app.
   */
  onSimulate?: () => void;
}

export function ButtonScreen({ state, onPress, onSimulate }: ButtonScreenProps) {
  const canPress = state.phase === 'ready';
  const stuck =
    state.phase === 'not-human' || state.phase === 'outside-host' || state.phase === 'error';
  const canSimulate = Boolean(onSimulate) && stuck;
  const isPressed = state.phase === 'pressed' && state.yourOrdinal !== null;
  const booting = state.phase === 'loading';
  const failed = state.phase === 'error';
  const figure = isPressed ? (state.yourOrdinal ?? 0) : state.total;

  const [rabbit, setRabbit] = useState(false);
  const wake = useCallback(() => {
    setRabbit(true);
    sfx.rabbit();
  }, []);
  const { echo, progress, clickNumber } = useSequence(wake);

  // Phase-change sounds. A reload straight into a phase stays silent because
  // the AudioContext only exists after the first user gesture.
  const prevPhase = useRef(state.phase);
  useEffect(() => {
    if (prevPhase.current !== state.phase) {
      if (state.phase === 'pressed') sfx.logged();
      if (state.phase === 'error') sfx.fault();
      prevPhase.current = state.phase;
    }
  }, [state.phase]);

  const pressKey = (value: number) => {
    sfx.key();
    clickNumber(value);
  };

  const execute = () => {
    sfx.execute();
    onPress();
  };

  return (
    <main className="station">
      <div className={`crt${failed ? ' is-failed' : ''}`}>
        <div className="tube">
          {booting ? (
            <Boot step={state.step} />
          ) : (
            <div className="session">
              <header className="header">
                <Sigil size="header" />
                <div>
                  <h1 className="wordmark">THE BUTTON</h1>
                  <p className="subline">
                    STATION Ø : THE DOT // ASSET HUB {DEVNET.assetHubEvmChainId}
                  </p>
                </div>
              </header>

              <section className="timer">
                <Flaps value={figure} logged={isPressed} />
                <p className="timer-label">
                  {isPressed
                    ? `YOUR NUMBER :: ${state.total} ON THE REGISTER`
                    : state.total === 1
                      ? 'HUMAN HAS PRESSED'
                      : 'HUMANS HAVE PRESSED'}
                </p>
              </section>

              <section className="terminal" aria-live="polite">
                {failed && (
                  <>
                    <p className="failure-band" aria-hidden="true">
                      SYSTEM FAILURE&ensp;SYSTEM FAILURE&ensp;SYSTEM FAILURE
                    </p>
                    <p className="failure-band" aria-hidden="true">
                      SYSTEM FAILURE&ensp;SYSTEM FAILURE&ensp;SYSTEM FAILURE
                    </p>
                    <p className="is-alert">&gt; {state.error}</p>
                  </>
                )}

                {lines(state, canSimulate).map((line, index) => (
                  <p key={index} className={line.alert ? 'is-alert' : undefined}>
                    &gt; {line.text}
                    {index === lines(state, canSimulate).length - 1 &&
                      state.phase !== 'pressed' &&
                      echo === '' && <span className="cursor" />}
                  </p>
                ))}

                {echo !== '' && (
                  <p className="echo">
                    &gt;: {echo.split('').join(' ')}
                    <span className="cursor" />
                  </p>
                )}

                {rabbit && <p className="is-rabbit">&gt; SUBJECT 15 LOOSE ON LEVEL 3</p>}

                {/* Which key is signing. The app-scoped account is a fallback
                    for hosts that expose no wallet accounts: it starts empty
                    and carries no personhood, so it gets named loudly rather
                    than leaving a real human staring at a refusal. */}
                {state.signerKind === 'wallet' && state.signerAddress && (
                  <p className="dim">
                    &gt; SIGNING AS {shorten(state.signerAddress)}
                    {state.username ? ` :: ${state.username.toUpperCase()}` : ''}
                  </p>
                )}
                {state.signerKind === 'app' && state.signerAddress && (
                  <>
                    <p className="is-alert">
                      &gt; APP ACCOUNT IN USE :: {shorten(state.signerAddress)}
                    </p>
                    <p className="dim">
                      &gt; NO WALLET ACCOUNT EXPOSED :: THIS KEY HOLDS NO FUNDS AND NO PERSONHOOD
                    </p>
                  </>
                )}

                {state.mocked && (
                  <p className="dim">&gt; SIMULATION MODE :: NO CHAIN ATTACHED</p>
                )}
              </section>

              {state.roll.length > 0 && (
                <section className="log">
                  <p className="log-title">:: REGISTER LOG ::</p>
                  <ol>
                    {[...state.roll].reverse().map((entry) => {
                      const isYou = entry.ordinal === state.yourOrdinal;
                      return (
                        <li key={entry.ordinal} className={isYou ? 'is-you' : undefined}>
                          <span className="entry-no">
                            {String(entry.ordinal).padStart(3, '0')}
                          </span>
                          <span className="entry-who">
                            {isYou ? '>>> YOU' : shorten(entry.who)}
                          </span>
                          <span className="entry-when">{clock(entry.pressedAt)}</span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}

              <footer className="colophon">
                PERSONHOOD PRECOMPILE <span>{DEVNET.personhoodPrecompile}</span>
                <br />
                DEVNET TOKENS CARRY NO VALUE · THE KEYPAD ACCEPTS INPUT
              </footer>
            </div>
          )}

          {/* Optics live above the text: scanlines, sheen, vignette, sweep. */}
          <div className="glass" aria-hidden="true" />
          <div className="sweep" aria-hidden="true" />
        </div>
      </div>

      <div className="keyboard" role="group" aria-label="station keyboard">
        <div className="keypad">
          {NUMBERS.map((n, i) => (
            <button
              key={n}
              type="button"
              className={`key num${i < progress ? ' is-armed' : ''}`}
              onClick={() => pressKey(n)}
              aria-label={`key ${n}`}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`key execute${state.phase === 'pressing' ? ' is-working' : ''}`}
          onClick={execute}
          disabled={!canPress}
        >
          {state.phase === 'pressing' ? 'SENDING' : isPressed ? 'LOGGED' : 'EXECUTE'}
        </button>
        {canSimulate && (
          <button
            type="button"
            className="key simulate"
            onClick={() => {
              sfx.key();
              onSimulate?.();
            }}
          >
            SIMULATE
          </button>
        )}
        <p className="key-note">
          {canSimulate
            ? 'SIMULATION IS LOCAL · NOTHING IS WRITTEN TO THE CHAIN'
            : isPressed
              ? 'INPUT LOCKED · PERMANENT'
              : 'ONE PRESS PER HUMAN · NO UNDO'}
        </p>
      </div>

      {rabbit && <Rabbit onDone={() => setRabbit(false)} />}
    </main>
  );
}
