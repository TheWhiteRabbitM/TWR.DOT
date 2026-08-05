/**
 * dotmail — mail with no server, no provider, and no visible recipient.
 *
 * The interface has one job beyond showing letters: never let somebody believe
 * a stronger claim than the one that is true. So the store says whether it is
 * the chain or this browser, the sender name says whether it was verified or
 * merely claimed, and the scan says how far it got.
 */
import { mailbox, hex, type Mailbox } from './keys.ts';
import { LocalStore, type MailStore } from './store.ts';
import { seal, sealedSize, type Letter } from './seal.ts';
import { scan, threads, type Received } from './inbox.ts';
import './style.css';

const MAX_SEALED = 16_000;

let BOX: Mailbox | null = null;
let STORE: MailStore = new LocalStore();
let LETTERS: Received[] = [];
let scannedTo = 0;
let view: 'inbox' | 'compose' | 'identity' = 'inbox';
let openId: number | null = null;
let busy = '';
let flash: { text: string; bad?: boolean } | null = null;
let draft = { to: '', subject: '', body: '', replyTo: undefined as number | undefined };

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(t * 1000).toLocaleDateString();
};

const short = (s: string) => (s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);

/* ------------------------------------------------------------------ views */

function identityView(): string {
  if (!BOX) return '<p class="dim">Deriving your mailbox…</p>';
  return `
  <section>
    <h1>Your mailbox</h1>
    <p class="lede">Give somebody this key and they can write to you. It is not
    an address: nothing on chain will ever record that a letter was for you.</p>

    <label class="lbl">Your public key</label>
    <pre class="key" id="mykey">${hex(BOX.pub)}</pre>
    <div class="row">
      <button class="btn solid" id="copykey">Copy</button>
      <button class="btn" id="publish">Publish it so people can find you</button>
    </div>

    <div class="note ${BOX.origin === 'host' ? '' : 'warn'}">
      ${BOX.origin === 'host'
        ? `<strong>Derived from your account.</strong> Sign in on another device and the
           same mailbox comes back. Nothing was written down, here or anywhere, so there
           is no private key to steal and none to lose.`
        : `<strong>This is a trial mailbox.</strong> There is no host to derive a key from
           in a plain browser, so one was invented and kept in this browser. It is for
           trying the app. Open dotmail inside the Polkadot app for a mailbox that is
           actually yours.`}
    </div>

    <h2>Add someone</h2>
    <p class="dim">Paste a public key and a name to remember it by. Stored in this
    browser, never sent anywhere: an address book is a list of who you talk to, and
    that is precisely what this app exists not to publish.</p>
    <div class="row">
      <input id="cname" placeholder="alice" autocomplete="off">
      <input id="ckey" placeholder="their 64-character public key" autocomplete="off">
      <button class="btn solid" id="addc">Add</button>
    </div>
    <div id="contacts"></div>
  </section>`;
}

function letterView(l: Received): string {
  const from = l.fromVerified === true
    ? `<span class="ok" title="This name really is owned by the account that paid">${esc(l.from)} ✓</span>`
    : l.fromVerified === false
      ? `<span class="bad" title="The claimed name is not owned by the paying account">${esc(l.from)} (unverified claim)</span>`
      : `<span title="Ownership could not be checked">${esc(l.from || 'unknown')}</span>`;
  return `
  <article class="letter">
    <button class="btn small" id="back">Back</button>
    <h1>${esc(l.subject) || '<span class="dim">No subject</span>'}</h1>
    <p class="meta">From ${from} · paid by <code>${esc(short(l.payer))}</code> · ${ago(l.receivedAt)}</p>
    <div class="body">${esc(l.body).replace(/\n/g, '<br>')}</div>
    <div class="row">
      <button class="btn solid" id="reply">Reply</button>
    </div>
  </article>`;
}

function inboxView(): string {
  if (openId !== null) {
    const l = LETTERS.find((x) => x.id === openId);
    if (l) return letterView(l);
  }
  const groups = threads(LETTERS);
  if (!groups.length) {
    return `
    <section>
      <h1>Inbox</h1>
      <p class="lede">Nothing yet.</p>
      <p class="dim">Scanned ${scannedTo} envelope${scannedTo === 1 ? '' : 's'}. Because no
      envelope names its recipient, finding yours means trying each one; that is the cost
      of nobody being able to see who writes to you.</p>
    </section>`;
  }
  return `
  <section>
    <h1>Inbox</h1>
    <p class="dim">${LETTERS.length} letter${LETTERS.length === 1 ? '' : 's'} ·
    ${scannedTo} envelope${scannedTo === 1 ? '' : 's'} scanned</p>
    <ul class="list">
      ${groups.map((g) => {
        const l = g[g.length - 1];
        return `<li><button data-open="${l.id}">
          <span class="lfrom">${esc(l.from || 'unknown')}${g.length > 1 ? ` <em>(${g.length})</em>` : ''}</span>
          <span class="lsub">${esc(l.subject) || 'No subject'}</span>
          <span class="lprev">${esc(l.body.slice(0, 90))}</span>
          <span class="ltime">${ago(l.receivedAt)}</span>
        </button></li>`;
      }).join('')}
    </ul>
  </section>`;
}

function composeView(): string {
  const size = sealedSize({ from: '', subject: draft.subject, body: draft.body, sentAt: 0 });
  const over = size > MAX_SEALED;
  return `
  <section>
    <h1>${draft.replyTo !== undefined ? 'Reply' : 'Write'}</h1>
    <label class="lbl">To</label>
    <input id="to" value="${esc(draft.to)}" placeholder="a name from your address book, or a 64-character key" autocomplete="off">
    <label class="lbl">Subject</label>
    <input id="subject" value="${esc(draft.subject)}" placeholder="Sealed with the body, never on chain" autocomplete="off">
    <label class="lbl">Letter</label>
    <textarea id="body" rows="12" placeholder="Write.">${esc(draft.body)}</textarea>
    <p class="dim small ${over ? 'bad' : ''}">${size.toLocaleString('en')} bytes sealed
      ${over ? `— over the ${MAX_SEALED.toLocaleString('en')} byte limit, shorten it` : `of ${MAX_SEALED.toLocaleString('en')}`}</p>
    <div class="row">
      <button class="btn solid" id="send" ${over ? 'disabled' : ''}>Seal and send</button>
      <button class="btn" id="cancel">Cancel</button>
    </div>
  </section>`;
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
  <header class="top">
    <span class="brand"><span class="mark"></span> dotmail</span>
    <nav>
      <button data-view="inbox" class="${view === 'inbox' ? 'on' : ''}">Inbox</button>
      <button data-view="compose" class="${view === 'compose' ? 'on' : ''}">Write</button>
      <button data-view="identity" class="${view === 'identity' ? 'on' : ''}">Mailbox</button>
    </nav>
  </header>

  <!-- Which store answered. Never a footnote: "on chain" and "in this browser"
       are different promises and the difference is the whole product. -->
  <div class="where ${STORE.kind}">
    ${STORE.kind === 'chain'
      ? 'Letters are on Asset Hub.'
      : '<strong>Local mode.</strong> Letters are in this browser only. Nothing has been sent anywhere.'}
    <span class="dim">${esc(STORE.where)}</span>
  </div>

  ${busy ? `<p class="busy">${esc(busy)}</p>` : ''}
  ${flash ? `<p class="flash ${flash.bad ? 'bad' : ''}">${esc(flash.text)}</p>` : ''}

  <main>${view === 'inbox' ? inboxView() : view === 'compose' ? composeView() : identityView()}</main>`;
  bind();
}

/* ----------------------------------------------------------------- actions */

async function refresh() {
  if (!BOX) return;
  busy = 'Scanning…';
  render();
  const r = await scan(STORE, BOX, 0, (p) => {
    busy = `Scanning ${p.scanned}/${p.total}…`;
    // Repainting on every page would fight the scan for the main thread; the
    // text is updated in place instead.
    const el = document.querySelector('.busy');
    if (el) el.textContent = busy;
  });
  LETTERS = r.letters;
  scannedTo = r.scannedTo;
  busy = '';
  if (!r.complete) flash = { text: 'The store stopped answering partway through. This is what was read, not the whole of it.', bad: true };
  render();
}

async function doSend() {
  if (!BOX) return;
  const to = (document.getElementById('to') as HTMLInputElement)?.value.trim() ?? '';
  const subject = (document.getElementById('subject') as HTMLInputElement)?.value ?? '';
  const body = (document.getElementById('body') as HTMLTextAreaElement)?.value ?? '';
  if (!to) { flash = { text: 'Who is it for?', bad: true }; return render(); }
  if (!body.trim()) { flash = { text: 'The letter is empty.', bad: true }; return render(); }

  let pub: Uint8Array | null | undefined;
  if (/^[0-9a-f]{64}$/i.test(to)) {
    pub = new Uint8Array((to.match(/../g) ?? []).map((b) => parseInt(b, 16)));
  } else {
    pub = await STORE.keyOf(to);
  }
  if (pub === null) { flash = { text: 'Could not look that up. Not the same as "no such mailbox" — try again.', bad: true }; return render(); }
  if (pub === undefined) { flash = { text: `No published key for "${to}". They need a mailbox before they can be written to.`, bad: true }; return render(); }

  const letter: Letter = {
    from: (await STORE.me()) ?? 'unknown',
    subject, body,
    replyTo: draft.replyTo,
    sentAt: Math.floor(Date.now() / 1000),
  };
  if (sealedSize(letter) > MAX_SEALED) { flash = { text: 'Too long to seal.', bad: true }; return render(); }

  busy = 'Sealing and sending…';
  render();
  const e = seal(letter, pub);
  const r = await STORE.send(e.tag, e.eph, e.sealed);
  busy = '';
  flash = r.ok
    ? { text: STORE.kind === 'chain' ? 'Sealed and on chain.' : 'Sealed and stored locally.' }
    : { text: r.why ?? 'It did not send.', bad: true };
  if (r.ok) { draft = { to: '', subject: '', body: '', replyTo: undefined }; view = 'inbox'; await refresh(); }
  else render();
}

function bind() {
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view as typeof view;
      openId = null;
      flash = null;
      render();
    }));

  document.querySelectorAll<HTMLElement>('[data-open]').forEach((b) =>
    b.addEventListener('click', () => { openId = Number(b.dataset.open); render(); }));

  document.getElementById('back')?.addEventListener('click', () => { openId = null; render(); });

  document.getElementById('reply')?.addEventListener('click', () => {
    const l = LETTERS.find((x) => x.id === openId);
    if (!l) return;
    draft = {
      to: l.from,
      subject: l.subject.startsWith('Re: ') ? l.subject : `Re: ${l.subject}`,
      body: '',
      replyTo: l.id,
    };
    view = 'compose';
    openId = null;
    render();
  });

  document.getElementById('send')?.addEventListener('click', () => void doSend());
  document.getElementById('cancel')?.addEventListener('click', () => {
    draft = { to: '', subject: '', body: '', replyTo: undefined };
    view = 'inbox';
    render();
  });

  // Keep the size counter honest as you type, without a full repaint.
  const body = document.getElementById('body') as HTMLTextAreaElement | null;
  body?.addEventListener('input', () => {
    draft.body = body.value;
    draft.subject = (document.getElementById('subject') as HTMLInputElement)?.value ?? '';
    const size = sealedSize({ from: '', subject: draft.subject, body: draft.body, sentAt: 0 });
    const el = document.querySelector('.small');
    if (el) {
      el.textContent = `${size.toLocaleString('en')} bytes sealed ${size > MAX_SEALED
        ? `— over the ${MAX_SEALED.toLocaleString('en')} byte limit, shorten it`
        : `of ${MAX_SEALED.toLocaleString('en')}`}`;
      el.classList.toggle('bad', size > MAX_SEALED);
    }
    const btn = document.getElementById('send') as HTMLButtonElement | null;
    if (btn) btn.disabled = size > MAX_SEALED;
  });

  document.getElementById('copykey')?.addEventListener('click', async () => {
    if (!BOX) return;
    try { await navigator.clipboard.writeText(hex(BOX.pub)); flash = { text: 'Key copied.' }; }
    catch { flash = { text: 'Could not reach the clipboard. The key is on screen to copy by hand.', bad: true }; }
    render();
  });

  document.getElementById('publish')?.addEventListener('click', async () => {
    if (!BOX) return;
    busy = 'Publishing your key…';
    render();
    const r = await STORE.setKey(BOX.pub);
    busy = '';
    flash = r.ok ? { text: 'Key published. People can write to you now.' } : { text: r.why ?? 'It did not publish.', bad: true };
    render();
  });

  document.getElementById('addc')?.addEventListener('click', async () => {
    const name = (document.getElementById('cname') as HTMLInputElement)?.value.trim() ?? '';
    const key = (document.getElementById('ckey') as HTMLInputElement)?.value.trim() ?? '';
    if (!name || !/^[0-9a-f]{64}$/i.test(key)) {
      flash = { text: 'A name and a 64-character hex key, please.', bad: true };
      return render();
    }
    if (STORE instanceof LocalStore) {
      await STORE.addContact(name, new Uint8Array((key.match(/../g) ?? []).map((b) => parseInt(b, 16))));
      flash = { text: `${name} added.` };
    }
    render();
    void showContacts();
  });

  void showContacts();
}

async function showContacts() {
  const el = document.getElementById('contacts');
  if (!el || !(STORE instanceof LocalStore)) return;
  const names = await STORE.contacts();
  el.innerHTML = names.length
    ? `<ul class="chips">${names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '<p class="dim small">Nobody yet.</p>';
}

/* -------------------------------------------------------------------- boot */

(async () => {
  render();
  BOX = await mailbox();
  await STORE.setKey(BOX.pub);         // so this browser can write to itself
  render();
  await refresh();
})();
