/** Friendly, stable pseudonym from an alias — the same idea as OpenPetition's
 *  "Calm Cedar", so a verified human reads as a person, not a hash. */
const ADJ = [
  'Calm', 'Bright', 'Swift', 'Kind', 'Bold', 'Warm', 'Clever', 'Gentle', 'Honest', 'Quiet',
  'Sunny', 'Brave', 'Noble', 'Lively', 'Merry', 'Wise', 'Fair', 'Keen', 'Loyal', 'Vivid',
];
const NOUN = [
  'Cedar', 'River', 'Falcon', 'Harbor', 'Meadow', 'Comet', 'Lantern', 'Sparrow', 'Willow',
  'Beacon', 'Pine', 'Otter', 'Ember', 'Aspen', 'Heron', 'Cove', 'Finch', 'Maple', 'Wren', 'Reef',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pseudonym(alias: string): string {
  const h = hash(alias);
  // `>>>` (unsigned) — a signed shift can go negative for hashes above 2^31 and
  // index off the end of the array.
  return `${ADJ[h % ADJ.length]} ${NOUN[(h >>> 8) % NOUN.length]}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function avatarColor(alias: string): string {
  const h = hash(alias) % 360;
  return `hsl(${h} 62% 48%)`;
}

export function timeAgo(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** Category → emoji for the place pin, from common OSM amenity/shop tags. */
const CATEGORY_EMOJI: Record<string, string> = {
  restaurant: '🍽️',
  cafe: '☕️',
  bar: '🍸',
  pub: '🍺',
  bakery: '🥐',
  pizza: '🍕',
  'ice cream': '🍦',
  hotel: '🏨',
  pharmacy: '💊',
  hospital: '🏥',
  supermarket: '🛒',
  shop: '🛍️',
  bookshop: '📚',
  gym: '🏋️',
  park: '🌳',
  museum: '🏛️',
  cinema: '🎬',
  beach: '🏖️',
  hairdresser: '💈',
  bank: '🏦',
  fuel: '⛽️',
  school: '🏫',
};

export function categoryEmoji(category: string): string {
  const c = category.toLowerCase();
  for (const [k, v] of Object.entries(CATEGORY_EMOJI)) if (c.includes(k)) return v;
  return '📍';
}

/** A rich two-stop gradient per category family — the colour of each card. */
const GRADIENTS: [RegExp, string][] = [
  [/pizza|restaurant|trattoria|osteria|food|fast/i, 'linear-gradient(135deg,#ff8a3d,#ff3d6e)'],
  [/cafe|coffee|caff/i, 'linear-gradient(135deg,#c79a6b,#7b4a2e)'],
  [/bar|pub|wine|cocktail/i, 'linear-gradient(135deg,#b06cff,#7a3dff)'],
  [/ice cream|gelat|bakery|pastry|dessert/i, 'linear-gradient(135deg,#ff9ec7,#ff6aa0)'],
  [/book|museum|art|gallery|culture|theatre|cinema/i, 'linear-gradient(135deg,#4d8bff,#5340ff)'],
  [/hotel|hostel|guest/i, 'linear-gradient(135deg,#3dd4c0,#2b8fb0)'],
  [/shop|store|market|supermarket|mall/i, 'linear-gradient(135deg,#2fd67a,#12a5b0)'],
  [/park|beach|garden|nature/i, 'linear-gradient(135deg,#5fd35f,#2fa36b)'],
];

export function categoryGradient(category: string): string {
  for (const [re, g] of GRADIENTS) if (re.test(category)) return g;
  return 'linear-gradient(135deg,#8e9bb3,#5b6b86)';
}

/** Broad family for the filter chips. */
export const FAMILIES: { key: string; label: string; emoji: string; match: RegExp }[] = [
  { key: 'food', label: 'Food', emoji: '🍽️', match: /pizza|restaurant|trattoria|osteria|food|fast/i },
  { key: 'cafe', label: 'Cafés', emoji: '☕️', match: /cafe|coffee|caff/i },
  { key: 'bar', label: 'Bars', emoji: '🍸', match: /bar|pub|wine|cocktail/i },
  { key: 'sweet', label: 'Sweet', emoji: '🍦', match: /ice cream|gelat|bakery|pastry|dessert/i },
  { key: 'culture', label: 'Culture', emoji: '🏛️', match: /book|museum|art|gallery|culture|theatre|cinema/i },
  { key: 'shop', label: 'Shops', emoji: '🛍️', match: /shop|store|market|supermarket|mall/i },
];

export function starWord(rating: number): string {
  return ['Tap a star', 'Terrible', 'Poor', 'Okay', 'Good', 'Excellent'][Math.round(rating)] ?? '';
}
