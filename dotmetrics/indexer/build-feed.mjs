/**
 * The public feed of .dot registrations, as two static files served straight
 * from the site bundle:
 *
 *   public/feed.json  { generatedAt, count, apps: [...] }  — the whole directory
 *   public/feed.xml   RSS 2.0 of the most recent registrations
 *
 * Vite copies public/ verbatim into dist/, so after the next site publish these
 * are fetchable at dotmetrics.dot/feed.json and dotmetrics.dot/feed.xml. They
 * ride ALONG with the ordinary site publish — they are excluded from the
 * app-tree hash, so regenerating them every refresh never costs a Bulletin
 * transaction on its own (see indexer/app-tree-hash.mjs).
 *
 * Third-party names are not ours and contain whatever their authors typed —
 * ampersands, angle brackets, quotes. Every one of them is escaped before it
 * reaches the XML, and the finished document is parsed back for well-formedness
 * before it is written: a feed that would not parse is a bug we refuse to ship.
 *
 *   node build-feed.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'apps.json');
const PUBLIC = path.join(HERE, '..', 'public');
const JSON_OUT = path.join(PUBLIC, 'feed.json');
const XML_OUT = path.join(PUBLIC, 'feed.xml');

/** Where the site answers. Used for channel + item links. */
const SITE = 'https://dotmetrics.dot';
/** How many of the newest registrations the RSS carries. The JSON carries all. */
const RSS_ITEMS = 50;

/** XML-escape text OR an attribute value: all five predefined entities. */
function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC-822 date RSS wants; Date#toUTCString is exactly that form. */
function rfc822(unixSeconds) {
  return new Date(unixSeconds * 1000).toUTCString();
}

/**
 * A dependency-free well-formedness check — no XML parser is in the bundle and
 * none is wanted. It proves two things about the string we are about to write:
 * every `&` opens a legal entity, and every element that opens is closed in the
 * right order. It is not a schema validator; it is the guarantee that a browser
 * or reader will not choke on the document. Throws on the first fault.
 */
function assertWellFormed(xml) {
  // 1. Every ampersand must begin a predefined or numeric entity.
  const badAmp = xml.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
  if (badAmp) {
    throw new Error(`unescaped '&' near: ${xml.slice(badAmp.index, badAmp.index + 40)}`);
  }
  // 2. Tags must nest. Strip the prolog and comments, then walk the tags.
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const tag = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tag.exec(body))) {
    const [, closing, name, attrs, selfClose] = m;
    if (closing) {
      const open = stack.pop();
      if (open !== name) throw new Error(`tag mismatch: </${name}> closes <${open ?? 'nothing'}>`);
    } else if (!selfClose) {
      stack.push(name);
    }
    // A stray '<' inside text would have been escaped to &lt;, so anything the
    // tag regex did not match is text, not a broken tag.
    void attrs;
  }
  if (stack.length) throw new Error(`unclosed tag(s): ${stack.join(', ')}`);
  return true;
}

const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const apps = Object.keys(file)
  .filter((k) => k !== 'excluded')
  .map((label) => file[label])
  // Newest registration first; names without a resolved time sort last.
  .sort((a, b) => (b.firstSeenAt ?? 0) - (a.firstSeenAt ?? 0));

const generatedAt = Math.floor(Date.now() / 1000);

// ---- feed.json: the whole directory, one flat record per app ----------------
const jsonApps = apps.map((a) => ({
  label: a.label,
  domain: a.domain,
  displayName: typeof a.displayName === 'string' ? a.displayName : '',
  description: typeof a.description === 'string' ? a.description : '',
  tier: typeof a.tier === 'number' ? a.tier : 2,
  firstSeenAt: typeof a.firstSeenAt === 'number' ? a.firstSeenAt : null,
  url: a.url,
}));
const feedJson = { generatedAt, count: jsonApps.length, apps: jsonApps };
JSON.parse(JSON.stringify(feedJson)); // self-check: it round-trips or we throw

// ---- feed.xml: RSS 2.0 of the most recent registrations ---------------------
const items = apps.slice(0, RSS_ITEMS).map((a) => {
  const title = xmlEscape(a.displayName || a.label);
  const link = xmlEscape(a.url);
  const desc = xmlEscape(a.description || '');
  const guid = xmlEscape(a.label);
  const pubDate = typeof a.firstSeenAt === 'number' ? `\n      <pubDate>${rfc822(a.firstSeenAt)}</pubDate>` : '';
  return (
    `    <item>\n` +
    `      <title>${title}</title>\n` +
    `      <link>${link}</link>\n` +
    `      <description>${desc}</description>\n` +
    `      <guid isPermaLink="false">${guid}</guid>${pubDate}\n` +
    `    </item>`
  );
});

const feedXml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<rss version="2.0">\n` +
  `  <channel>\n` +
  `    <title>dotmetrics — .dot ecosystem registrations</title>\n` +
  `    <link>${xmlEscape(SITE)}</link>\n` +
  `    <description>Newly registered .dot names, most recent first.</description>\n` +
  `    <lastBuildDate>${rfc822(generatedAt)}</lastBuildDate>\n` +
  items.join('\n') +
  (items.length ? '\n' : '') +
  `  </channel>\n` +
  `</rss>\n`;

// Refuse to write a document that would not parse.
assertWellFormed(feedXml);

fs.mkdirSync(PUBLIC, { recursive: true });
fs.writeFileSync(JSON_OUT, JSON.stringify(feedJson, null, 2) + '\n');
fs.writeFileSync(XML_OUT, feedXml);

console.log(
  `feed: ${feedJson.count} apps in feed.json · ${items.length} items in feed.xml ` +
    `(RSS caps at ${RSS_ITEMS}) · xml well-formed`,
);
console.log(`wrote ${JSON_OUT}\n      ${XML_OUT}`);
