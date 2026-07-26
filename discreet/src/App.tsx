import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Booking, DiscreetDriver, KeptWord, Service, ServiceConfig, Slot } from './lib/types';
import { createMockDriver } from './lib/mock';
import { categoryGradient } from './lib/theme';
import { readContractStatus } from './lib/chain';
import { DEMO_ENABLED, DISCREET_CONTRACT } from './lib/config';
import { Splash } from './Splash';
import { Console } from './Console';
import { openAppChat } from './lib/host-chat';

/* --------------------------------------------------------------- helpers */

const CATS = ['All', 'Wellbeing', 'Health', 'Legal & money', 'Classes', 'Beauty'];

function dayLabel(t: number): string {
  const d = new Date(t * 1000);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

function timeLabel(t: number): string {
  return new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function money(milli: number): string {
  return milli === 0 ? 'Free to book' : `${(milli / 1000).toFixed(2)} PAS deposit`;
}

function windowLabel(sec: number): string {
  const h = Math.round(sec / 3600);
  return h >= 24 ? `${Math.round(h / 24)}d` : `${h}h`;
}

const STATE_LABEL: Record<Booking['state'], string> = {
  requested: 'Awaiting approval',
  confirmed: 'Confirmed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  completed: 'Attended',
  noshow: 'No-show',
};

function useScrolled(threshold = 40): boolean {
  const [s, setS] = useState(false);
  useEffect(() => {
    const on = () => setS(window.scrollY > threshold);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [threshold]);
  return s;
}

function NavBar({ title, large, onBack }: { title: string; large?: string; onBack?: () => void }) {
  const scrolled = useScrolled();
  return (
    <div className={`nav${scrolled ? ' scrolled' : ''}`}>
      <div className="nav-bar">
        {onBack ? (
          <button className="nav-btn" onClick={onBack}>
            <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 2L2 10l8 8" />
            </svg>
            Back
          </button>
        ) : (
          <span className="nav-spacer" />
        )}
        <span className="nav-title">{title}</span>
        <span className="nav-spacer" />
      </div>
      {large && <h1 className="large-title">{large}</h1>}
    </div>
  );
}

/**
 * Live status of the deployed Discreet contract, read on every load — plus the
 * demo notice while personhood is limited (gated by DEMO_ENABLED, so it
 * disappears with one flag flip when personhood opens to everyone).
 */
function ChainChip() {
  const [state, setState] = useState<'checking' | 'off' | { services: number; bookings: number }>(
    'checking',
  );
  useEffect(() => {
    let cancelled = false;
    readContractStatus()
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState('off'));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className={`chain-chip${state === 'off' ? ' is-off' : ''}`} title={DISCREET_CONTRACT}>
      <span className="chain-dot" />
      <span>
        {state === 'checking'
          ? 'Reaching the Discreet contract on Asset Hub…'
          : state === 'off'
            ? 'Contract unreachable right now — demo data only'
            : `Contract live on-chain · ${state.services} service${state.services === 1 ? '' : 's'} · ${state.bookings} booking${state.bookings === 1 ? '' : 's'}`}
        {DEMO_ENABLED && (
          <>
            {' '}
            — <b>you're in the demo</b>: full experience, nothing written to the chain, until
            personhood opens to everyone.
          </>
        )}
      </span>
    </div>
  );
}

/** One-tap link into the Polkadot app's built-in chat. */
function ChatButton() {
  const [label, setLabel] = useState('💬 Discreet community chat');
  const go = async () => {
    setLabel('Opening…');
    const r = await openAppChat('discreetly', 'Discreet community');
    if (r === 'outside') setLabel('Chat lives inside the Polkadot app');
    else if (r === 'failed') setLabel('Chat unavailable right now');
    else setLabel('Room added to your Polkadot chat ✓');
    window.setTimeout(() => setLabel('💬 Discreet community chat'), 2600);
  };
  return (
    <button type="button" className="chat-cta" onClick={go}>
      {label}
    </button>
  );
}

const LOCK = (
  <svg className="promise-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="10" width="14" height="10" rx="3" />
    <path d="M8 10V8a4 4 0 118 0v2" />
  </svg>
);

/* ---------------------------------------------------------------- browse */

function Browse({
  driver,
  onOpen,
}: {
  driver: DiscreetDriver;
  onOpen: (s: Service) => void;
}) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [cat, setCat] = useState('All');

  useEffect(() => {
    void driver.services().then(setServices);
  }, [driver]);

  const list = useMemo(
    () => (services ?? []).filter((s) => cat === 'All' || s.category === cat),
    [services, cat],
  );

  return (
    <div className="screen">
      <NavBar title="Discreet" large="Book privately" />
      <div className="trust-row">
        <span className="trust">{LOCK} No identity shared</span>
        <span className="trust">
          <svg className="promise-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M5 20c1.3-3.5 4-5 7-5s5.7 1.5 7 5" />
          </svg>
          One human per booking
        </span>
        <span className="trust">
          <svg className="promise-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l8 3v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          Deposits in escrow
        </span>
      </div>

      <ChainChip />
      <ChatButton />

      <div className="chips-row">
        {CATS.map((c) => (
          <button key={c} className={`fchip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className="section-hd">Services</div>
      {services == null ? (
        <div className="empty">Loading…</div>
      ) : list.length === 0 ? (
        <div className="empty">Nothing in this category yet.</div>
      ) : (
        <div className="svc-list">
          {list.map((s, i) => (
            <button key={s.id} className="svc" style={{ animationDelay: `${i * 45}ms` }} onClick={() => onOpen(s)}>
              <span className="svc-banner" style={{ backgroundImage: categoryGradient(s.category) }}>
                <span className="svc-banner-emoji" aria-hidden="true">
                  {s.emoji}
                </span>
                <span className="svc-banner-cat">{s.category}</span>
                <span className="svc-banner-price">{money(s.config.depositMilli)}</span>
              </span>
              <span className="svc-body">
                <span className="svc-name">{s.name}</span>
                <p className="svc-desc">{s.description}</p>
                <span className="svc-meta">
                  {s.config.capacity > 1 && <span className="pill">👥 {s.config.capacity} seats</span>}
                  <span className="pill">{s.config.autoConfirm ? '⚡ instant confirm' : '✋ provider approves'}</span>
                  <span className="pill">↩ free ≥{windowLabel(s.config.cancelWindowSec)} before</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- detail */

function Detail({
  driver,
  service,
  onBack,
  onBooked,
}: {
  driver: DiscreetDriver;
  service: Service;
  onBack: () => void;
  onBooked: (b: Booking) => void;
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [sheet, setSheet] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(() => {
    void driver.slotsOf(service.id).then(setSlots);
  }, [driver, service.id]);
  useEffect(load, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const k = dayLabel(s.startsAt);
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    return [...m.entries()];
  }, [slots]);

  const closeSheet = () => {
    setClosing(true);
    window.setTimeout(() => {
      setSheet(false);
      setClosing(false);
    }, 280);
  };

  const confirm = async () => {
    if (!picked || busy) return;
    setBusy(true);
    try {
      const b = await driver.book(service.id, picked.id, note.trim());
      setSheet(false);
      onBooked(b);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <NavBar title={service.name} onBack={onBack} />
      <div className="dhero" style={{ backgroundImage: categoryGradient(service.category) }}>
        <span className="dhero-emoji" aria-hidden="true">
          {service.emoji}
        </span>
        <div className="dhero-cat">{service.category}</div>
        <div className="dhero-name">{service.name}</div>
        <p className="dhero-desc">{service.description}</p>
      </div>

      <div className="terms is-floating">
        <div className="term">
          <span className="term-l">Deposit</span>
          <span className="term-v">{money(service.config.depositMilli)}</span>
        </div>
        <div className="term">
          <span className="term-l">Confirmation</span>
          <span className="term-v">{service.config.autoConfirm ? 'Instant' : 'Provider approves'}</span>
        </div>
        <div className="term">
          <span className="term-l">Free cancellation</span>
          <span className="term-v">up to {windowLabel(service.config.cancelWindowSec)} before</span>
        </div>
        <div className="term">
          <span className="term-l">Identity shared</span>
          <span className="term-v">None — alias only</span>
        </div>
      </div>

      {slots == null ? (
        <div className="empty">Loading slots…</div>
      ) : byDay.length === 0 ? (
        <div className="empty">No open slots right now — check back soon.</div>
      ) : (
        byDay.map(([day, list]) => (
          <div key={day}>
            <div className="day-hd">{day}</div>
            <div className="slot-row">
              {list.map((s) => {
                const full = s.booked >= service.config.capacity;
                const on = picked?.id === s.id;
                return (
                  <button
                    key={s.id}
                    className={`slot${on ? ' on' : ''}${full ? ' full' : ''}`}
                    disabled={full}
                    onClick={() => setPicked(on ? null : s)}
                  >
                    {timeLabel(s.startsAt)}
                    {service.config.capacity > 1 && (
                      <small>
                        {service.config.capacity - s.booked} of {service.config.capacity} left
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      <div className="cta">
        <button className="btn filled block" disabled={!picked} onClick={() => setSheet(true)}>
          {picked ? `Book ${dayLabel(picked.startsAt)} · ${timeLabel(picked.startsAt)}` : 'Pick a time'}
        </button>
      </div>

      {sheet && picked && (
        <>
          <div className="backdrop" onClick={closeSheet} />
          <div className={`sheet${closing ? ' closing' : ''}`} role="dialog" aria-modal="true">
            <div className="grabber" />
            <div className="sheet-hd">
              <button className="nav-btn" onClick={closeSheet}>
                Cancel
              </button>
              <h2>Confirm booking</h2>
              <button className="nav-btn" onClick={confirm} disabled={busy}>
                {busy ? 'Booking…' : 'Book'}
              </button>
            </div>
            <div className="sheet-body">
              <div className="sheet-sum">
                <b>{service.name}</b>
                <br />
                {dayLabel(picked.startsAt)} at <b>{timeLabel(picked.startsAt)}</b> ·{' '}
                {Math.round(picked.durationSec / 60)} min
                <br />
                {money(service.config.depositMilli)}
                {service.config.depositMilli > 0 && ' — returned when you attend'}
                <br />
                Booked as <b>your anonymous alias</b>. No personal data leaves this device.
              </div>
              <div style={{ marginTop: 12 }}>
                <label className="f-label" htmlFor="note">
                  Private note to the provider (optional, encrypted)
                </label>
                <textarea
                  id="note"
                  className="f-area"
                  maxLength={280}
                  placeholder="Anything they should know — kept between your alias and them."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- bookings */

function Bookings({
  driver,
  services,
  refreshKey,
  onCancelled,
}: {
  driver: DiscreetDriver;
  services: Service[];
  refreshKey: number;
  onCancelled: () => void;
}) {
  const [list, setList] = useState<Booking[] | null>(null);
  const [kept, setKept] = useState<KeptWord | null>(null);

  useEffect(() => {
    void driver.myBookings().then(setList);
    void driver.keptWord().then(setKept);
  }, [driver, refreshKey]);

  const nameOf = (id: number) => services.find((s) => s.id === id);

  return (
    <div className="screen">
      <NavBar title="My bookings" large="My bookings" />
      {kept && (
        <div className="kept">
          <div className="kept-t">Your word · anonymous record</div>
          <div className="kept-row">
            <div>
              <div className="kept-n">{kept.kept}</div>
              <span className="kept-l">kept</span>
            </div>
            <div>
              <div className="kept-n">{kept.missed}</div>
              <span className="kept-l">missed</span>
            </div>
            <div>
              <div className="kept-n">{kept.cancelled}</div>
              <span className="kept-l">cancelled</span>
            </div>
          </div>
          <p className="kept-foot">
            This follows your alias, not your identity — providers can trust you without ever
            knowing who you are.
          </p>
        </div>
      )}
      <div className="section-hd">Bookings</div>
      {list == null ? (
        <div className="empty">Loading…</div>
      ) : list.length === 0 ? (
        <div className="empty">
          Nothing booked yet.
          <br />
          Find a service in Book and take a slot — anonymously.
        </div>
      ) : (
        <div className="bk-list">
          {list.map((b) => {
            const svc = nameOf(b.serviceId);
            const cancellable = b.state === 'requested' || b.state === 'confirmed';
            return (
              <div className="bk" key={b.id}>
                <div className="bk-top">
                  <span className="bk-name">
                    {svc?.emoji} {svc?.name ?? 'Service'}
                  </span>
                  <span className={`state ${b.state}`}>{STATE_LABEL[b.state]}</span>
                </div>
                <div className="bk-when">
                  Booked {new Date(b.at * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {b.depositMilli > 0 && ` · ${money(b.depositMilli)}`}
                </div>
                {cancellable && (
                  <div className="bk-actions">
                    <button
                      className="btn danger small"
                      onClick={() => {
                        void driver.cancel(b.id).then(() => onCancelled());
                      }}
                    >
                      Cancel booking
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- host */

const DEFAULT_CONFIG: ServiceConfig = {
  depositMilli: 0,
  capacity: 1,
  cancelWindowSec: 24 * 3600,
  autoConfirm: true,
  clientTier: 1,
};

function Host({
  driver,
  refreshKey,
  onChanged,
}: {
  driver: DiscreetDriver;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [mine, setMine] = useState<Service[] | null>(null);
  const [requests, setRequests] = useState<Booking[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Wellbeing');
  const [desc, setDesc] = useState('');
  const [config, setConfig] = useState<ServiceConfig>(DEFAULT_CONFIG);
  // Rota builder: which weekdays × which hours × how long × how many weeks.
  const [rotaDays, setRotaDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon..Fri
  const [rotaHours, setRotaHours] = useState<number[]>([10, 16]);
  const [rotaDur, setRotaDur] = useState(45);
  const [rotaWeeks, setRotaWeeks] = useState(2);

  useEffect(() => {
    void driver.myServices().then(async (list) => {
      setMine(list);
      const all: Booking[] = [];
      for (const s of list) all.push(...(await driver.requestsFor(s.id)));
      setRequests(all.sort((a, b) => b.at - a.at));
    });
  }, [driver, refreshKey]);

  const rotaCount = rotaDays.length * rotaHours.length * rotaWeeks;

  const create = async () => {
    if (name.trim().length < 4 || rotaCount === 0) return;
    const svc = await driver.listService({
      name: name.trim(),
      category,
      description: desc.trim(),
      config,
    });
    // Build the slot rota exactly as configured: chosen weekdays × hours × weeks.
    const times: number[] = [];
    const base = new Date();
    base.setMinutes(0, 0, 0);
    for (let d = 1; d <= rotaWeeks * 7; d += 1) {
      const t = new Date(base);
      t.setDate(t.getDate() + d);
      if (!rotaDays.includes(t.getDay())) continue;
      for (const h of rotaHours) {
        const x = new Date(t);
        x.setHours(h);
        times.push(Math.floor(x.getTime() / 1000));
      }
    }
    // Contract caps a single addSlots call at 48 — chunk like the chain would.
    for (let i = 0; i < times.length; i += 48) {
      await driver.addSlots(svc.id, times.slice(i, i + 48), rotaDur * 60);
    }
    setCreating(false);
    setName('');
    setDesc('');
    setConfig(DEFAULT_CONFIG);
    onChanged();
  };

  return (
    <div className="screen">
      <NavBar title="Provide" large="Provide" />
      <div className="promise">
        {LOCK}
        <span>
          <b>List anything bookable — on your terms.</b> Deposit, group size, approval mode,
          cancellation window, minimum verification: every rule is yours, enforced by the
          contract, and you never handle anyone's personal data.
        </span>
      </div>

      {!creating && (
        <div style={{ margin: '14px 16px 0' }}>
          <button className="btn filled block" onClick={() => setCreating(true)}>
            + List a new service
          </button>
        </div>
      )}

      {creating && (
        <>
          <div className="section-hd">New service</div>
          <div className="form">
            <div>
              <label className="f-label">What are you offering?</label>
              <input className="f-input" maxLength={80} placeholder="e.g. Evening guitar lessons" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {/* Chip groups, not native selects: dropdowns don't open inside the
                host shell's sandboxed iframe. */}
            <div>
              <label className="f-label">Category</label>
              <div className="optrow">
                {CATS.filter((c) => c !== 'All').map((c) => (
                  <button key={c} type="button" className={`opt${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="f-label">Seats per slot</label>
              <div className="optrow">
                {[1, 2, 4, 6, 8, 12, 20].map((n) => (
                  <button key={n} type="button" className={`opt${config.capacity === n ? ' on' : ''}`} onClick={() => setConfig({ ...config, capacity: n })}>
                    {n === 1 ? '1 · one-to-one' : n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="f-label">Deposit</label>
              <div className="optrow">
                {(
                  [
                    [0, 'None — trust'],
                    [200, '0.20 PAS'],
                    [500, '0.50 PAS'],
                    [1000, '1.00 PAS'],
                  ] as const
                ).map(([v, label]) => (
                  <button key={v} type="button" className={`opt${config.depositMilli === v ? ' on' : ''}`} onClick={() => setConfig({ ...config, depositMilli: v })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="f-label">Free cancel until</label>
              <div className="optrow">
                {[4, 12, 24, 48].map((h) => (
                  <button key={h} type="button" className={`opt${config.cancelWindowSec === h * 3600 ? ' on' : ''}`} onClick={() => setConfig({ ...config, cancelWindowSec: h * 3600 })}>
                    {h}h before
                  </button>
                ))}
              </div>
            </div>
            <div className="f-toggle">
              <span>Confirm bookings automatically</span>
              <button className={`switch${config.autoConfirm ? ' on' : ''}`} aria-pressed={config.autoConfirm} onClick={() => setConfig({ ...config, autoConfirm: !config.autoConfirm })} />
            </div>
            <div className="f-toggle">
              <span>Require full verification (tier 2)</span>
              <button className={`switch${config.clientTier === 2 ? ' on' : ''}`} aria-pressed={config.clientTier === 2} onClick={() => setConfig({ ...config, clientTier: config.clientTier === 2 ? 1 : 2 })} />
            </div>
            <div>
              <label className="f-label">Description</label>
              <textarea className="f-area" maxLength={400} placeholder="What happens, where, and anything a client should know." value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>

            <div>
              <label className="f-label">Opening rota — days</label>
              <div className="optrow">
                {(
                  [
                    [1, 'Mon'],
                    [2, 'Tue'],
                    [3, 'Wed'],
                    [4, 'Thu'],
                    [5, 'Fri'],
                    [6, 'Sat'],
                    [0, 'Sun'],
                  ] as const
                ).map(([d, label]) => (
                  <button
                    key={d}
                    type="button"
                    className={`opt${rotaDays.includes(d) ? ' on' : ''}`}
                    onClick={() =>
                      setRotaDays(
                        rotaDays.includes(d) ? rotaDays.filter((x) => x !== d) : [...rotaDays, d],
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="f-label">Times</label>
              <div className="optrow">
                {[7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20].map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`opt${rotaHours.includes(h) ? ' on' : ''}`}
                    onClick={() =>
                      setRotaHours(
                        rotaHours.includes(h)
                          ? rotaHours.filter((x) => x !== h)
                          : [...rotaHours, h].sort((a, b) => a - b),
                      )
                    }
                  >
                    {String(h).padStart(2, '0')}:00
                  </button>
                ))}
              </div>
            </div>
            <div className="f-row">
              <div>
                <label className="f-label">Slot length</label>
                <div className="optrow">
                  {[20, 30, 45, 60, 90].map((m) => (
                    <button key={m} type="button" className={`opt${rotaDur === m ? ' on' : ''}`} onClick={() => setRotaDur(m)}>
                      {m}m
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="f-label">Open for</label>
                <div className="optrow">
                  {[1, 2, 4].map((w) => (
                    <button key={w} type="button" className={`opt${rotaWeeks === w ? ' on' : ''}`} onClick={() => setRotaWeeks(w)}>
                      {w}w
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn quiet" onClick={() => setCreating(false)}>
                Discard
              </button>
              <button className="btn filled" style={{ flex: 1 }} disabled={name.trim().length < 4 || rotaCount === 0} onClick={create}>
                Publish — opens {rotaCount} slot{rotaCount === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="section-hd">Your services</div>
      {mine == null ? (
        <div className="empty">Loading…</div>
      ) : mine.length === 0 ? (
        <div className="empty">Nothing listed yet — you're one form away.</div>
      ) : (
        <div className="svc-list">
          {mine.map((s) => (
            <div key={s.id} className="svc" style={{ cursor: 'default' }}>
              <span className="svc-top">
                <span className="svc-emoji">{s.emoji}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="svc-name">{s.name}</span>
                  <span className="svc-cat" style={{ display: 'block' }}>
                    {s.category} · {money(s.config.depositMilli)}
                  </span>
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {mine != null && mine.length > 0 && (
        <Console driver={driver} services={mine} refreshKey={refreshKey} />
      )}

      {requests.length > 0 && (
        <>
          <div className="section-hd">Client bookings</div>
          <div className="bk-list">
            {requests.map((b) => (
              <div className="bk" key={b.id}>
                <div className="bk-top">
                  <span className="bk-name">Alias ····{b.client.slice(-4)}</span>
                  <span className={`state ${b.state}`}>{STATE_LABEL[b.state]}</span>
                </div>
                {b.note && <div className="bk-when">“{b.note}”</div>}
                <div className="bk-actions">
                  {b.state === 'requested' && (
                    <>
                      <button className="btn small filled" onClick={() => void driver.decide(b.id, true).then(onChanged)}>
                        Approve
                      </button>
                      <button className="btn small danger" onClick={() => void driver.decide(b.id, false).then(onChanged)}>
                        Decline
                      </button>
                    </>
                  )}
                  {b.state === 'confirmed' && (
                    <>
                      <button className="btn small tonal" onClick={() => void driver.settle(b.id, true).then(onChanged)}>
                        Mark attended
                      </button>
                      <button className="btn small quiet" onClick={() => void driver.settle(b.id, false).then(onChanged)}>
                        No-show
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- app */

const ICONS = {
  book: (on: boolean) => (
    <svg width="25" height="25" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="16" rx="4" />
      <path d="M8 3v4M16 3v4M4 10h16" stroke={on ? 'var(--bg)' : 'currentColor'} strokeLinecap="round" />
    </svg>
  ),
  mine: (on: boolean) => (
    <svg width="25" height="25" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3 8-8" />
      <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" />
    </svg>
  ),
  host: (on: boolean) => (
    <svg width="25" height="25" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
};

export function App() {
  const [driver] = useState<DiscreetDriver>(() => createMockDriver());
  const [splash, setSplash] = useState(true);
  const [tab, setTab] = useState<'book' | 'mine' | 'host'>('book');
  const [open, setOpen] = useState<Service | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void driver.services().then(setServices);
  }, [driver, refreshKey]);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2400);
  }, []);

  return (
    <div className="app">
      {splash && <Splash onDone={() => setSplash(false)} />}
      {open ? (
        <Detail
          driver={driver}
          service={open}
          onBack={() => setOpen(null)}
          onBooked={(b) => {
            setOpen(null);
            setTab('mine');
            bump();
            say(b.state === 'confirmed' ? 'Booked — see you there' : 'Requested — the provider will confirm');
          }}
        />
      ) : tab === 'book' ? (
        <Browse driver={driver} onOpen={setOpen} />
      ) : tab === 'mine' ? (
        <Bookings
          driver={driver}
          services={services}
          refreshKey={refreshKey}
          onCancelled={() => {
            bump();
            say('Booking cancelled');
          }}
        />
      ) : (
        <Host driver={driver} refreshKey={refreshKey} onChanged={bump} />
      )}

      {toast && <div className="toast">{toast}</div>}

      {!open && (
        <nav className="tabbar">
          <button className={`tab${tab === 'book' ? ' on' : ''}`} onClick={() => setTab('book')}>
            {ICONS.book(tab === 'book')}
            Book
          </button>
          <button className={`tab${tab === 'mine' ? ' on' : ''}`} onClick={() => setTab('mine')}>
            {ICONS.mine(tab === 'mine')}
            My bookings
          </button>
          <button className={`tab${tab === 'host' ? ' on' : ''}`} onClick={() => setTab('host')}>
            {ICONS.host(tab === 'host')}
            Provide
          </button>
        </nav>
      )}
    </div>
  );
}
