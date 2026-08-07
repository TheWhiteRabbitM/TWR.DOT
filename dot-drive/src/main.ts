/**
 * dot-drive — big files, sealed, handed to a person.
 *
 * WHAT IT IS FOR
 *   dotmail seals attachments into the letter itself, in slices of 9000 bytes,
 *   one transaction per slice, and refuses any image that will not compress
 *   under 90 kB. Measured: a 400 kB file is 45 transactions and 45 wallet
 *   prompts, and a PDF is not possible at all. The same 400 kB through Bulletin
 *   is ONE upload, costs no chain storage, and was proved end to end before a
 *   line of this interface was written.
 *
 * THE HONEST PART, WHICH THE NAME WORKS AGAINST
 *   A thing called a drive sounds permanent. Bulletin's `RetentionPeriod` reads
 *   201600 blocks, which at six seconds a block is FOURTEEN DAYS. So the expiry
 *   is not a footnote here: it is a column, it is on every row, and a file past
 *   it is reported as gone rather than shown as a link that fails when clicked.
 */
import { cloud, expiresAt, type Ready } from './cloud.ts';
import {
  sealBytes, openBytes, sealedSize, timeLeft, isExpired, humanSize,
  MAX_CHUNK, type Stored,
} from './file.ts';
import { list, remember, forget, markSent, type Mine } from './mine.ts';
import { sendFile } from './send.ts';
import { mailbox } from './keys.ts';
import { myMask, walletAddress } from './names.ts';
import { icon, logo } from './icons.ts';
import './style.css';

/* ------------------------------------------------------------------- state */

let ready: Ready | null = null;
let FILES: Mine[] = [];
let busy = '';
let flash: { text: string; bad?: boolean } | null = null;
/** Who we are, for the `from` line on a letter. A handle if there is one. */
let me = '';
/** The file picked but not yet sent, and who it is being sent to. */
let sending: Mine | null = null;
let sendTo = '';
let sendNote = '';
/** The open-by-hand panel, for a key that arrived some other way. */
let opening = false;
let openCid = '';
let openKey = '';

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dateOf = (ms: number) =>
  new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/* -------------------------------------------------------------------- views */

function banner(): string {
  if (!ready) return `<div class="where">Looking for the host…</div>`;
  if (ready.kind === 'ready') {
    return `<div class="where chain">Files go to Bulletin. <span class="dim">Encrypted here, before they leave.</span></div>`;
  }
  if (ready.kind === 'nohost') {
    return `<div class="where">
      <strong>No host here.</strong> Bulletin storage is reachable only from inside the
      Polkadot app, for reads as well as writes. Nothing on this page can upload or fetch
      from a plain browser, and pretending otherwise would waste your file.
    </div>`;
  }
  return `<div class="where"><strong>The host would not come up.</strong>
    <span class="dim">${esc(ready.why)}</span></div>`;
}

function uploader(): string {
  const usable = ready?.kind === 'ready';
  return `<section class="card up">
    <h2>Put a file up</h2>
    <p class="dim small">It is encrypted on this device with a key that never goes to
    Bulletin. What is stored there is ciphertext nobody can read and nothing points at.</p>
    <label class="drop ${usable ? '' : 'off'}">
      ${icon.upload}
      <span>${usable ? 'Choose a file' : 'Not available outside the Polkadot app'}</span>
      <input type="file" id="pick" ${usable ? '' : 'disabled'} hidden>
    </label>
    <p class="dim small">Up to ${humanSize(MAX_CHUNK)} in one piece. Every file expires
    fourteen days after it goes up, which is how long Bulletin keeps it.</p>
  </section>`;
}

function row(f: Mine): string {
  const dead = isExpired(f);
  return `<div class="frow ${dead ? 'dead' : ''}">
    <span class="fic">${icon.file}</span>
    <div class="fmain">
      <div class="fname">${esc(f.name)}</div>
      <div class="fmeta dim">
        ${humanSize(f.size)}
        &middot; <span class="${dead ? 'bad' : ''}">${dead ? `expired ${dateOf(f.expires)}` : timeLeft(f.expires)}</span>
        ${f.sentTo ? ` &middot; sent to ${esc(f.sentTo)}` : ''}
      </div>
    </div>
    <div class="facts">
      ${dead ? '' : `<button class="ib" data-send="${esc(f.cid)}" title="Send to somebody">${icon.send}</button>`}
      ${dead ? '' : `<button class="ib" data-get="${esc(f.cid)}" title="Download">${icon.download}</button>`}
      <button class="ib" data-forget="${esc(f.cid)}" title="Forget this file">${icon.trash}</button>
    </div>
  </div>`;
}

function mineView(): string {
  if (!FILES.length) {
    return `<section class="card">
      <h2>Your files</h2>
      <p class="dim">Nothing up yet.</p>
      <p class="dim small">This list lives on this device and nowhere else. Writing
      "this account owns this CID" anywhere public would hand an observer the one link
      the design exists to withhold, so a new device starts empty and a key you did not
      keep is a file you cannot open, even though the bytes are still there.</p>
    </section>`;
  }
  const live = FILES.filter((f) => !isExpired(f)).length;
  return `<section class="card">
    <h2>Your files</h2>
    <p class="dim small">${live} of ${FILES.length} still retrievable.</p>
    <div class="flist">${FILES.map(row).join('')}</div>
  </section>`;
}

function sendView(): string {
  if (!sending) return '';
  return `<div class="sheet">
    <div class="sheetin">
      <div class="shead">Send ${esc(sending.name)}
        <button class="ib" id="scancel" title="Close">${icon.close}</button></div>
      <p class="dim small">The letter carries the pointer and the key, sealed to them.
      The envelope names nobody, which is the only reason the file on Bulletin stays
      unattributable.</p>
      <label class="lbl">To</label>
      <input id="sto" value="${esc(sendTo)}" placeholder="a chirp handle, a .dot name, or a 64-character key" autocomplete="off">
      <label class="lbl">A line with it, if you like</label>
      <textarea id="snote" rows="3" placeholder="Optional.">${esc(sendNote)}</textarea>
      <div class="srow">
        <button class="btn solid" id="sgo">${icon.send} Seal and send</button>
        <span class="dim small">One transaction.</span>
      </div>
    </div>
  </div>`;
}

function openView(): string {
  if (!opening) return '';
  return `<div class="sheet">
    <div class="sheetin">
      <div class="shead">Open a file by hand
        <button class="ib" id="ocancel" title="Close">${icon.close}</button></div>
      <p class="dim small">For a pointer and key that reached you some other way. Both
      are needed: the pointer alone fetches bytes that will not open.</p>
      <label class="lbl">Pointer (CID)</label>
      <input id="ocid" value="${esc(openCid)}" placeholder="bafy…" autocomplete="off" spellcheck="false">
      <label class="lbl">Key</label>
      <input id="okey" value="${esc(openKey)}" placeholder="64 hex characters" autocomplete="off" spellcheck="false">
      <div class="srow"><button class="btn solid" id="ogo">${icon.download} Fetch and open</button></div>
    </div>
  </div>`;
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
  <header class="top">
    <span class="brand">${logo(26)} dot-drive</span>
    <span class="grow"></span>
    <button class="btn" id="openbyhand">${icon.lock} Open by hand</button>
  </header>
  ${banner()}
  ${busy ? `<div class="busy">${esc(busy)}</div>` : ''}
  ${flash ? `<div class="flash ${flash.bad ? 'bad' : ''}">${esc(flash.text)}</div>` : ''}
  <main>
    ${uploader()}
    ${mineView()}
    <section class="card note">
      ${icon.clock}
      <div><strong>Fourteen days, then gone.</strong> Read off the Bulletin chain, not
      assumed: <code>RetentionPeriod</code> is 201600 blocks. A file here is a way to hand
      somebody something, not a place to keep it.</div>
    </section>
  </main>
  ${sendView()}
  ${openView()}`;
  bind();
}

/* ------------------------------------------------------------------ actions */

async function refresh() {
  FILES = await list();
  render();
}

async function doUpload(file: File) {
  const r = ready;
  if (r?.kind !== 'ready') return;

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sealedSize(bytes.length) > MAX_CHUNK) {
    flash = {
      text: `${file.name} is ${humanSize(bytes.length)}, and one piece can hold ${humanSize(MAX_CHUNK)}.`,
      bad: true,
    };
    return render();
  }

  busy = `Sealing ${file.name}…`;
  render();
  const { blob, key } = sealBytes(bytes);

  busy = `Sending ${humanSize(blob.length)} to Bulletin…`;
  render();
  const up = await r.cloud.upload(blob);
  busy = '';
  if (!up.ok) { flash = { text: up.why, bad: true }; return render(); }

  const f: Stored = {
    kind: 'file',
    cid: up.cid,
    key,
    name: file.name || 'file',
    type: file.type || 'application/octet-stream',
    size: bytes.length,
    expires: expiresAt(),
    sentAt: Math.floor(Date.now() / 1000),
  };
  await remember(f);
  flash = { text: `${f.name} is up. It expires ${dateOf(f.expires)}.` };
  await refresh();
}

/** Fetch, decrypt, and hand the bytes to the browser as a download. */
async function doDownload(f: Mine) {
  const r = ready;
  if (r?.kind !== 'ready') {
    flash = { text: 'Fetching needs the host too, not just uploading.', bad: true };
    return render();
  }
  busy = `Fetching ${f.name}…`;
  render();
  const blob = await r.cloud.fetch(f.cid);
  busy = '';
  if (!blob) {
    flash = {
      text: isExpired(f)
        ? `${f.name} expired on ${dateOf(f.expires)} and the bytes are gone.`
        : `Bulletin did not return ${f.name}. That is not the same as it being gone — try again.`,
      bad: true,
    };
    return render();
  }
  const plain = openBytes(blob, f.key);
  if (!plain) {
    flash = { text: 'The bytes came back but the key did not open them.', bad: true };
    return render();
  }
  save(plain, f.name, f.type);
  flash = { text: `${f.name} decrypted, ${humanSize(plain.length)}.` };
  render();
}

function save(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function doSend() {
  if (!sending) return;
  const to = (document.getElementById('sto') as HTMLInputElement)?.value.trim() ?? '';
  const note = (document.getElementById('snote') as HTMLTextAreaElement)?.value ?? '';
  sendTo = to; sendNote = note;
  busy = `Looking up ${to || 'them'}…`;
  render();
  const r = await sendFile(to, sending, note, me);
  busy = '';
  if (!r.ok) { flash = { text: r.why, bad: true }; return render(); }
  await markSent(sending.cid, to);
  flash = { text: `Sent to ${to}. They open it in dot-drive from the letter.` };
  sending = null; sendTo = ''; sendNote = '';
  await refresh();
}

async function doOpenByHand() {
  const r = ready;
  const cid = (document.getElementById('ocid') as HTMLInputElement)?.value.trim() ?? '';
  const key = (document.getElementById('okey') as HTMLInputElement)?.value.trim() ?? '';
  openCid = cid; openKey = key;
  if (!cid || !/^[0-9a-f]{64}$/i.test(key.replace(/^0x/i, ''))) {
    flash = { text: 'A pointer and a 64-character key, please.', bad: true };
    return render();
  }
  if (r?.kind !== 'ready') { flash = { text: 'Fetching needs the host.', bad: true }; return render(); }

  busy = 'Fetching…';
  render();
  const blob = await r.cloud.fetch(cid);
  busy = '';
  if (!blob) { flash = { text: 'Nothing came back for that pointer.', bad: true }; return render(); }
  const plain = openBytes(blob, key);
  if (!plain) { flash = { text: 'The bytes came back but that key does not open them.', bad: true }; return render(); }
  save(plain, 'dot-drive-file', 'application/octet-stream');
  flash = { text: `Opened, ${humanSize(plain.length)}.` };
  opening = false;
  render();
}

/* --------------------------------------------------------------------- bind
 *
 * Attach at most once per element per event. A full render replaces every
 * node, so a fresh one binds normally and a survivor is skipped. dotmail's
 * search box doubled its listener count on every keystroke without this.
 */
type Marked = Element & { _bound?: Set<string> };
function on(el: Element | null, type: string, fn: (e: Event) => void) {
  if (!el) return;
  const seen = ((el as Marked)._bound ??= new Set<string>());
  if (seen.has(type)) return;
  seen.add(type);
  el.addEventListener(type, fn);
}
const onAll = (sel: string, type: string, fn: (el: HTMLElement) => void) =>
  document.querySelectorAll<HTMLElement>(sel).forEach((el) => on(el, type, () => fn(el)));
const byId = (id: string) => document.getElementById(id);

function bind() {
  on(byId('pick'), 'change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void doUpload(f);
  });
  on(byId('openbyhand'), 'click', () => { opening = true; render(); });
  on(byId('ocancel'), 'click', () => { opening = false; render(); });
  on(byId('ogo'), 'click', () => void doOpenByHand());

  onAll('[data-send]', 'click', (b) => {
    sending = FILES.find((f) => f.cid === b.dataset.send) ?? null;
    render();
  });
  onAll('[data-get]', 'click', (b) => {
    const f = FILES.find((x) => x.cid === b.dataset.get);
    if (f) void doDownload(f);
  });
  onAll('[data-forget]', 'click', (b) => {
    const cid = b.dataset.forget ?? '';
    void (async () => {
      await forget(cid);
      flash = { text: 'Forgotten here. The bytes stay on Bulletin until they expire.' };
      await refresh();
    })();
  });
  on(byId('scancel'), 'click', () => { sending = null; render(); });
  on(byId('sgo'), 'click', () => void doSend());
  on(byId('sto'), 'input', (e) => { sendTo = (e.target as HTMLInputElement).value; });
  on(byId('snote'), 'input', (e) => { sendNote = (e.target as HTMLTextAreaElement).value; });
  on(byId('ocid'), 'input', (e) => { openCid = (e.target as HTMLInputElement).value; });
  on(byId('okey'), 'input', (e) => { openKey = (e.target as HTMLInputElement).value; });
}

/* --------------------------------------------------------------------- boot */

async function boot() {
  render();
  FILES = await list();
  render();

  ready = await cloud();
  render();

  // The name on a letter, resolved once. Falls back to the address, and then
  // to nothing, because a letter signed "undefined" is worse than an unsigned one.
  try {
    await mailbox();
    const addr = await walletAddress();
    if (addr) {
      const m = await myMask(addr);
      me = (m && 'handle' in m ? m.handle : '') || addr;
    }
  } catch { /* the letter goes out unsigned rather than wrong */ }
  render();
}

void boot();
