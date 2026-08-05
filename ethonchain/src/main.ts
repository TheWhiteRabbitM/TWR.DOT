/**
 * eth on chain — six real pages from ethereum.org, served from a content hash.
 *
 * WHAT THIS IS FOR
 *   Not to look like ethereum.org. To show that a site of that kind needs no
 *   server, and to let anybody check that claim rather than take it. Which is
 *   why the numbers in the provenance panel are MEASURED in the browser that is
 *   reading them, and why the two things that cannot be measured say so instead
 *   of being filled in with something plausible.
 *
 * WHAT IT IS NOT
 *   It is not the Ethereum Foundation, does not use their logo, and says so on
 *   every screen. A mirror that is coy about being a mirror is indistinguishable
 *   from a phishing page, and with this audience in particular that would lose
 *   the argument before anyone read a word of it.
 */
import CONTENT from './content.json';
import './style.css';

type Page = {
  slug: string; label: string; title: string; description: string;
  source: string; words: number; toc: { id: string; text: string }[]; html: string;
};
const PAGES = CONTENT.pages as Page[];

/* ------------------------------------------------------------- provenance */

/**
 * Where this page came from, measured where measuring is possible.
 *
 * `bytes` and `requests` come from the Resource Timing API, so they are what
 * this browser actually pulled over the wire, not what a build script predicted.
 * `cid` is read from the hostname because an app served from a content hash IS
 * addressed by it — on the dev-dot.li gateway the origin is the CID. In the
 * Polkadot app the container does not expose it, and then this says so rather
 * than printing a number it cannot stand behind.
 */
function provenance() {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

  // transferSize is 0 for a cached or opaque response; those are counted
  // separately rather than being added in as zero.
  let bytes = nav?.transferSize ?? 0;
  let unknown = 0;
  for (const r of res) {
    if (r.transferSize > 0) bytes += r.transferSize;
    else unknown++;
  }

  const host = location.hostname;
  const cid = /^(bafy|Qm)[a-z0-9]{20,}/i.exec(host)?.[0] ?? null;

  return {
    cid,
    host,
    bytes,
    unknown,
    requests: res.length + 1,
    loadMs: nav ? Math.round(nav.duration) : null,
  };
}

const kb = (n: number) => (n < 1000 ? `${n} B` : `${(n / 1000).toFixed(1)} kB`);

function provenanceView(): string {
  const p = provenance();
  const rows: [string, string, string][] = [
    ['Name', 'ethonchain.dot', 'A .dot name, resolved on Polkadot Asset Hub. It points at a content hash, not at an address.'],
    [
      'Content hash',
      p.cid ? `<code>${p.cid}</code>` : `<span class="dim">not exposed here (served as ${escapeHtml(p.host)})</span>`,
      p.cid
        ? 'Read from this page&rsquo;s own hostname. The page is addressed by the hash of its contents, so this is the page identifying itself.'
        : 'This container does not put the hash in the origin. It is on chain either way, and the command below reads it.',
    ],
    ['Transferred', `${kb(p.bytes)}${p.unknown ? ` <span class="dim">+${p.unknown} not reported</span>` : ''}`,
      'Measured by this browser, for this visit, over the Resource Timing API.'],
    ['Requests', String(p.requests), 'Including the document itself.'],
    ['Load', p.loadMs === null ? '<span class="dim">not reported</span>' : `${p.loadMs} ms`,
      'Navigation start to load event, in this browser, on this connection.'],
    ['Servers', 'none',
      'There is no origin server to reach, no CDN in front of it and no host to bill. The bytes come from whoever has them, and the hash is what proves they are the right bytes.'],
  ];

  return `
  <section class="prov" aria-labelledby="provh">
    <h2 id="provh">Where this page came from</h2>
    <p class="lede">Every claim here is checkable. The numbers are measured in the browser you are
    reading this in; the two that cannot be measured say so.</p>
    <dl>
      ${rows.map(([k, v, why]) => `
        <div class="row">
          <dt>${k}</dt>
          <dd>${v}<span class="why">${why}</span></dd>
        </div>`).join('')}
    </dl>
    <h3>Check it yourself</h3>
    <p>Resolve the name, and compare the hash with what your browser was served:</p>
    <pre><code>dotns resolve ethonchain.dot</code></pre>
    <p class="dim small">Nothing here asks you to trust this page about this page.</p>
  </section>`;
}

/* ------------------------------------------------------------------- views */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function homeView(): string {
  const words = PAGES.reduce((n, p) => n + p.words, 0);
  return `
  <section class="home">
    <h1>Somebody else&rsquo;s content, with nobody hosting it</h1>
    <p class="lede">These are ${PAGES.length} real pages from ethereum.org, about
    ${words.toLocaleString('en')} words, taken unedited from
    <a href="https://github.com/ethereum/ethereum-org-website" target="_blank" rel="noopener noreferrer">their
    open repository</a> and served from a content hash on the Polkadot products devnet.</p>

    <p>There is no server behind this page. No origin, no CDN, no account that can lapse and no
    company that has to keep existing. The name <strong>ethonchain.dot</strong> resolves on chain to
    the hash of these exact bytes, and any node holding them can serve them. Change one character and
    the hash changes, so nobody can quietly serve you something else.</p>

    <p>That is the whole demonstration. The pages below are the evidence that it works on real
    content rather than on a placeholder, and
    <a href="#/provenance">the provenance panel</a> is the evidence that it is true right now, in your
    browser, measured rather than asserted.</p>

    <div class="btnrow">
      <a class="btn solid lg" href="#/provenance">See where this page came from</a>
      <a class="btn lg" href="https://ethereum.org" target="_blank" rel="noopener noreferrer">Visit the real ethereum.org</a>
    </div>

    <div class="cards">
      ${PAGES.map((p) => `
        <a class="card" href="#/${p.slug}">
          <span class="ct">${escapeHtml(p.title)}</span>
          <span class="cd">${escapeHtml(p.description)}</span>
          <span class="cw">${p.words.toLocaleString('en')} words</span>
        </a>`).join('')}
    </div>

    <h2>And the name that is not taken</h2>
    <p><strong>ethereum.dot is unregistered.</strong> It was deliberately left alone. Registering
    somebody&rsquo;s name to show them what it could do is the argument losing itself; the name is
    theirs to claim, and this sits somewhere clearly its own.</p>
  </section>`;
}

function pageView(p: Page): string {
  const mins = Math.max(1, Math.round(p.words / 220));
  return `
  <article class="doc">
    <p class="from">From <a href="${p.source}" target="_blank" rel="noopener noreferrer">${p.source}</a>,
    unedited. Interactive components in the original are not reproduced here.</p>
    <h1>${escapeHtml(p.title)}</h1>
    ${p.description ? `<p class="lede">${escapeHtml(p.description)}</p>` : ''}
    <p class="meta">${p.words.toLocaleString('en')} words &middot; about ${mins} min</p>
    ${p.toc.length > 1 ? `
      <!-- Their headings carry their own anchors, so this links where their own
           page links. Built from the document rather than written by hand, which
           is why it cannot drift out of step with the text under it. -->
      <nav class="toc" aria-label="On this page">
        <p class="toch">On this page</p>
        <ol>${p.toc.map((t) => `<li><a href="#/${p.slug}#${t.id}">${escapeHtml(t.text)}</a></li>`).join('')}</ol>
      </nav>` : ''}
    ${p.html}
    <p class="from bottom">Text &copy; ethereum.org contributors, MIT licensed. Read it on
    <a href="${p.source}" target="_blank" rel="noopener noreferrer">ethereum.org</a>, which is the
    canonical version and the one that is kept up to date.</p>
  </article>`;
}

function notFound(): string {
  return `<section class="home"><h1>No such page</h1>
  <p>This bundle carries ${PAGES.length} pages. <a href="#/">Start from the beginning</a>.</p></section>`;
}

/* ------------------------------------------------------------------ shell */

/** `#/slug` and `#/slug#section`. The second hash is a position inside a page,
 *  not a route, so it is split off before anything is matched. */
function parseHash(): { path: string; anchor: string | null } {
  const raw = location.hash.replace(/^#\/?/, '');
  const at = raw.indexOf('#');
  return at < 0 ? { path: raw, anchor: null } : { path: raw.slice(0, at), anchor: raw.slice(at + 1) };
}

function route(path: string): string {
  if (!path) return homeView();
  if (path === 'provenance') return provenanceView();
  const p = PAGES.find((x) => x.slug === path);
  return p ? pageView(p) : notFound();
}

function render() {
  const { path: here, anchor } = parseHash();
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
  <!-- Fixed, not dismissible, and above the fold on every screen. Somebody who
       lands mid-article from a shared link must still be told what this is. -->
  <div class="warn" role="note">
    <strong>Unofficial demonstration.</strong> Not affiliated with, endorsed by, or operated by the
    Ethereum Foundation. Content is theirs, MIT licensed; the point being made is ours.
  </div>

  <header class="top">
    <a class="brand" href="#/"><span class="mark" aria-hidden="true"></span> eth on chain</a>
    <nav aria-label="Pages">
      <a href="#/" class="${here === '' ? 'on' : ''}">Home</a>
      ${PAGES.map((p) => `<a href="#/${p.slug}" class="${here === p.slug ? 'on' : ''}">${escapeHtml(p.label)}</a>`).join('')}
      <a href="#/provenance" class="${here === 'provenance' ? 'on' : ''}">Provenance</a>
    </nav>
  </header>

  <main>${route(here)}</main>

  <footer>
    <p>Content from <a href="https://ethereum.org" target="_blank" rel="noopener noreferrer">ethereum.org</a>,
    &copy; its contributors, used under the MIT licence. This demonstration is not affiliated with the
    Ethereum Foundation.</p>
    <p>Served from a content hash on the Polkadot products devnet. <a href="#/provenance">See the numbers</a>.</p>
  </footer>`;

  // A hash route changes nothing about scroll position on its own. Landing
  // halfway down an article you did not choose is disorienting; NOT landing at
  // the section you did choose is worse, so the anchor wins when there is one.
  const target = anchor ? document.getElementById(anchor) : null;
  if (target) target.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();
