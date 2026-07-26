/**
 * Discreet's domain model — a 1:1 mirror of Discreet.sol so the demo driver and
 * the future in-host chain driver expose identical shapes.
 */

export interface ServiceConfig {
  /** Deposit per booking in milli-PAS for display (0 = trust mode, no escrow). */
  depositMilli: number;
  /** Seats per slot: 1 = one-to-one appointment, N = class/group. */
  capacity: number;
  /** Seconds before start until which cancelling refunds the deposit. */
  cancelWindowSec: number;
  /** Confirm instantly, or let the provider approve each request. */
  autoConfirm: boolean;
  /** Minimum client personhood tier (1 = Lite, 2 = Full). */
  clientTier: 1 | 2;
}

export interface Service {
  id: number;
  provider: string; // provider alias
  name: string;
  category: string;
  description: string;
  emoji: string;
  createdAt: number;
  paused: boolean;
  config: ServiceConfig;
}

export interface Slot {
  id: number;
  serviceId: number;
  startsAt: number;
  durationSec: number;
  booked: number;
  closed: boolean;
}

export type BookingState =
  | 'requested'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'completed'
  | 'noshow';

export interface Booking {
  id: number;
  client: string; // client alias — the only identity anywhere
  serviceId: number;
  slotId: number;
  depositMilli: number;
  state: BookingState;
  at: number;
  note: string;
}

/** Anonymous, portable reliability record of an alias. */
export interface KeptWord {
  kept: number;
  missed: number;
  cancelled: number;
}

export interface DiscreetDriver {
  readonly demo: boolean;
  /** Your alias (stable pseudonymous identity in this app). */
  aliasOf(): string;
  services(): Promise<Service[]>;
  slotsOf(serviceId: number): Promise<Slot[]>;
  /** Book a slot; returns the booking. */
  book(serviceId: number, slotId: number, note: string): Promise<Booking>;
  cancel(bookingId: number): Promise<Booking>;
  myBookings(): Promise<Booking[]>;
  keptWord(): Promise<KeptWord>;
  /** Provider side. */
  myServices(): Promise<Service[]>;
  /** Every slot of a service, past included — the console's calendar/report feed. */
  allSlotsOf(serviceId: number): Promise<Slot[]>;
  listService(input: {
    name: string;
    category: string;
    description: string;
    config: ServiceConfig;
  }): Promise<Service>;
  addSlots(serviceId: number, startTimes: number[], durationSec: number): Promise<Slot[]>;
  requestsFor(serviceId: number): Promise<Booking[]>;
  decide(bookingId: number, accept: boolean): Promise<Booking>;
  settle(bookingId: number, attended: boolean): Promise<Booking>;
}
