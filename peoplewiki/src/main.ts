/**
 * PeopleWiki — what this devnet actually does, written down by the people using it.
 *
 * Notes are grouped by topic and read in a narrow column, because that is what a
 * reference is for. Anyone holding a mask can add one; the author can correct or
 * retract their own; readers vote a note up when it saved them. There is no
 * editor and no owner — the contract is the whole rulebook.
 *
 * Reading needs no wallet. Writing needs a mask, which is account-bound, so a
 * note cannot be signed in someone else's name.
 */
import './style.css';
import {
  warmUp, me, load, addNote, editNote, retractNote, voteNote, forgetBylines,
  WIKI, MASKS, type Entry, type Me,
} from './chain';

const app = document.getElementById('app')!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Addresses, endpoints and call names are half of what this wiki says, so they
 *  are set in the monospace face rather than left to run into the prose. */
function prose(text: string): string {
  return esc(text)
    .replace(/\b(0x[0-9a-fA-F]{6,})\b/g, '<code>$1</code>')
    .replace(/\b(wss:\/\/[^\s,)]+)/g, '<code>$1</code>')
    .replace(/\b([A-Za-z][A-Za-z0-9]*\.[a-z_][A-Za-z0-9_]*\([^)]{0,80}\))/g, '<code>$1</code>')
    .replace(/\b(5[A-HJ-NP-Za-km-z1-9]{46,48})\b/g, '<code>$1</code>');
}

const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="pwg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a84ff"/><stop offset="1" stop-color="#5e5ce6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pwg)"/><path d="M14 20a22 22 0 0 1 18 3 22 22 0 0 1 18-3v25a22 22 0 0 0-18 3 22 22 0 0 0-18-3z" fill="none" stroke="white" stroke-width="3.2" stroke-linejoin="round"/><path d="M32 23v25" stroke="white" stroke-width="3.2"/><circle cx="32" cy="16" r="4" fill="white"/></svg>`;
const S = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  search: S('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  up: S('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),
  pen: S('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: S('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  plus: S('<path d="M12 5v14"/><path d="M5 12h14"/>'),
};

/** The order topics are presented in: what a chain IS, then who you are on it,
 *  then what you can build, then what breaks. Alphabetical would be worse. */
const ORDER = ['chains', 'identity', 'signing', 'host', 'contracts', 'deploy', 'sdk', 'values', 'names', 'bulletin', 'tooling'];
const LABEL: Record<string, string> = {
  chains: 'The chains', identity: 'Identity', signing: 'Signing', host: 'The host',
  contracts: 'Contracts', deploy: 'Deploying', sdk: 'The SDK', values: 'Values and units',
  names: '.dot names', bulletin: 'Bulletin storage', tooling: 'Tooling',
};

let ME: Me | null = null;
let ALL: Entry[] = [];
let topic = 'all';
let query = '';
let open = new Set<number>();
let sheet: null | { mode: 'add' | 'edit'; entry?: Entry } = null;
let flash: { text: string; bad?: boolean } | null = null;
let busy = true;
/** Set when a read failed, so the page can say so instead of looking empty. */
let loadError = '';

const when = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function groups(list: Entry[]) {
  const by = new Map<string, Entry[]>();
  for (const e of list) by.set(e.tag, [...(by.get(e.tag) ?? []), e]);
  const known = ORDER.filter((t) => by.has(t));
  const rest = [...by.keys()].filter((t) => !ORDER.includes(t)).sort();
  return [...known, ...rest].map((t) => [t, by.get(t)!.sort((a, b) => b.votes - a.votes || b.id - a.id)] as const);
}

function visible(): Entry[] {
  const q = query.trim().toLowerCase();
  return ALL.filter((e) => {
    if (topic !== 'all' && e.tag !== topic) return false;
    if (!q) return true;
    return (e.title + ' ' + e.body + ' ' + e.tag).toLowerCase().includes(q);
  });
}

function noteCard(e: Entry): string {
  const isOpen = open.has(e.id);
  return `<article class="note" data-id="${e.id}">
    <h4>${esc(e.title)}</h4>
    <div class="text${isOpen ? '' : ' clamped'}">${prose(e.body)}</div>
    <div class="meta">
      <span class="tag">${esc(LABEL[e.tag] ?? e.tag)}</span>
      <span>${esc(e.byline ?? '')}</span>
      <span class="dot">·</span><span>${when(e.time)}</span>
      ${e.edited ? '<span class="dot">·</span><span>corrected</span>' : ''}
      <span style="flex:1"></span>
      <button class="act${e.didVote ? ' on' : ''}" data-vote="${e.id}" title="${e.didVote ? 'You found this useful' : 'This saved me time'}">
        ${I.up}<span>${e.votes || ''}</span></button>
      ${e.mine ? `<button class="act" data-edit="${e.id}" title="Correct">${I.pen}</button>
                  <button class="act danger" data-retract="${e.id}" title="Retract">${I.trash}</button>` : ''}
    </div>
  </article>`;
}

function sidebar(): string {
  const counts = new Map<string, number>();
  for (const e of ALL) counts.set(e.tag, (counts.get(e.tag) ?? 0) + 1);
  const items = [['all', 'Everything', ALL.length] as const,
    ...groups(ALL).map(([t, l]) => [t, LABEL[t] ?? t, l.length] as const)];
  return `<aside class="side"><h2>Topics</h2><div class="list">
    ${items.map(([k, label, n]) => `<button data-topic="${k}" class="${topic === k ? 'on' : ''}">${esc(String(label))}<span class="n">${n}</span></button>`).join('')}
  </div></aside>`;
}

function render() {
  const list = visible();
  const body = busy && !list.length
    ? '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'
    : list.length
      ? (topic === 'all' && !query.trim()
          ? groups(list).map(([t, es]) => `<h3>${esc(LABEL[t] ?? t)}</h3>${es.map(noteCard).join('')}`).join('')
          : list.map(noteCard).join(''))
      : `<div class="empty">Nothing here yet.${ME?.mask ? ' Add the first note — it is the one you wish you had found.' : ''}</div>`;

  app.innerHTML = `
    <header class="bar">
      <span class="brand">${LOGO}PeopleWiki <small>devnet</small></span>
      <span class="spacer"></span>
      <label class="search">${I.search}<input id="q" placeholder="Search" value="${esc(query)}" autocomplete="off" spellcheck="false"></label>
    </header>
    <div class="shell">
      ${sidebar()}
      <main>
        ${flash ? `<div class="msg ${flash.bad ? 'bad' : 'good'}" role="status">${esc(flash.text)}<button id="dismiss" aria-label="Dismiss">✕</button></div>` : ''}
        ${loadError ? `<div class="msg bad" role="alert">${esc(loadError)}<button id="retry" class="btn ghost">Try again</button></div>` : ''}
        ${topic === 'all' && !query.trim() ? `<section class="hero">
          <h1>What this devnet actually does.</h1>
          <p>Notes from people building on the Polkadot products devnet — the option that is silently ignored,
          the build that fails without naming a file, the permission whose absence makes a signature hang instead
          of fail. None of it is in the documentation. All of it is on chain, and anyone with a mask can add to it.</p>
          ${busy
            // Not "0 notes": a page that has not finished reading does not know
            // how many there are, and printing zero is a claim that it is empty.
            ? `<div class="stats"><span class="loading">Reading the chain…${ALL.length ? ` ${ALL.length} so far` : ''}</span></div>`
            : `<div class="stats"><span><b>${ALL.length}</b> notes</span><span><b>${groups(ALL).length}</b> topics</span>
          <span><b>${ALL.reduce((n, e) => n + e.votes, 0)}</b> found useful</span></div>`}
        </section>` : ''}
        <div class="group">${body}</div>
      </main>
    </div>
    <footer class="foot">
      Every note is a row in the <a href="https://assethub-paseo.subscan.io/account/${WIKI}" target="_blank" rel="noopener">PeopleWiki contract</a>
      on the devnet Asset Hub. Authorship is a <a href="https://assethub-paseo.subscan.io/account/${MASKS}" target="_blank" rel="noopener">mask</a>,
      which is bound to its account and cannot be transferred, so a note cannot be written in someone else's name.
      Corrections are welcome and expected: if something here is wrong, the fix belongs here too.
      <span style="display:block;margin-top:10px;opacity:.6">build ${esc(__BUILD__)}</span>
    </footer>
    ${ME?.mask ? `<button class="fab" id="add">${I.plus}Add a note</button>` : ''}
    ${sheetView()}`;
  wire();
}

function sheetView(): string {
  if (!sheet) return '';
  const e = sheet.entry;
  const tags = [...new Set([...ORDER, ...ALL.map((x) => x.tag)])];
  return `<div class="sheet" id="scrim"><div class="panel">
    <h3>${sheet.mode === 'add' ? 'Add a note' : 'Correct this note'}</h3>
    <label>Topic</label>
    <select id="f_tag">${tags.map((t) => `<option value="${esc(t)}" ${e?.tag === t ? 'selected' : ''}>${esc(LABEL[t] ?? t)}</option>`).join('')}</select>
    <label>Title — say the finding, not the subject</label>
    <input id="f_title" maxlength="120" value="${esc(e?.title ?? '')}" placeholder="e.g. createContract silently ignores a signer option">
    <label>What you found</label>
    <textarea id="f_body" maxlength="4000" placeholder="What happened, what it looked like, and what actually fixed it. Exact strings help more than descriptions.">${esc(e?.body ?? '')}</textarea>
    <p class="hint">Signed by your mask, so your name is on it. Write what would have saved you the afternoon.</p>
    <div class="row"><button class="btn ghost" id="cancel">Cancel</button><button class="btn" id="save">${sheet.mode === 'add' ? 'Publish' : 'Save'}</button></div>
  </div></div>`;
}

async function act(fn: () => Promise<{ ok: boolean; why?: string }>, good: string) {
  flash = { text: 'Signing…' }; render();
  const r = await fn();
  flash = r.ok ? { text: good } : { text: r.why ?? 'Failed', bad: true };
  await refresh();
}

function wire() {
  const q = document.getElementById('q') as HTMLInputElement | null;
  q?.addEventListener('input', () => {
    const pos = q.selectionStart; query = q.value; render();
    const n = document.getElementById('q') as HTMLInputElement; n.focus(); n.setSelectionRange(pos ?? 0, pos ?? 0);
  });
  document.getElementById('dismiss')?.addEventListener('click', () => { flash = null; render(); });
  document.getElementById('retry')?.addEventListener('click', () => { void refresh(); });
  app.querySelectorAll<HTMLElement>('[data-topic]').forEach((b) =>
    b.addEventListener('click', () => { topic = b.dataset.topic!; render(); scrollTo({ top: 0 }); }));
  app.querySelectorAll<HTMLElement>('.note').forEach((n) => n.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('button, a, code')) return;
    const id = Number(n.dataset.id);
    open.has(id) ? open.delete(id) : open.add(id);
    render();
  }));
  app.querySelectorAll<HTMLElement>('[data-vote]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = Number(b.dataset.vote);
    const e = ALL.find((x) => x.id === id);
    if (e?.didVote) { flash = { text: 'You have already marked this one useful.' }; return render(); }
    if (e) { e.didVote = true; e.votes += 1; render(); }   // move now, reconcile after
    act(() => voteNote(id), 'Thanks — noted.');
  }));
  app.querySelectorAll<HTMLElement>('[data-edit]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation(); sheet = { mode: 'edit', entry: ALL.find((x) => x.id === Number(b.dataset.edit)) }; render();
  }));
  app.querySelectorAll<HTMLElement>('[data-retract]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = Number(b.dataset.retract);
    if (!confirm('Retract this note? It stops showing for everyone. Do this when it turns out to be wrong — leaving it up is worse.')) return;
    act(() => retractNote(id), 'Retracted.');
  }));
  document.getElementById('add')?.addEventListener('click', () => { sheet = { mode: 'add' }; render(); });
  document.getElementById('cancel')?.addEventListener('click', () => { sheet = null; render(); });
  document.getElementById('scrim')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('scrim')) { sheet = null; render(); }
  });
  document.getElementById('save')?.addEventListener('click', () => {
    const g = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement)?.value ?? '';
    const [tag, title, body] = [g('f_tag'), g('f_title'), g('f_body')];
    if (!title.trim() || !body.trim()) { flash = { text: 'A title and a body, both.', bad: true }; return render(); }
    const s = sheet!;
    sheet = null;
    act(async () => {
      const r = s.mode === 'add' ? await addNote(ME!.mask, tag, title, body) : await editNote(s.entry!.id, tag, title, body);
      if (r.ok) forgetBylines();
      return r;
    }, s.mode === 'add' ? 'Published on chain.' : 'Corrected.');
  });
}

async function refresh() {
  busy = true; loadError = ''; render();
  ALL = await load((soFar) => { ALL = soFar; render(); }).catch((e) => {
    // The failure used to be swallowed, which left an empty page and no way to
    // tell a wiki with nothing in it from a chain that never answered.
    loadError = String(e?.message ?? e).slice(0, 140) || 'The chain did not answer.';
    return ALL;
  });
  busy = false;
  render();
}

addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet) { sheet = null; render(); } });

/* --------------------------------------------------------------------- boot */
render();
warmUp();
(async () => {
  ME = await me().catch(() => null);
  await refresh();
})();
