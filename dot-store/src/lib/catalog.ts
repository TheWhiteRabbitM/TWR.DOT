import appsRaw from '../data/apps.json';
import shotsRaw from '../data/shots.json';
import { GATEWAY, OPEN_HINT } from './config';

/**
 * The store's shelves.
 *
 * dot-store has no crawler of its own: the catalog is the directory dotmetrics
 * indexes hourly from the chain, copied in at build time, plus the screenshots
 * its weekly capture job renders. Two front-ends, one pipeline — dotmetrics is
 * the index, this is the shop window.
 */

interface RawApp {
  label?: string;
  domain?: string;
  url?: string;
  owner?: string;
  displayName?: string;
  description?: string;
  contenthash?: string;
  iconCid?: string;
  firstSeenAt?: number;
  tier?: number;
  /** keccak256(label), baked at build time — the AppReviews key. */
  key?: string;
  /** Bulletin CIDs the app's OWNER declared in a `screenshots` text record. */
  screenshots?: string[];
}

export interface Shot {
  file: string;
  w: number;
  h: number;
  /**
   * Who made this picture.
   *
   * `owner` — the app's own developer declared it in a `screenshots` text
   * record on their name. We cannot review submissions the way an app store
   * does, so it is labelled rather than trusted silently.
   * `captured` — dot-store's weekly job rendered the app itself.
   */
  from?: 'owner' | 'captured';
}

export interface App {
  label: string;
  domain: string;
  /** Where "Open" goes — the shell, told to resolve through the RPC gateway. */
  openUrl: string;
  name: string;
  description: string;
  owner: string;
  /** Published (manifest) / deployed (bundle only) / just a registered name. */
  tier: 0 | 1 | 2;
  iconUrl: string | null;
  /** The picture to lead with: the owner's first shot if they declared one. */
  shot: Shot | null;
  /**
   * Everything we can show, owner-supplied first, our capture last.
   *
   * Kept as a list rather than one image because the product page shows a
   * gallery, and because an owner-declared CID can stop resolving at any time —
   * Bulletin retention is about 14 days. The store renders the next one down
   * when an image fails to load, so a lapsed CID degrades instead of leaving a
   * hole.
   */
  shots: Shot[];
  firstSeenAt: number;
  /** AppReviews key for this app. */
  key: string;
}

const shots = shotsRaw as Record<string, Shot>;

/** Deterministic, calm gradient for an app with no screenshot and no icon. */
export function tint(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  return `linear-gradient(150deg, hsl(${h} 42% 22%), hsl(${(h + 40) % 360} 38% 13%))`;
}

export function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

function build(): App[] {
  const out: App[] = [];
  for (const [label, r0] of Object.entries(appsRaw as Record<string, unknown>)) {
    if (label === 'excluded' || !r0 || typeof r0 !== 'object') continue;
    const r = r0 as RawApp;
    if (!r.key) continue; // no baked key: we could not ask the chain about it
    const domain = r.domain ?? `${label}.dot`;
    const base = r.url && /^https:\/\//.test(r.url) ? r.url : `https://${label}.dev-dot.li`;
    const hasHash = typeof r.contenthash === 'string' && r.contenthash.length > 0;
    const published = Boolean(r.displayName || r.description);

    // The owner's own artwork goes first: they know their app better than a
    // headless browser does. Ours is kept underneath as the fallback, so a
    // developer whose CID has fallen off the network still has a picture.
    const declared: Shot[] = (r.screenshots ?? []).map((cid) => ({
      file: `${GATEWAY}/ipfs/${cid}`,
      // The dimensions of a remote image are unknown until it loads; the frame
      // is a fixed phone aspect anyway, so 0 means "let the CSS decide".
      w: 0,
      h: 0,
      from: 'owner' as const,
    }));
    const captured = shots[label] ? [{ ...shots[label], from: 'captured' as const }] : [];
    const all = [...declared, ...captured];

    out.push({
      label,
      domain,
      openUrl: base + (base.includes('?') ? '&' : '?') + OPEN_HINT,
      name: r.displayName || label,
      description: r.description ?? '',
      owner: r.owner ?? '',
      tier: published ? 0 : hasHash ? 1 : 2,
      iconUrl: r.iconCid ? `${GATEWAY}/ipfs/${r.iconCid}` : null,
      shot: all[0] ?? null,
      shots: all,
      firstSeenAt: r.firstSeenAt ?? 0,
      key: r.key,
    });
  }
  // Newest first: a store leads with what just arrived.
  return out.sort((a, b) => b.firstSeenAt - a.firstSeenAt);
}

export const CATALOG: App[] = build();

/** The shelf: apps with a real screenshot, which is what makes a storefront. */
export const FEATURED: App[] = CATALOG.filter((a) => a.shot);

export function findApp(label: string): App | undefined {
  return CATALOG.find((a) => a.label === label);
}

export function search(q: string): App[] {
  const s = q.trim().toLowerCase();
  if (!s) return CATALOG;
  return CATALOG.filter(
    (a) =>
      a.label.includes(s) ||
      a.name.toLowerCase().includes(s) ||
      a.description.toLowerCase().includes(s) ||
      a.owner.toLowerCase().includes(s),
  );
}
