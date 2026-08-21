import { useCallback, useEffect, useRef, useState } from 'react';
import { allTabs, balances, settle, money, nameOfMask, WHOPAYS, type Tab } from './chain';
import { getSigner, resetSigner, openTab, joinTab, addEntry, type Signer } from './pay';

/**
 * Who Pays.
 *
 * The app everyone already uses for this works well and costs you your social
 * graph: it learns who you travel with, who you eat with, how often and for how
 * much. Settling a tab needs none of that. It needs a list of amounts, a name
 * against each, and agreement about who was in.
 *
 * So the contract keeps the facts and the browser does the arithmetic, which is
 * also why the arithmetic is worth reading: a share is the amount divided by the
 * people in it, and the odd cent goes to whoever already put the money down.
 */
type Conn = Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout' | 'checking';

export function App() {
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [conn, setConn] = useState<Conn>('checking');
  const [making, setMaking] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await allTabs();
      if (!alive.current) return;
      setTabs(list);
      const masks = new Set<string>();
      for (const t of list) for (const m of t.members) masks.add(m.toString());
      const entries = await Promise.all(
        [...masks].map(async (m) => [m, await nameOfMask(BigInt(m))] as const),
      );
      if (alive.current) setNames(Object.fromEntries(entries));
    } catch { /* shown below */ }
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
      setConn(await getSigner(fresh));
    } catch {
      setConn('timeout');
    }
  }, []);
  useEffect(() => {
    void identify();
  }, [identify]);

  const who = (m: bigint | string) => names[m.toString()] || `mask #${m}`;

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="dot" aria-hidden="true" />
          <h1>Who Pays</h1>
        </div>
        <p className="tagline">
          A shared tab: who paid what, and who owes whom. The facts live in a contract and the
          arithmetic happens in your browser, so nobody is left holding a list of the people you
          spend your life with.
        </p>
        <div className="who-line">
          {typeof conn === 'object' ? (
            <>
              <span className="chip on">{who(conn.mask)}</span>
              <button className="primary" onClick={() => setMaking((m) => !m)}>
                {making ? 'never mind' : 'Open a tab'}
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
        </div>
      </header>

      {making && typeof conn === 'object' ? (
        <NewTab
          signer={conn}
          onDone={async () => {
            setMaking(false);
            await refresh();
          }}
        />
      ) : null}

      <main>
        {tabs === null ? (
          <p className="na">reading the chain…</p>
        ) : tabs.length === 0 ? (
          <p className="na">No tabs yet. If you hold a mask, open the first one.</p>
        ) : (
          tabs.map((t) => <TabCard key={t.id} tab={t} conn={conn} who={who} onChanged={refresh} />)
        )}
      </main>

      <footer className="foot">
        <p>
          Amounts are whole units of whatever you are counting, so nothing goes through a floating
          point number on its way to being money. A share is the total divided by the people it was
          split between, and the odd cent goes to the person who already paid, because somebody has
          to carry it and that is the least unfair place to put it.
        </p>
        <p className="na">
          Contract {WHOPAYS.slice(0, 10)}…{WHOPAYS.slice(-6)}. Entries cannot be edited or removed,
          by anyone, which is inconvenient exactly as often as it is the point.
        </p>
        <p className="na indie">
          None of my projects are paid for, funded or endorsed by Parity, W3F, PCF, PBA or anyone
          connected to them. I do all of it on my own.
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ tab -- */
function TabCard({
  tab,
  conn,
  who,
  onChanged,
}: {
  tab: Tab;
  conn: Conn;
  who: (m: bigint | string) => string;
  onChanged: () => Promise<void>;
}) {
  const [what, setWhat] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const net = balances(tab);
  const owed = settle(net);
  const total = tab.entries.reduce((a, e) => a + e.amount, 0n);
  const inIt = typeof conn === 'object' && tab.members.some((m) => m === conn.mask);

  async function add() {
    if (typeof conn !== 'object') return;
    const cents = BigInt(Math.round(Number(amount.replace(',', '.')) * 100));
    if (!(cents > 0n)) {
      setMsg('that is not an amount');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await addEntry(conn, tab.id, what.trim(), cents);
      setWhat('');
      setAmount('');
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (typeof conn !== 'object') return;
    setBusy(true);
    try {
      await joinTab(conn, tab.id);
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="watch">
      <div className="watch-head">
        <span className="label">{tab.name}</span>
        <span className="na mono">
          {money(total)} {tab.unit}
        </span>
      </div>

      <div className="members">
        {tab.members.map((m) => {
          const v = net.get(m.toString()) ?? 0n;
          return (
            <span key={m.toString()} className={`member ${v > 0n ? 'up' : v < 0n ? 'down' : ''}`}>
              {who(m)}
              <em>
                {v > 0n ? '+' : ''}
                {money(v)}
              </em>
            </span>
          );
        })}
      </div>

      {owed.length ? (
        <ul className="settle">
          {owed.map((s, i) => (
            <li key={i}>
              <strong>{who(s.from)}</strong> pays <strong>{who(s.to)}</strong>{' '}
              <span className="mono">
                {money(s.amount)} {tab.unit}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="na small">Nothing outstanding.</p>
      )}

      {tab.entries.length ? (
        <ul className="entries">
          {tab.entries.map((e) => (
            <li key={e.id}>
              <span className="e-what">{e.what}</span>
              <span className="na e-who">{who(e.payer)}</span>
              <span className="mono e-amt">{money(e.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {typeof conn === 'object' ? (
        inIt ? (
          <div className="add-row">
            <input placeholder="what was it for" value={what} onChange={(e) => setWhat(e.target.value)} />
            <input
              placeholder="0.00"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="primary" disabled={busy || !what.trim() || !amount} onClick={add}>
              {busy ? '…' : 'I paid this'}
            </button>
          </div>
        ) : (
          <div className="watch-foot">
            <button className="ghost" disabled={busy} onClick={join}>
              Join this tab
            </button>
            <span className="na">joining is permanent, because being there was</span>
          </div>
        )
      ) : null}
      {msg ? <p className="note">{msg}</p> : null}
    </article>
  );
}

/* -------------------------------------------------------------- new tab -- */
function NewTab({ signer, onDone }: { signer: Signer; onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('EUR');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      await openTab(signer, name.trim(), unit.trim());
      await onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <section className="panel maker">
      <h2>A new tab</h2>
      <label className="field">
        <span>What is it for?</span>
        <input value={name} maxLength={80} placeholder="Berlin trip" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Counting in</span>
        <input value={unit} maxLength={12} onChange={(e) => setUnit(e.target.value)} />
      </label>
      <div className="watch-foot">
        <button className="primary" disabled={busy || !name.trim()} onClick={send}>
          {busy ? 'signing…' : 'Open it'}
        </button>
        <span className="na">anyone with a mask can join and add to it</span>
      </div>
      {msg ? <p className="note">{msg}</p> : null}
    </section>
  );
}

function hint(c: Exclude<Conn, Signer>): string {
  if (c === 'checking') return 'looking for your wallet…';
  if (c === 'nohost') return 'Open this in the Polkadot app to add to a tab. Reading works anywhere.';
  if (c === 'nowallet') return 'Log in to add to a tab';
  if (c === 'timeout') return 'your wallet did not answer in time';
  return 'adding needs a Peoplebook mask';
}
