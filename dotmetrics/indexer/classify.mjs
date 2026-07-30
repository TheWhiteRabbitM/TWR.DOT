/**
 * classify.mjs — put every .dot app in a category, from evidence.
 *
 * WHY THIS IS AWKWARD, STATED UP FRONT
 *   49 of 79 names publish no description at all. Classifying those from the
 *   label would be fortune-telling: `contribnet01` and `giganetwork` and
 *   `polkaportal03` tell you nothing. So this reads, in order of authority:
 *
 *     1. a `category` text record the OWNER set        — authoritative, no guess
 *     2. the manifest displayName + description        — the owner's own words
 *     3. appinfo.json: the app's own rendered text     — harvested by the
 *        screenshot job, which already opens every app in a real browser
 *
 *   (3) is what makes this possible at all. `cosmicteapot` publishes no
 *   description but renders "Tea room · Brew log"; `doomarcade00` renders
 *   "AMMO / HEALTH / ARMOR". That is the app speaking, not us inferring.
 *
 * RULES, NOT A MODEL
 *   Keyword rules over an LLM, deliberately. A rule can be shown to the person
 *   whose app it filed: every result carries the exact terms that matched and
 *   where they were found. A model would classify better and explain nothing,
 *   would need a key in CI, and would give a different answer on Tuesday.
 *
 * NOTHING IS FORCED
 *   An app that matches nothing is `other`, not shoved into the nearest bucket.
 *   A wrong category is worse than no category: it is a claim about someone
 *   else's work. `other` is a first-class, honest outcome.
 *
 *   node classify.mjs          write ../src/lib/categories.json
 *   node classify.mjs --show   print the reasoning for every app
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISCOVERED = path.join(HERE, '..', 'src', 'lib', 'discovered.json');
const INFO = path.join(HERE, '..', 'src', 'lib', 'appinfo.json');
const OUT = path.join(HERE, '..', 'src', 'lib', 'categories.json');

/**
 * The category set, kept small on purpose.
 *
 * Nine buckets for eighty apps. The App Store has two dozen for two million;
 * at this size more categories would mean most of them holding one app, which
 * is a taxonomy that flatters the author and helps nobody browse.
 *
 * `terms` are matched as whole words, case-insensitively. Order matters only
 * for the tie-break: the highest score wins, ties go to the earlier entry.
 */
const CATEGORIES = [
  {
    id: 'games',
    terms: [
      'game', 'games', 'gaming', 'play', 'player', 'players', 'arcade', 'quiz', 'puzzle',
      'roguelike', 'chess', 'ajedrez', 'tetris', 'doom', 'score', 'level', 'levels', 'dungeon',
      'monster', 'ammo', 'health', 'armor', 'weapon', 'lives', '高分', 'spiel',
    ],
    strong: ['arcade', 'roguelike', 'tetris', 'doom', 'ammo', 'dungeon', 'quiz', 'game', 'games'],
  },
  {
    id: 'social',
    terms: [
      'social', 'chat', 'message', 'messages', 'community', 'friends', 'post', 'posts',
      'guestbook', 'feed', 'forum', 'together', 'collaborate', 'collaboration', 'contributors',
      'petition', 'vote', 'voting', 'plaza', 'profile', 'followers',
    ],
    strong: ['guestbook', 'petition', 'forum', 'plaza', 'social'],
  },
  {
    id: 'finance',
    terms: [
      'defi', 'swap', 'stake', 'staking', 'token', 'tokens', 'wallet', 'balance', 'price',
      'trading', 'trade', 'buy', 'sell', 'long', 'short', 'yield', 'reward', 'rewards',
      'payment', 'payments', 'escrow', 'treasury', 'invoice', 'market', 'marketplace',
    ],
    strong: ['defi', 'swap', 'staking', 'escrow', 'marketplace', 'trading', 'buy', 'sell'],
  },
  {
    id: 'explorers',
    terms: [
      'explorer', 'explore', 'directory', 'analytics', 'dashboard', 'metrics',
      'stats', 'statistics', 'finality', 'monitor',
      'vitals', 'atlas', 'map', 'registry', 'verzeichnis', 'transparency',
    ],
    strong: ['explorer', 'directory', 'analytics', 'metrics', 'atlas', 'verzeichnis'],
  },
  {
    id: 'tools',
    terms: [
      'tool', 'tools', 'utility', 'builder', 'deploy', 'developer', 'sdk', 'api',
      'debug', 'sandbox', 'probe', 'kit', 'template', 'widget', 'widgets',
      'calculator', 'calc', 'converter', 'clock', 'todo', 'calendar', 'weather', 'rss',
    ],
    strong: ['sandbox', 'widget', 'widgets', 'calculator', 'sdk', 'probe'],
  },
  {
    id: 'identity',
    terms: [
      'identity', 'personhood', 'human', 'humans', 'verified', 'verification', 'proof',
      'anonymous', 'privacy', 'private', 'credential', 'passport', 'sybil', 'notary',
      'attestation', 'signature', 'authentic',
    ],
    strong: ['personhood', 'sybil', 'notary', 'attestation', 'identity'],
  },
  {
    id: 'publishing',
    terms: [
      'publish', 'published', 'website', 'websites', 'page', 'pages', 'blog', 'site',
      'hosting', 'storage', 'upload', 'cid', 'bulletin', 'docs',
      'documentation', 'guide', 'notes', 'writing',
    ],
    strong: ['blog', 'hosting', 'documentation', 'guide', 'publish'],
  },
  {
    id: 'media',
    terms: [
      'music', 'audio', 'song', 'songs', 'artist', 'video', 'photo', 'photos', 'image',
      'images', 'gallery', 'art', 'sound', 'radio', 'stream', 'listen',
    ],
    strong: ['music', 'artist', 'gallery', 'radio'],
  },
  {
    id: 'curiosities',
    terms: [
      'teapot', 'coin flip', 'flip', 'fun', 'silly', 'toy', 'experiment', 'hello',
      'hello world', 'orbit', 'random', 'fortune', 'joke', 'improbable',
    ],
    strong: ['teapot', 'hello world', 'improbable', 'fortune'],
  },
];

const VALID = new Set(CATEGORIES.map((c) => c.id));

const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
};

/**
 * Whole-word, accent-insensitive matching.
 *
 * Substring matching is what turns a classifier into a joke: "stake" inside
 * "mistaken", "art" inside "start", "map" inside "mapping". Word boundaries are
 * the difference between evidence and coincidence.
 */
function countTerm(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'giu');
  return (haystack.match(re) ?? []).length;
}

/**
 * Score every category against the evidence, and say why.
 *
 * The owner's own words weigh more than text scraped off their running app: a
 * description is a deliberate statement of purpose, while rendered text is
 * whatever happened to be on screen — a nav bar, a cookie notice, a loading
 * message. Weighted 3:1, and a term the category calls `strong` counts double
 * because "roguelike" says more than "play".
 */
function score(evidence) {
  const results = [];
  for (const cat of CATEGORIES) {
    let points = 0;
    let strongHit = false;
    const hits = [];
    for (const term of cat.terms) {
      const isStrong = cat.strong.includes(term);
      const weight = isStrong ? 2 : 1;
      const inOwner = countTerm(evidence.owner, term);
      const inApp = countTerm(evidence.app, term);

      // Labels are concatenated words — `openpetition`, `doomarcade00`,
      // `quizzlergame` — so word boundaries never fire inside them and the
      // clearest signal in the whole directory was being thrown away. Substring
      // matching is only safe for the DISTINCTIVE terms, which is exactly what
      // `strong` means: "petition" inside a label is a fact, "art" would not be.
      const inLabel = isStrong && evidence.label.includes(term.replace(/\s+/g, '')) ? 1 : 0;

      if (!inOwner && !inApp && !inLabel) continue;
      points += weight * (inOwner * 3 + inApp * 1 + inLabel * 2);
      // A distinctive term only earns the promotion below when it came from the
      // owner's own words or their chosen name. Seen merely somewhere on screen
      // it is not enough: `pennypixel` was filed under finance because the word
      // "buy" appeared once in its interface, which is the kind of over-reach
      // this whole file is meant to avoid.
      if (isStrong && (inOwner || inLabel)) strongHit = true;
      // ~ marks a term we read off the app itself or its name, rather than
      // something its owner chose to write.
      hits.push(term + (inOwner ? '' : '~'));
    }
    if (points > 0) results.push({ id: cat.id, points, strongHit, hits });
  }
  results.sort((a, b) => b.points - a.points);
  return results;
}

/** How confident we are, in words rather than a number nobody can check. */
function confidenceOf(ranked) {
  if (!ranked.length) return 'none';
  const top = ranked[0].points;
  const next = ranked[1]?.points ?? 0;
  if (top >= 6 && top >= next * 2) return 'high';
  if (top >= 3) return 'medium';
  // One distinctive term is enough on its own. "tetris" was scoring 2 points and
  // being discarded as too weak, which is not a judgement any person would make.
  if (ranked[0].strongHit) return 'medium';
  return 'low';
}

const dir = readJson(DISCOVERED, null);
if (!dir || typeof dir !== 'object') {
  console.error(`classify FAILED: could not read ${DISCOVERED}`);
  process.exit(1);
}
const info = readJson(INFO, {});

const out = {};
const tally = {};
const show = process.argv.includes('--show');

for (const [label, entry] of Object.entries(dir)) {
  if (label === 'excluded' || !entry || typeof entry !== 'object') continue;

  // 1. The owner said so. No guessing, no scoring, no argument.
  const declared = String(entry.category ?? '').trim().toLowerCase();
  if (VALID.has(declared)) {
    out[label] = { category: declared, source: 'owner', confidence: 'declared', why: [] };
    tally[declared] = (tally[declared] ?? 0) + 1;
    if (show) console.log(`${label.padEnd(26)} ${declared.padEnd(13)} declared by the owner`);
    continue;
  }

  const owner = [entry.displayName ?? '', entry.description ?? ''].join(' ');
  const app = info[label]
    ? [info[label].title ?? '', (info[label].heads ?? []).join(' '), info[label].text ?? ''].join(' ')
    : '';

  // The label is evidence of last resort — it is chosen by a human and often
  // says something ("buy-or-sell", "doomarcade00") — but it is weak, so it only
  // joins the app's own text rather than the owner's deliberate words.
  const fromLabel = label.replace(/[-_]+/g, ' ').replace(/\d+/g, ' ');
  const ranked = score({
    owner,
    app: `${app} ${fromLabel}`,
    // The raw label, letters only, for the distinctive-term substring pass.
    label: label.toLowerCase().replace(/[^a-z]/g, ''),
  });
  const confidence = confidenceOf(ranked);

  if (!ranked.length || confidence === 'low') {
    out[label] = {
      category: 'other',
      source: 'unclassified',
      confidence: 'none',
      why: ranked[0]?.hits.slice(0, 4) ?? [],
    };
    tally.other = (tally.other ?? 0) + 1;
    if (show) {
      console.log(
        `${label.padEnd(26)} ${'other'.padEnd(13)} ` +
          (ranked.length ? `too weak: ${ranked[0].hits.slice(0, 3).join(', ')}` : 'no evidence'),
      );
    }
    continue;
  }

  out[label] = {
    category: ranked[0].id,
    source: app && !owner.trim() ? 'derived:app-text' : 'derived:manifest',
    confidence,
    why: ranked[0].hits.slice(0, 5),
  };
  tally[ranked[0].id] = (tally[ranked[0].id] ?? 0) + 1;
  if (show) {
    console.log(
      `${label.padEnd(26)} ${ranked[0].id.padEnd(13)} ${confidence.padEnd(7)} ` +
        `${ranked[0].points}pt  ${ranked[0].hits.slice(0, 5).join(', ')}`,
    );
  }
}

const ordered = {};
for (const k of Object.keys(out).sort()) ordered[k] = out[k];
fs.writeFileSync(OUT, JSON.stringify(ordered, null, 2) + '\n');

const total = Object.keys(ordered).length;
const placed = total - (tally.other ?? 0);
console.log(
  `\nclassified ${placed}/${total} apps · ` +
    Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(' · '),
);
console.log(`wrote ${OUT}`);
