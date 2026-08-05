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

const REPO = 'ethereum/ethereum-org-website';

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
function read(path) {
  const out = execFileSync('gh', ['api', `repos/${REPO}/contents/${path}`, '--jq', '.content'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return Buffer.from(out.replace(/\s/g, ''), 'base64').toString('utf8');
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline markdown: links, bold, italic, code. Applied to already-escaped text,
 *  so it only ever introduces the tags named here. */
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
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
function render(md) {
  const dropped = [];
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
      const text = h[2].replace(/\s*\{#[^}]*\}\s*$/, '');   // drop {#anchor}
      out.push(`<h${level}>${inline(esc(text))}</h${level}>`);
      continue;
    }

    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(esc(li[1]))}</li>`);
      continue;
    }
    const oli = line.match(/^\s*\d+\.\s+(.*)$/);
    if (oli) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(esc(oli[1]))}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(esc(line))}</p>`);
  }
  closeList();

  return { meta, html: out.join('\n'), dropped };
}

mkdirSync(new URL('../src', import.meta.url), { recursive: true });

const pages = [];
for (const [slug, label] of PAGES) {
  process.stdout.write(`${slug} … `);
  const md = read(`public/content/${slug}/index.md`);
  const { meta, html, dropped } = render(md);
  const counts = dropped.reduce((a, d) => ({ ...a, [d]: (a[d] ?? 0) + 1 }), {});
  pages.push({
    slug,
    label,
    title: meta.title ?? label,
    description: meta.description ?? '',
    source: `https://ethereum.org/en/${slug}/`,
    words: html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
    html,
  });
  console.log(`${(md.length / 1000).toFixed(1)} kB markdown, ${html.length} chars html`
    + (dropped.length ? `, dropped ${Object.entries(counts).map(([k, v]) => `${v}×${k}`).join(' ')}` : ''));
}

const total = pages.reduce((n, p) => n + p.html.length, 0);
writeFileSync(new URL('../src/content.json', import.meta.url), JSON.stringify({
  fetchedFrom: REPO,
  pages,
}, null, 1));
console.log(`\n${pages.length} pages, ${(total / 1000).toFixed(1)} kB of HTML written to src/content.json`);
