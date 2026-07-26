/** Human-language helpers: nobody should ever read hex or ISO dates here. */

const ADJECTIVES = [
  'Quiet', 'Bright', 'Steady', 'Gentle', 'Bold', 'Calm', 'Swift', 'Honest',
  'Patient', 'Clear', 'Warm', 'Brave', 'Plain', 'Keen', 'Early', 'Lively',
  'Frank', 'Mild', 'Sharp', 'Sound', 'True', 'Fair', 'Firm', 'Free',
];
const NOUNS = [
  'Heron', 'Lantern', 'Harbor', 'Meadow', 'Signal', 'Anchor', 'Beacon', 'Cedar',
  'Compass', 'Falcon', 'Garden', 'Bridge', 'Willow', 'Summit', 'Prairie', 'Harvest',
  'Quarry', 'Sparrow', 'Terrace', 'Mill', 'Orchard', 'Haven', 'Fjord', 'Grove',
];

/**
 * A readable, stable name derived from the anonymous signature id. Reveals
 * nothing; the same person is the same name everywhere in this app.
 */
export function friendlyName(alias: string): string {
  let h = 0;
  for (let i = 0; i < alias.length; i += 1) h = (h * 31 + alias.charCodeAt(i)) >>> 0;
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[(h >>> 5) % NOUNS.length]}`;
}

/** "today", "yesterday", "5 days ago". */
export function timeAgo(unixSeconds: number): string {
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
