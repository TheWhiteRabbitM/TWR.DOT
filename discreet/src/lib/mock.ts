import type {
  Booking,
  BookingState,
  DiscreetDriver,
  KeptWord,
  Service,
  ServiceConfig,
  Slot,
} from './types';

/**
 * Demo data layer — the exact Discreet.sol state machine run locally, so the
 * whole product is walkable by anyone without personhood. You play BOTH sides:
 * book as a client and manage your own listed services as a provider.
 */
const KEY = 'discreet:demo:v1';
const YOU = 'demo-you';

const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);

function cfg(partial: Partial<ServiceConfig>): ServiceConfig {
  return {
    depositMilli: 0,
    capacity: 1,
    cancelWindowSec: 24 * HOUR,
    autoConfirm: true,
    clientTier: 1,
    ...partial,
  };
}

interface State {
  services: Service[];
  slots: Slot[];
  bookings: Booking[];
  kept: Record<string, KeptWord>;
}

/** Future slots for a service: next `days` days at the given local hours. */
function makeSlots(serviceId: number, firstId: number, days: number, hours: number[], durationSec: number): Slot[] {
  const out: Slot[] = [];
  const base = new Date();
  base.setMinutes(0, 0, 0);
  let id = firstId;
  for (let d = 1; d <= days; d += 1) {
    for (const h of hours) {
      const t = new Date(base);
      t.setDate(t.getDate() + d);
      t.setHours(h);
      out.push({
        id: id++,
        serviceId,
        startsAt: Math.floor(t.getTime() / 1000),
        durationSec,
        booked: 0,
        closed: false,
      });
    }
  }
  return out;
}

function seed(): State {
  const services: Service[] = [
    {
      id: 0,
      provider: 'prov-a',
      name: 'Confidential counselling session',
      category: 'Wellbeing',
      description:
        'A 50-minute one-to-one session with a licensed counsellor. You book as an anonymous verified human — we never know your name, and nothing links this booking to you.',
      emoji: '🌱',
      createdAt: now() - 6 * 86400,
      paused: false,
      config: cfg({ depositMilli: 500, autoConfirm: false, clientTier: 1, cancelWindowSec: 48 * HOUR }),
    },
    {
      id: 1,
      provider: 'prov-b',
      name: 'Rapid STI testing — walk-in slot',
      category: 'Health',
      description:
        'Anonymous rapid testing at a partner clinic. Show the booking code at the desk; no personal data is taken at any point.',
      emoji: '🩺',
      createdAt: now() - 5 * 86400,
      paused: false,
      config: cfg({ depositMilli: 0, autoConfirm: true, clientTier: 1, cancelWindowSec: 6 * HOUR }),
    },
    {
      id: 2,
      provider: 'prov-c',
      name: 'Debt & budgeting first consultation',
      category: 'Legal & money',
      description:
        'Free 40-minute consultation with a debt advisor. The deposit exists only to protect the slot and returns when you attend.',
      emoji: '💶',
      createdAt: now() - 4 * 86400,
      paused: false,
      config: cfg({ depositMilli: 300, autoConfirm: true, clientTier: 2, cancelWindowSec: 24 * HOUR }),
    },
    {
      id: 3,
      provider: 'prov-d',
      name: 'Morning yoga — small group',
      category: 'Classes',
      description:
        'Group class, eight mats. Booking anonymously keeps the roster clean without collecting anyone’s contacts.',
      emoji: '🧘',
      createdAt: now() - 3 * 86400,
      paused: false,
      config: cfg({ depositMilli: 200, capacity: 8, autoConfirm: true, cancelWindowSec: 12 * HOUR }),
    },
    {
      id: 4,
      provider: 'prov-e',
      name: 'Barber — classic cut',
      category: 'Beauty',
      description: 'Thirty minutes, sharp fade, zero small talk if you prefer. Deposit beats no-shows.',
      emoji: '💈',
      createdAt: now() - 2 * 86400,
      paused: false,
      config: cfg({ depositMilli: 250, autoConfirm: true, cancelWindowSec: 4 * HOUR }),
    },
  ];

  let slotId = 0;
  const slots: Slot[] = [];
  const push = (s: Slot[]) => {
    slots.push(...s);
    slotId += s.length;
  };
  push(makeSlots(0, slotId, 5, [10, 15, 18], 50 * 60));
  push(makeSlots(1, slotId, 4, [9, 11, 14, 16], 20 * 60));
  push(makeSlots(2, slotId, 5, [10, 17], 40 * 60));
  push(makeSlots(3, slotId, 6, [7, 8], 60 * 60));
  push(makeSlots(4, slotId, 4, [9, 10, 11, 15, 16, 17], 30 * 60));

  // a little life in the book
  slots[1].booked = 1;
  slots[10].booked = 1;
  const g = slots.find((s) => s.serviceId === 3);
  if (g) g.booked = 5;

  return {
    services,
    slots,
    bookings: [],
    kept: { [YOU]: { kept: 4, missed: 0, cancelled: 1 } },
  };
}

function read(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* ignore */
  }
  const s = seed();
  write(s);
  return s;
}

function write(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* non-fatal */
  }
}

function kw(s: State, alias: string): KeptWord {
  return (s.kept[alias] ??= { kept: 0, missed: 0, cancelled: 0 });
}

export function createMockDriver(): DiscreetDriver {
  return {
    demo: true,
    aliasOf: () => YOU,

    async services() {
      return read().services.filter((s) => !s.paused);
    },

    async slotsOf(serviceId) {
      const t = now();
      return read()
        .slots.filter((s) => s.serviceId === serviceId && !s.closed && s.startsAt > t)
        .sort((a, b) => a.startsAt - b.startsAt);
    },

    async book(serviceId, slotId, note) {
      const s = read();
      const service = s.services[serviceId];
      const slot = s.slots.find((x) => x.id === slotId && x.serviceId === serviceId);
      if (!service || !slot) throw new Error('unknown slot');
      if (slot.booked >= service.config.capacity) throw new Error('slot full');
      const active = s.bookings.filter(
        (b) => b.client === YOU && (b.state === 'requested' || b.state === 'confirmed'),
      );
      if (active.some((b) => b.slotId === slotId)) throw new Error('already booked');
      if (active.length >= 3) throw new Error('too many active bookings');

      slot.booked += 1;
      const booking: Booking = {
        id: s.bookings.length,
        client: YOU,
        serviceId,
        slotId,
        depositMilli: service.config.depositMilli,
        state: service.config.autoConfirm ? 'confirmed' : 'requested',
        at: now(),
        note,
      };
      s.bookings.push(booking);
      write(s);
      return booking;
    },

    async cancel(bookingId) {
      const s = read();
      const b = s.bookings[bookingId];
      if (!b || b.client !== YOU) throw new Error('unknown booking');
      if (b.state !== 'requested' && b.state !== 'confirmed') throw new Error('not cancellable');
      const slot = s.slots.find((x) => x.id === b.slotId);
      if (slot && slot.booked > 0) slot.booked -= 1;
      b.state = 'cancelled';
      kw(s, YOU).cancelled += 1;
      write(s);
      return b;
    },

    async myBookings() {
      return read()
        .bookings.filter((b) => b.client === YOU)
        .sort((a, b) => b.at - a.at);
    },

    async keptWord() {
      const s = read();
      return kw(s, YOU);
    },

    async myServices() {
      return read().services.filter((s) => s.provider === YOU);
    },

    async allSlotsOf(serviceId) {
      return read()
        .slots.filter((s) => s.serviceId === serviceId)
        .sort((a, b) => a.startsAt - b.startsAt);
    },

    async listService(input) {
      const s = read();
      const service: Service = {
        id: s.services.length,
        provider: YOU,
        name: input.name,
        category: input.category,
        description: input.description,
        emoji: '🗓',
        createdAt: now(),
        paused: false,
        config: input.config,
      };
      s.services.push(service);
      write(s);
      return service;
    },

    async addSlots(serviceId, startTimes, durationSec) {
      const s = read();
      let id = s.slots.length ? Math.max(...s.slots.map((x) => x.id)) + 1 : 0;
      const created: Slot[] = startTimes.map((t) => ({
        id: id++,
        serviceId,
        startsAt: t,
        durationSec,
        booked: 0,
        closed: false,
      }));
      s.slots.push(...created);
      write(s);
      return created;
    },

    async requestsFor(serviceId) {
      return read()
        .bookings.filter((b) => b.serviceId === serviceId)
        .sort((a, b) => b.at - a.at);
    },

    async decide(bookingId, accept) {
      const s = read();
      const b = s.bookings[bookingId];
      if (!b || b.state !== 'requested') throw new Error('not pending');
      if (accept) b.state = 'confirmed';
      else {
        b.state = 'declined';
        const slot = s.slots.find((x) => x.id === b.slotId);
        if (slot && slot.booked > 0) slot.booked -= 1;
      }
      write(s);
      return b;
    },

    async settle(bookingId, attended) {
      const s = read();
      const b = s.bookings[bookingId];
      if (!b || b.state !== 'confirmed') throw new Error('not confirmed');
      b.state = (attended ? 'completed' : 'noshow') as BookingState;
      const rec = kw(s, b.client);
      if (attended) rec.kept += 1;
      else rec.missed += 1;
      write(s);
      return b;
    },
  };
}

export function resetDemo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
