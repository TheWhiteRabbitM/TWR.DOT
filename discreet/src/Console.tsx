import { useEffect, useMemo, useState } from 'react';
import type { Booking, DiscreetDriver, Service, Slot } from './lib/types';

/**
 * The Business Console — the management half of Discreet. A provider sees
 * their whole week at a glance, their money, and their no-show rate, and can
 * export the book. All of it derives from the same state machine the contract
 * enforces; nothing here invents data the chain wouldn't hold.
 */

const DAY = 86_400;

function startOfWeek(now: number): number {
  const d = new Date(now * 1000);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return Math.floor(d.getTime() / 1000) - dow * DAY;
}

function hhmm(t: number): string {
  return new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

interface Cell {
  slot: Slot;
  service: Service;
  bookings: Booking[];
}

export function Console({
  driver,
  services,
  refreshKey,
}: {
  driver: DiscreetDriver;
  services: Service[];
  refreshKey: number;
}) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [weekOff, setWeekOff] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const allSlots: Slot[] = [];
      const allBookings: Booking[] = [];
      for (const s of services) {
        allSlots.push(...(await driver.allSlotsOf(s.id)));
        allBookings.push(...(await driver.requestsFor(s.id)));
      }
      if (!cancelled) {
        setSlots(allSlots);
        setBookings(allBookings);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driver, services, refreshKey]);

  const week0 = startOfWeek(Math.floor(Date.now() / 1000)) + weekOff * 7 * DAY;

  const days = useMemo(() => {
    const byId = new Map(services.map((s) => [s.id, s]));
    const out: { day: number; cells: Cell[] }[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d0 = week0 + i * DAY;
      const cells = slots
        .filter((s) => s.startsAt >= d0 && s.startsAt < d0 + DAY)
        .sort((a, b) => a.startsAt - b.startsAt)
        .map((slot) => ({
          slot,
          service: byId.get(slot.serviceId)!,
          bookings: bookings.filter(
            (b) =>
              b.slotId === slot.id &&
              b.serviceId === slot.serviceId &&
              (b.state === 'requested' || b.state === 'confirmed' || b.state === 'completed'),
          ),
        }))
        .filter((c) => c.service);
      out.push({ day: d0, cells });
    }
    return out;
  }, [slots, bookings, services, week0]);

  const report = useMemo(() => {
    let completed = 0;
    let noshow = 0;
    let cancelled = 0;
    let pending = 0;
    let heldMilli = 0;
    let earnedMilli = 0;
    for (const b of bookings) {
      if (b.state === 'completed') completed += 1;
      else if (b.state === 'noshow') {
        noshow += 1;
        earnedMilli += b.depositMilli; // forfeited deposits
      } else if (b.state === 'cancelled') cancelled += 1;
      else if (b.state === 'requested' || b.state === 'confirmed') {
        pending += 1;
        heldMilli += b.depositMilli; // sitting in escrow
      }
    }
    const settled = completed + noshow;
    return {
      completed,
      noshow,
      cancelled,
      pending,
      heldMilli,
      earnedMilli,
      reliability: settled ? Math.round((completed / settled) * 100) : null,
    };
  }, [bookings]);

  const exportCsv = () => {
    const byId = new Map(services.map((s) => [s.id, s]));
    const slotById = new Map(slots.map((s) => [`${s.serviceId}:${s.id}`, s]));
    const rows = [
      ['booking_id', 'service', 'slot_start_utc', 'state', 'deposit_milli', 'client_alias', 'booked_at_utc', 'note'],
      ...bookings.map((b) => {
        const slot = slotById.get(`${b.serviceId}:${b.slotId}`);
        return [
          String(b.id),
          byId.get(b.serviceId)?.name ?? String(b.serviceId),
          slot ? new Date(slot.startsAt * 1000).toISOString() : '',
          b.state,
          String(b.depositMilli),
          b.client,
          new Date(b.at * 1000).toISOString(),
          b.note.replaceAll('"', "'"),
        ];
      }),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = 'discreet-bookings.csv';
    a.click();
  };

  if (services.length === 0) return null;

  const weekLabel = new Date(week0 * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <>
      <div className="section-hd">Business console</div>

      <div className="report">
        <div className="rep-cell">
          <span className="rep-n">{report.pending}</span>
          <span className="rep-l">upcoming</span>
        </div>
        <div className="rep-cell">
          <span className="rep-n">{report.completed}</span>
          <span className="rep-l">attended</span>
        </div>
        <div className="rep-cell">
          <span className="rep-n">{report.noshow}</span>
          <span className="rep-l">no-shows</span>
        </div>
        <div className="rep-cell">
          <span className="rep-n">
            {report.reliability == null ? '—' : `${report.reliability}%`}
          </span>
          <span className="rep-l">show-up rate</span>
        </div>
        <div className="rep-cell">
          <span className="rep-n">{(report.heldMilli / 1000).toFixed(2)}</span>
          <span className="rep-l">PAS in escrow</span>
        </div>
        <div className="rep-cell">
          <span className="rep-n">{(report.earnedMilli / 1000).toFixed(2)}</span>
          <span className="rep-l">PAS from no-shows</span>
        </div>
      </div>

      <div className="week-nav">
        <button className="btn quiet small" onClick={() => setWeekOff(weekOff - 1)}>
          ‹ prev
        </button>
        <span className="week-label">Week of {weekLabel}</span>
        <button className="btn quiet small" onClick={() => setWeekOff(weekOff + 1)}>
          next ›
        </button>
        <button className="btn tonal small" onClick={exportCsv}>
          ⬇ CSV
        </button>
      </div>

      <div className="week">
        {days.map(({ day, cells }) => (
          <div className="wday" key={day}>
            <div className="wday-hd">
              {new Date(day * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
            </div>
            {cells.length === 0 ? (
              <div className="wday-empty">—</div>
            ) : (
              cells.map((c) => {
                const taken = c.slot.booked;
                const cap = c.service.config.capacity;
                const full = taken >= cap;
                return (
                  <div
                    className={`wcell${full ? ' is-full' : taken > 0 ? ' is-part' : ''}`}
                    key={`${c.slot.serviceId}:${c.slot.id}`}
                    title={`${c.service.name} · ${taken}/${cap} booked`}
                  >
                    <b>{hhmm(c.slot.startsAt)}</b>
                    <span>{c.service.emoji}</span>
                    <i>
                      {taken}/{cap}
                    </i>
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>
    </>
  );
}
