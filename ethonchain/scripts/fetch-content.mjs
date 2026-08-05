/**
 * fetch-content.mjs — pull a small, chosen set of pages from the ethereum.org
 * repository and turn them into something this bundle can render.
 *
 * WHY THESE PAGES AND NOT ALL OF THEM
 *   ethereum/ethereum-org-website is 1.4 GB across 42 content sections. The
 *   point being made here is not "we can copy a website", it is "content of this
 *   kind is served from a content hash with no server behind it", and six real
 *   pages demonstrate that as completely as six hundred would. It also keeps the
 *   bundle in the range where the gateway is usable at all: chirp shipped 6.8 MB
 *   once and it was ruinous through dot.li, because the whole archive downloads
 *   before a line of it runs.
 *
 * LICENCE
 *   The repository is MIT, which permits redistribution provided the copyright
 *   notice and the licence text travel with the copy. THIRD-PARTY.md carries
 *   both, every page keeps a link to its canonical source on ethereum.org, and
 *   the site says on every screen that it is not run by the Ethereum Foundation.
 *   None of that is decoration: a mirror that is coy about being a mirror is the
 *   thing nobody should build.
 *
 * WHAT IT HAS TO STRIP
 *   The source is MDX: markdown with React components mixed in (<Divider />,
 *   <InfoBanner>, <YouTube />, and so on) and `{#anchor}` suffixes on headings.
 *   None of those exist here, so they are removed rather than half-rendered.
 *   Anything dropped is counted and reported, because silently thinning somebody
 *   else's page and calling it their page is not honest.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// sharp is already a dependency of the dotmetrics indexer in this workspace.
// Borrowing it beats adding a second copy of a native module for six pictures.
const sharp = createRequire(new URL('../../dotmetrics/', import.meta.url).href)('sharp');

const REPO = 'ethereum/ethereum-org-website';

/**
 * Pictures: taken at full size, shipped small.
 *
 * The six images these pages carry are 2.5 MB of PNG between them, one of them
 * 1.18 MB on its own. Shipped as they are they would be twenty-five times the
 * weight of everything else here, and this bundle downloads in full before a
 * line of it runs — the mistake chirp made at 6.8 MB and had to undo. So each is
 * capped at 1000px wide and re-encoded as WebP, which is lossy and worth saying
 * so: these are the same pictures, not the same files.
 */
const IMG_MAX_WIDTH = 1000;
const IMG_QUALITY = 78;

/** Slug, and the label this site shows in its own navigation. */
const PAGES = [
  ['web3', 'Introduction to Web3'],
  ['what-are-apps', 'What are apps'],
  ['dao', 'DAOs'],
  ['decentralized-identity', 'Decentralized identity'],
  ['energy-consumption', 'Energy consumption'],
  ['bridges', 'Bridges'],
];

/** Read a file through the GitHub API. `gh` is already authenticated here, and
 *  using it avoids a token in this script. */
function readRaw(path) {
  // Asked more than once on purpose. A megabyte over the GitHub API drops often
  // enough that a single attempt decides the build, and a fetch that failed for
  // want of a retry is indistinguishable from content that does not exist.
  // The raw media type, not the JSON one. The contents API returns an EMPTY
  // `content` field for anything over 1 MB rather than an error, so the JSON
  // route silently hands back nothing for exactly the files most worth
  // compressing — which is how this first failed, on a 1.18 MB PNG.
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const buf = execFileSync(
        'gh',
        ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/${path}`],
        { maxBuffer: 64 * 1024 * 1024 },        // no encoding: keep it binary
      );
      if (!buf?.length) throw new Error('empty response');
      return buf;
    } catch (e) {
      last = e;
      execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${1000 * (attempt + 1)})`]);
    }
  }
  throw new Error(`could not read ${path} after 4 attempts: ${String(last?.stderr ?? last).slice(0, 120)}`);
}
const read = (path) => readRaw(path).toString('utf8');

/** Every file beside a page's index.md, so images can be found without guessing
 *  at names the markdown may spell differently. */
function listDir(path) {
  try {
    return JSON.parse(execFileSync('gh', ['api', `repos/${REPO}/contents/${path}`], {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    })).map((f) => f.name);
  } catch { return []; }
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline markdown: images, links, bold, italic, code. Applied to already-escaped
 *  text, so it only ever introduces the tags named here. */
function inline(s, pictures) {
  return s
    .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
    // Images before links: the syntax differs by one leading `!` and the link
    // rule would otherwise swallow them and render a picture as a hyperlink.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt, src) => {
      const name = src.split('/').pop();
      const file = pictures.get(name);
      if (!file) return '';                     // never left as a broken image
      return `<img src="./img/${file}" alt="${alt}" loading="lazy" decoding="async">`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, t, href) => {
      // Internal links point at ethereum.org, because that is where the rest of
      // the site actually is. Sending somebody to a page this bundle does not
      // carry would be the one broken promise here.
      const url = href.startsWith('/') ? `https://ethereum.org${href}` : href;
      const ext = /^https?:/.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${url}"${ext}>${t}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>');
}

/** MDX to HTML, for the subset these pages actually use. */
function render(md, pictures) {
  const dropped = [];
  const toc = [];
  let body = md;

  // Frontmatter first: it holds the title and description.
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const meta = {};
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    body = body.slice(fm[0].length);
  }

  // Import statements and JSX components. Counted, not silently swallowed.
  body = body.replace(/^import\s+.*$/gm, () => { dropped.push('import'); return ''; });
  body = body.replace(/<([A-Z]\w*)[^>]*\/>/g, (_m, tag) => { dropped.push(tag); return ''; });
  body = body.replace(/<([A-Z]\w*)[^>]*>([\s\S]*?)<\/\1>/g, (_m, tag, innerText) => {
    dropped.push(tag);
    return innerText;                       // keep the words, lose the wrapper
  });

  const out = [];
  let list = null;                          // 'ul' | 'ol' | null
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      // The `{#anchor}` suffix is not noise to be stripped: it is the id their
      // own page uses for deep links, chosen by whoever wrote the section. Keep
      // it, so a link into the middle of an article still lands where it says.
      // Fall back to a slug of the text where a heading has none.
      const anchor = /\{#([^}]+)\}/.exec(h[2])?.[1];
      const text = h[2].replace(/\s*\{#[^}]*\}\s*$/, '');
      const id = anchor ?? text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (level === 2 && id) toc.push({ id, text });
      out.push(`<h${level} id="${id}">${inline(esc(text), pictures)}</h${level}>`);
      continue;
    }

    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(esc(li[1]), pictures)}</li>`);
      continue;
    }
    const oli = line.match(/^\s*\d+\.\s+(.*)$/);
    if (oli) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(esc(oli[1]), pictures)}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(esc(line), pictures)}</p>`);
  }
  closeList();

  return { meta, html: out.join('\n'), dropped, toc };
}

mkdirSync(new URL('../src', import.meta.url), { recursive: true });
mkdirSync(new URL('../public/img', import.meta.url), { recursive: true });

const IMG = /\.(png|jpe?g|webp)$/i;
let rawBytes = 0;
let shippedBytes = 0;

const pages = [];
for (const [slug, label] of PAGES) {
  process.stdout.write(`${slug} … `);
  const md = read(`public/content/${slug}/index.md`);

  // Pictures first: the renderer needs to know which ones exist before it can
  // decide what an <img> should point at.
  const pictures = new Map();
  for (const name of listDir(`public/content/${slug}`).filter((n) => IMG.test(n))) {
    const src = readRaw(`public/content/${slug}/${name}`);
    const out = await sharp(src)
      .resize({ width: IMG_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: IMG_QUALITY })
      .toBuffer();
    const file = `${slug}-${name.replace(IMG, '')}.webp`;
    writeFileSync(new URL(`../public/img/${file}`, import.meta.url), out);
    pictures.set(name, file);
    rawBytes += src.length;
    shippedBytes += out.length;
  }

  const { meta, html, dropped, toc } = render(md, pictures);
  const counts = dropped.reduce((a, d) => ({ ...a, [d]: (a[d] ?? 0) + 1 }), {});
  pages.push({
    slug,
    label,
    title: meta.title ?? label,
    description: meta.description ?? '',
    source: `https://ethereum.org/en/${slug}/`,
    words: html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
    toc,
    html,
  });
  console.log(`${(md.length / 1000).toFixed(1)} kB markdown, ${html.length} chars html`
    + (pictures.size ? `, ${pictures.size} picture${pictures.size > 1 ? 's' : ''}` : '')
    + (dropped.length ? `, dropped ${Object.entries(counts).map(([k, v]) => `${v}×${k}`).join(' ')}` : ''));
}

const total = pages.reduce((n, p) => n + p.html.length, 0);
writeFileSync(new URL('../src/content.json', import.meta.url), JSON.stringify({
  fetchedFrom: REPO,
  pages,
}, null, 1));
console.log(`\n${pages.length} pages, ${(total / 1000).toFixed(1)} kB of HTML written to src/content.json`);
if (rawBytes) {
  console.log(`pictures: ${(rawBytes / 1e6).toFixed(2)} MB of PNG in, `
    + `${(shippedBytes / 1000).toFixed(0)} kB of WebP out `
    + `(${(100 - (shippedBytes / rawBytes) * 100).toFixed(1)}% smaller)`);
}
