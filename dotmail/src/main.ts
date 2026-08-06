/**
 * dotmail — mail with no server, no provider, and no envelope that names its
 * recipient.
 *
 * The shape is the one everybody already knows: folders down the left, a list
 * in the middle, a letter on the right. What is different is underneath, and
 * the interface's second job is to never let somebody believe a stronger claim
 * than the true one. So the store says whether it is the chain or this browser,
 * Trash says that a chain does not forget, and the scan says how far it got.
 */
import { mailbox, hex, type Mailbox } from './keys.ts';
import { LocalStore, setFlag, hasFlag, type MailStore } from './store.ts';
import { ContractStore } from './chainstore.ts';
import { seal, sealedSize, SLOTS, type Letter } from './seal.ts';
import { scan, threads, type Received } from './inbox.ts';
import { icon, logo } from './icons.ts';
import {
  shrink, split, join, newGroup, dataUrl, humanSize,
  type Attachment, type Part,
} from './attach.ts';
import { inbox as jmapInbox, allowHost, type JmapConfig, type ClassicMail } from './jmap.ts';
import {
  keyForName, keyForHandle, looksLikeKey, looksLikeName, looksLikeHandle, keyFromHex,
  publishCommand, publishKeyToName, publishKeyToMask, accountForHandle, myMask,
} from './names.ts';
import './style.css';

const MAX_SEALED = 16_000;

type Folder = 'inbox' | 'starred' | 'sent' | 'archive' | 'trash' | 'classic';

const FOLDERS: { id: Folder; label: string; icon: string }[] = [
  { id: 'inbox', label: 'Inbox', icon: icon.inbox },
  { id: 'starred', label: 'Starred', icon: icon.star },
  { id: 'sent', label: 'Sent', icon: icon.sent },
  { id: 'archive', label: 'Archive', icon: icon.archive },
  { id: 'trash', label: 'Trash', icon: icon.trash },
];

let BOX: Mailbox | null = null;
let STORE: MailStore = new LocalStore();
let LETTERS: Received[] = [];
/** Slices of pictures, by group, gathered by the same scan that finds letters. */
let PARTS = new Map<string, Part[]>();

/* Ordinary email, kept deliberately apart from everything above. Different
   state, different folder, different colour on screen: these arrived through a
   provider that read them, and nothing here changes that. */
let CLASSIC: ClassicMail[] = [];
let classicCfg: JmapConfig | null = null;
let classicErr: { why: string; at: string } | null = null;
let classicOpen: string | null = null;
const CLASSIC_KEY = 'dotmail.jmap';
/** Pictures waiting on the composer, already shrunk so the cost is knowable. */
let pending: { name: string; type: string; bytes: Uint8Array; url: string }[] = [];
let scannedTo = 0;
let complete = true;

let folder: Folder = 'inbox';
let openId: number | null = null;
let composing = false;
let showMailbox = false;
let query = '';
let busy = '';
let flash: { text: string; bad?: boolean } | null = null;
let draft = { to: '', subject: '', body: '', replyTo: undefined as number | undefined };

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const when = (t: number) => {
  const d = new Date(t * 1000);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase();

/** A stable colour per correspondent. Same name, same hue, every session, so
 *  the eye learns who is who before it reads the row. */
function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
const avatar = (name: string, cls = '') =>
  `<span class="av ${cls}" style="--h:${hue(name)}">${esc(initial(name))}</span>`;

/* ---------------------------------------------------------------- filtering */

/** Which letters belong in a folder. Trash and Archive win over everything,
 *  the way they do in every mail client, or a trashed letter keeps reappearing
 *  in Inbox and the button looks broken. */
function inFolder(l: Received, f: Folder): boolean {
  const trashed = hasFlag(l.id, 'trash');
  const archived = hasFlag(l.id, 'archive');
  if (f === 'trash') return trashed;
  if (trashed) return false;
  if (f === 'archive') return archived;
  if (f === 'starred') return hasFlag(l.id, 'star') && !archived;
  if (archived) return false;
  if (f === 'sent') return l.outgoing;
  return !l.outgoing;                       // inbox
}

function visible(): Received[][] {
  const q = query.trim().toLowerCase();
  const pool = LETTERS.filter((l) => inFolder(l, folder)).filter((l) =>
    !q || l.subject.toLowerCase().includes(q) || l.body.toLowerCase().includes(q)
    || l.from.toLowerCase().includes(q) || l.to.toLowerCase().includes(q));
  return threads(pool);
}

const unread = (f: Folder) =>
  LETTERS.filter((l) => inFolder(l, f) && !hasFlag(l.id, 'read')).length;

/* -------------------------------------------------------------------- views */

function sidebar(): string {
  return `
  <aside class="side">
    <button class="compose" id="compose" title="Write a letter">
      ${icon.compose}<span class="fl">Compose</span>
    </button>
    <nav>
      ${FOLDERS.map((f) => {
        const n = f.id === 'inbox' || f.id === 'starred' ? unread(f.id) : 0;
        return `<button class="navbtn ${folder === f.id && !showMailbox ? 'on' : ''}"
                        data-folder="${f.id}" title="${f.label}">
          ${f.icon}<span class="fl">${f.label}</span>
          ${n ? `<span class="badge">${n}</span>` : ''}
        </button>`;
      }).join('')}
    </nav>
    <!-- Below the rule, and in its own colour. Ordinary email is a different
         promise from the folders above it, so it does not sit in the same list
         looking like one more of them. -->
    <div class="classicnav">
      <p class="navhead">Ordinary email</p>
      <button class="navbtn plain ${folder === 'classic' && !showMailbox ? 'on' : ''}"
              data-folder="classic" title="Ordinary email, not sealed">
        ${icon.inbox}<span class="fl">${classicCfg ? esc(classicCfg.email) : 'Not connected'}</span>
        ${CLASSIC.filter((m) => !m.seen).length ? `<span class="badge plain">${CLASSIC.filter((m) => !m.seen).length}</span>` : ''}
      </button>
    </div>
    <button class="navbtn mbx ${showMailbox ? 'on' : ''}" id="mailboxbtn" title="Your mailbox">
      ${icon.key}<span class="fl">Your mailbox</span>
    </button>
  </aside>`;
}

/** Ordinary email. Its own list, its own banner, never dressed as a sealed one. */
function classicPane(): string {
  if (!classicCfg) {
    return `<div class="list empty">
      <h2>Connect an ordinary mailbox</h2>
      <p class="dim">Read your existing email here too, over JMAP, with no server of ours in
      between. Fastmail speaks it; many hosts do not yet.</p>
      <label class="lbl">Server</label>
      <input id="jhost" placeholder="api.fastmail.com" autocomplete="off">
      <label class="lbl">Your address</label>
      <input id="jmail" placeholder="you@example.com" autocomplete="off">
      <label class="lbl">App password</label>
      <input id="jtok" type="password" placeholder="Not your account password" autocomplete="off">
      <div class="rfoot"><button class="btn solid" id="jsave">Connect</button></div>
      <div class="note warn">${icon.shield}<div><strong>These letters are not sealed.</strong>
      They came through a provider that read them and sit on a server that can read them still.
      Nothing dotmail does changes that, which is why they live in their own place with their own
      colour. The password is kept on this device and is as safe as the device, no safer.</div></div>
    </div>`;
  }
  if (classicErr) {
    return `<div class="list empty">
      <h2>Could not read that mailbox</h2>
      <p class="bad">${esc(classicErr.why)}</p>
      <p class="dim small">Asked: <code>${esc(classicErr.at)}</code></p>
      <div class="rfoot">
        <button class="btn solid" id="jretry">Try again</button>
        <button class="btn" id="jforget">Forget this mailbox</button>
      </div>
    </div>`;
  }
  if (!CLASSIC.length) {
    return `<div class="list empty"><h2>Nothing here yet</h2>
      <p class="dim">Connected to ${esc(classicCfg.email)}.</p>
      <div class="rfoot"><button class="btn" id="jretry">Fetch</button>
      <button class="btn" id="jforget">Forget this mailbox</button></div></div>`;
  }
  return `<div class="list">
    ${CLASSIC.map((m) => `
      <div class="rowitem plainrow ${m.seen ? '' : 'unread'} ${classicOpen === m.id ? 'sel' : ''}"
           data-classic="${esc(m.id)}">
        <span class="star ghost">${m.hasAttachments ? icon.archive : ''}</span>
        ${avatar(m.from)}
        <span class="who">${esc(m.from)}</span>
        <span class="subj">${esc(m.subject) || '(no subject)'}<span class="prev"> &mdash; ${esc(m.preview.slice(0, 120))}</span></span>
        <span class="when">${when(m.receivedAt)}</span>
      </div>`).join('')}
  </div>`;
}

function classicReader(): string {
  const m = CLASSIC.find((x) => x.id === classicOpen);
  if (!m) {
    return `<div class="reader blank"><div class="blankinner">${logo(46)}
      <p>Ordinary email.</p><p class="small">Not sealed, and not private from the provider it came through.</p>
    </div></div>`;
  }
  return `<div class="reader">
    <div class="plainbar">${icon.shield} Ordinary email. Not sealed, and readable by the server it came from.</div>
    <div class="rtop">
      <h1>${esc(m.subject) || '(no subject)'}</h1>
      <div class="racts"><button class="ib" id="closer" title="Close">${icon.close}</button></div>
    </div>
    <article class="msg">
      <div class="mhead">${avatar(m.from)}
        <div><div class="mwho">${esc(m.from)}</div>
        <div class="mmeta">to ${esc(m.to) || 'you'} &middot; ${when(m.receivedAt)}</div></div>
      </div>
      <div class="mbody">${esc(m.body).replace(/\n/g, '<br>')}</div>
    </article>
  </div>`;
}

function listPane(): string {
  const groups = visible();
  if (!groups.length) {
    const label = FOLDERS.find((f) => f.id === folder)?.label ?? '';
    return `<div class="list empty">
      <h2>Nothing in ${label}</h2>
      <p class="dim">${scannedTo.toLocaleString('en')} envelope${scannedTo === 1 ? '' : 's'} scanned.</p>
      <p class="dim small">No envelope names its recipient, so finding yours means trying each
      one. That is the cost of nobody being able to see who writes to you.</p>
    </div>`;
  }
  return `<div class="list">
    ${groups.map((g) => {
      const l = g[g.length - 1];
      const isRead = hasFlag(l.id, 'read');
      const who = folder === 'sent' ? (l.to || 'unknown') : (l.from || 'unknown');
      const shown = folder === 'sent' ? `To ${who}` : who;
      return `<div class="rowitem ${isRead ? '' : 'unread'} ${openId === l.id ? 'sel' : ''}" data-open="${l.id}">
        <button class="star ${hasFlag(l.id, 'star') ? 'on' : ''}" data-star="${l.id}"
                aria-label="${hasFlag(l.id, 'star') ? 'Remove star' : 'Star'}">${icon.star}</button>
        ${avatar(who)}
        <span class="who">${esc(shown)}${g.length > 1 ? ` <em>${g.length}</em>` : ''}</span>
        <span class="subj">${esc(l.subject) || '(no subject)'}<span class="prev"> &mdash; ${esc(l.body.slice(0, 120))}</span></span>
        <span class="when">${when(l.receivedAt)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/**
 * Pictures on a letter, reassembled from the slices the scan set aside.
 *
 * A missing slice is stated rather than papered over: showing four fifths of a
 * photograph as though it were the photograph is the kind of quiet wrongness
 * this whole app is written against.
 */
function attachmentsView(l: Received): string {
  if (!l.attachments?.length) return '';
  return `<div class="atts">${l.attachments.map((a: Attachment) => {
    const have = PARTS.get(a.group) ?? [];
    const bytes = join(have);
    if (!bytes) {
      return `<div class="att missing">
        ${icon.archive}
        <div><strong>${esc(a.name)}</strong>
        <span class="dim small">${have.length} of ${a.parts} pieces arrived, so it cannot be put back together yet.</span></div>
      </div>`;
    }
    return `<figure class="att">
      <img src="${dataUrl(bytes, a.type)}" alt="${esc(a.name)}" loading="lazy">
      <figcaption>${esc(a.name)} &middot; ${humanSize(bytes.length)} &middot; ${a.parts} envelope${a.parts === 1 ? '' : 's'}</figcaption>
    </figure>`;
  }).join('')}</div>`;
}

function readerPane(): string {
  if (openId === null) {
    return `<div class="reader blank"><div class="blankinner">
      ${logo(46)}
      <p>Pick a letter.</p>
      <p class="small">Nothing on this chain records that any of them were for you.</p>
    </div></div>`;
  }
  const all = LETTERS.filter((l) => l.id === openId || threads(LETTERS).some((g) => g.some((x) => x.id === openId) && g.some((x) => x.id === l.id)));
  const thread = threads(all).find((g) => g.some((x) => x.id === openId)) ?? [];
  const head = thread[0] ?? LETTERS.find((l) => l.id === openId);
  if (!head) return `<div class="reader empty"><p class="dim">Gone.</p></div>`;

  return `<div class="reader">
    <div class="rtop">
      <h1>${esc(head.subject) || '(no subject)'}</h1>
      <div class="racts">
        <button class="ib" id="archive" title="Archive">${icon.archive}</button>
        <button class="ib" id="trash" title="Move to Trash">${icon.trash}</button>
        <button class="ib" id="closer" title="Close">${icon.close}</button>
      </div>
    </div>
    ${thread.map((l) => {
      const who = l.outgoing ? (l.to || 'unknown') : (l.from || 'unknown');
      return `
      <article class="msg">
        <div class="mhead">
          ${avatar(who)}
          <div>
            <div class="mwho">${esc(l.outgoing ? `You &rarr; ${who}` : who)}</div>
            <div class="mmeta">paid by <code>${esc(l.payer)}</code> &middot; ${when(l.receivedAt)}</div>
          </div>
        </div>
        <div class="mbody">${esc(l.body).replace(/\n/g, '<br>')}</div>
        ${attachmentsView(l)}
      </article>`;
    }).join('')}
    <div class="rfoot">
      <button class="btn solid" id="reply">${icon.reply} Reply</button>
      ${folder === 'trash'
        ? `<span class="dim small">Trash hides it here. The envelope stays on the chain, because a chain does not forget.</span>`
        : ''}
    </div>
  </div>`;
}

/** How many transactions this send will actually cost: the letter, plus one
 *  per slice of every picture waiting on it. */
function envelopeCount(): number {
  return 1 + pending.reduce((n, p) => n + Math.ceil(p.bytes.length / 9000), 0);
}

function composeView(): string {
  const size = sealedSize({ from: '', to: draft.to, subject: draft.subject, body: draft.body, sentAt: 0 });
  const over = size > MAX_SEALED;
  return `<div class="composer">
    <div class="chead">${draft.replyTo !== undefined ? 'Reply' : 'New letter'}
      <button class="ib" id="ccancel" title="Discard">${icon.close}</button></div>
    <input id="to" value="${esc(draft.to)}" placeholder="To: alice@dotmailbox.dot, alice.dot, or a 64-character key" autocomplete="off">
    <input id="subject" value="${esc(draft.subject)}" placeholder="Subject (sealed with the body, never on chain)" autocomplete="off">
    <textarea id="body" placeholder="Write.">${esc(draft.body)}</textarea>
    ${pending.length ? `<div class="pend">
      ${pending.map((p, i) => `<div class="pitem">
        <img src="${p.url}" alt="">
        <div class="pinfo"><strong>${esc(p.name)}</strong>
          <span class="dim small">${humanSize(p.bytes.length)} &middot; ${Math.ceil(p.bytes.length / 9000)} envelope${Math.ceil(p.bytes.length / 9000) === 1 ? '' : 's'}</span></div>
        <button class="ib" data-unpend="${i}" title="Remove">${icon.close}</button>
      </div>`).join('')}
      <!-- Said before anything is signed. Five envelopes is five transactions
           and five deposits, and a client that reveals that only when the
           wallet asks the fifth time has lied by omission. -->
      <p class="dim small pcost">${envelopeCount()} envelope${envelopeCount() === 1 ? '' : 's'} in total,
      each one a separate transaction you will be asked to approve.</p>
    </div>` : ''}
    <div class="cfoot">
      <button class="btn solid" id="send" ${over ? 'disabled' : ''}>Seal and send</button>
      <label class="ib attbtn" title="Attach a picture">
        ${icon.archive}<input type="file" id="attach" accept="image/*" multiple hidden>
      </label>
      <span class="dim small ${over ? 'bad' : ''}" id="size">${size.toLocaleString('en')} of ${MAX_SEALED.toLocaleString('en')} bytes</span>
    </div>
  </div>`;
}

let myName = '';
let nameState: { text: string; bad?: boolean } | null = null;
/** `null` while looking, `undefined` when this signer holds no mask. */
let maskState: { mask: number; handle: string } | null | undefined = null;
let maskSaid: { text: string; bad?: boolean } | null = null;
/** Only after the host has actually refused, never as a first offer. */
let nameFallback = false;

function mailboxView(): string {
  if (!BOX) return '<div class="reader"><p class="dim">Deriving…</p></div>';
  return `<div class="reader pane">
    <h1>Your mailbox</h1>
    <p class="dim">Give somebody this key and they can write to you. It is not an
    address: nothing on chain will ever record that a letter was for you.</p>
    <pre class="key" id="mykey">${hex(BOX.pub)}</pre>
    <div class="rfoot">
      <button class="btn solid" id="copykey">Copy key</button>
      <button class="btn" id="publish">Publish it</button>
    </div>
    <div class="note ${BOX.origin === 'host' ? '' : 'warn'}">
      ${icon.shield}<div>${BOX.origin === 'host'
        ? `<strong>Derived from your account.</strong> Sign in on another device and the same
           mailbox comes back. No private key was written down here or anywhere, so there is
           none to steal and none to lose.`
        : `<strong>Trial mailbox.</strong> A plain browser has no host to derive a key from, so
           one was invented and kept here. Open dotmail inside the Polkadot app for a mailbox
           that is actually yours.`}</div>
    </div>
    <h2>Be reachable by name</h2>

    <!-- The mask first, because it is the identity chirp and peoplebook already
         share. Hanging the key off an address instead was the bug: the host
         derives a different address for every app, so before this nobody was
         reachable at all. -->
    ${maskState === undefined ? `
      <p class="dim">You have no mask yet. A mask is the identity chirp and peoplebook already
      share, and claiming one in chirp is what makes you reachable here by the same name.</p>`
      : maskState === null ? '<p class="dim">Looking for your mask…</p>'
      : `<div class="note">${icon.shield}<div>
          <strong>Mask ${maskState.mask}${maskState.handle ? ` &middot; @${esc(maskState.handle)}` : ''}</strong>
          <span class="dim small" style="display:block;margin-top:3px">The same mask chirp and
          peoplebook know you by. Publishing your key against it makes one person one mailbox
          across all three, instead of a different you in each.</span>
        </div></div>
        <div class="rfoot"><button class="btn solid" id="publishmask">Publish against this mask</button></div>`}
    ${maskSaid ? `<p class="${maskSaid.bad ? 'bad' : 'dim'} small">${esc(maskSaid.text)}</p>` : ''}

    <h3>Or under a .dot you own</h3>
    <p class="dim">Publish this key under a <code>.dot</code> you own, and people can write to
    your name instead of sixty-four characters. It costs you nothing in privacy: the key is how
    people reach you, and the chain still records only anonymous envelopes.</p>
    <div class="row2">
      <input id="myname" value="${esc(myName)}" placeholder="you@dotmailbox.dot, or yourname.dot" autocomplete="off">
      <button class="btn solid" id="publishname">Publish</button>
    </div>
    <p class="dim small">Either spelling works. <code>you@dotmailbox.dot</code> and
    <code>you.dotmailbox.dot</code> are the same name: the at sign is how people read an
    address, and a subname is what DotNS already calls it.</p>
    ${nameState ? `<p class="${nameState.bad ? 'bad' : 'dim'} small">${esc(nameState.text)}</p>` : ''}
    ${nameFallback ? `
      <p class="dim small">This host will not let the app sign with your wallet account, and the
      record belongs to whoever owns the name. From a desktop, this is the line:</p>
      <pre class="key" id="pubcmd">${esc(publishCommand(myName || 'yourname.dot', hex(BOX.pub)))}</pre>
      <div class="rfoot"><button class="btn" id="copycmd">Copy the command</button></div>` : ''}

    <h2>People you know</h2>
    <p class="dim small">Kept in this browser and sent nowhere. An address book is a list of
    who you talk to, which is exactly what this app exists not to publish.</p>
    <div class="row2">
      <input id="cname" placeholder="Name" autocomplete="off">
      <input id="ckey" placeholder="Their 64-character public key" autocomplete="off">
      <button class="btn solid" id="addc">Add</button>
    </div>
    <div id="contacts"></div>
  </div>`;
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
  <header class="top">
    <span class="brand">${logo(26)} dotmail</span>
    <span class="searchwrap">
      ${icon.search}
      <input class="search" id="q" value="${esc(query)}"
             placeholder="Search the letters you can already read">
    </span>
    <span class="who-am-i">${BOX ? esc(BOX.origin === 'host' ? 'your account' : 'trial mailbox') : '…'}</span>
  </header>

  <!-- Which store answered. Never a footnote: "on chain" and "in this browser"
       are different promises, and the difference is the whole product. -->
  <div class="where ${STORE.kind}">
    ${STORE.kind === 'chain'
      ? `Letters are on Asset Hub. <span class="dim">${esc(STORE.where)}</span>`
      : `<strong>Local mode.</strong> Letters are in this browser only. Nothing has been sent anywhere.`}
  </div>

  ${busy ? `<div class="busy">${esc(busy)}</div>` : ''}
  ${flash ? `<div class="flash ${flash.bad ? 'bad' : ''}">${esc(flash.text)}</div>` : ''}
  ${!complete ? `<div class="flash bad">The store stopped answering partway through. This is what was read, not the whole of it.</div>` : ''}

  <div class="shell">
    ${sidebar()}
    ${showMailbox ? mailboxView() : folder === 'classic' ? `
      <div class="mid plain ${classicOpen ? 'hasopen' : ''}">${classicPane()}</div>
      ${classicReader()}` : `
      <div class="mid ${openId !== null ? 'hasopen' : ''}">${listPane()}</div>
      ${readerPane()}`}
  </div>
  ${composing ? composeView() : ''}`;
  bind();
}

/* ------------------------------------------------------------------ actions */

async function refresh() {
  if (!BOX) return;
  busy = 'Scanning…';
  render();
  const r = await scan(STORE, BOX, (p) => {
    const el = document.querySelector('.busy');
    if (el) el.textContent = `Scanning ${p.scanned}/${p.total}…`;
  });
  LETTERS = r.letters;
  PARTS = r.parts;
  scannedTo = r.scannedTo;
  complete = r.complete;
  busy = '';
  render();
}

async function doSend() {
  if (!BOX) return;
  const to = (document.getElementById('to') as HTMLInputElement)?.value.trim() ?? '';
  const subject = (document.getElementById('subject') as HTMLInputElement)?.value ?? '';
  const body = (document.getElementById('body') as HTMLTextAreaElement)?.value ?? '';
  if (!to) { flash = { text: 'Who is it for?', bad: true }; return render(); }
  if (!body.trim()) { flash = { text: 'The letter is empty.', bad: true }; return render(); }

  // Three ways to name a recipient, tried in the order that cannot be wrong:
  // a key IS the answer, a .dot name is looked up on chain, anything else is
  // an address the contract might know.
  let pub: Uint8Array | null | undefined;
  if (looksLikeKey(to)) {
    pub = keyFromHex(to);
  } else if (looksLikeName(to)) {
    busy = `Looking up ${to}…`;
    render();
    pub = await keyForName(to);
    busy = '';
  } else if (looksLikeHandle(to)) {
    // Through the MASK, which chirp and peoplebook already agree is the person.
    // Resolving to an address instead was the bug: the address differs per app,
    // so nobody was ever reachable.
    busy = `Looking up @${to}…`;
    render();
    pub = await keyForHandle(to);
    busy = '';
    if (pub === undefined) {
      const account = await accountForHandle(to);
      flash = {
        text: account
          ? `@${to} exists but has not published a mailbox key yet.`
          : `Nobody holds the handle @${to}. Handles are claimed in chirp.`,
        bad: true,
      };
      return render();
    }
  } else {
    pub = await STORE.keyOf(to);
  }
  if (pub === null) {
    flash = { text: `Could not look up "${to}". That is not the same as "no such mailbox" — try again.`, bad: true };
    return render();
  }
  if (pub === undefined) {
    flash = {
      text: looksLikeName(to)
        ? `${to} has no mailbox key published yet. They publish one from their own Mailbox screen.`
        : `No published key for "${to}". They need a mailbox first.`,
      bad: true,
    };
    return render();
  }

  const letter: Letter = {
    from: (await STORE.me()) ?? 'unknown',
    to, subject, body,
    replyTo: draft.replyTo,
    sentAt: Math.floor(Date.now() / 1000),
  };
  draft.to = to; draft.subject = subject; draft.body = body;   // survive a failure
  if (sealedSize(letter) > MAX_SEALED) { flash = { text: 'Too long to seal.', bad: true }; return render(); }

  // Sealed to THEM and to us. The second slot is the only reason Sent can
  // exist: a letter sealed only to its recipient is one its writer can never
  // read again.
  const readers = [pub, BOX.pub];

  // Pictures go FIRST. If a slice fails, the letter never claims an attachment
  // the recipient will never be able to assemble, and the whole send is
  // abandoned with the draft still on screen rather than half-delivered.
  const attachments: Attachment[] = [];
  let sentParts = 0;
  for (const p of pending) {
    const group = newGroup();
    const parts = split(p.bytes, group);
    for (const [i, part] of parts.entries()) {
      busy = `Sending ${p.name}, piece ${i + 1} of ${parts.length}…`;
      render();
      const e = seal(part, readers);
      const r = await STORE.send(e.tags, e.eph, e.sealed);
      if (!r.ok) {
        busy = '';
        flash = {
          text: `${p.name} stopped at piece ${i + 1} of ${parts.length}: ${r.why ?? 'it did not send'}. `
            + `Nothing was claimed in a letter, so nobody is waiting on a picture that will not arrive.`,
          bad: true,
        };
        return render();
      }
      sentParts++;
    }
    attachments.push({ name: p.name, type: p.type, size: p.bytes.length, group, parts: parts.length });
  }
  if (attachments.length) letter.attachments = attachments;

  busy = 'Sealing the letter…';
  render();
  const env = seal(letter, readers);
  const r = await STORE.send(env.tags, env.eph, env.sealed);
  busy = '';
  flash = r.ok
    ? {
      text: (STORE.kind === 'chain' ? 'Sealed and on chain.' : 'Sealed and stored locally.')
        + (sentParts ? ` ${sentParts + 1} envelopes in all.` : ''),
    }
    : { text: r.why ?? 'It did not send.', bad: true };
  if (r.ok) {
    draft = { to: '', subject: '', body: '', replyTo: undefined };
    pending = [];
    composing = false;
    await refresh();
  } else render();
}

function bind() {
  document.querySelectorAll<HTMLElement>('[data-folder]').forEach((b) =>
    b.addEventListener('click', () => {
      folder = b.dataset.folder as Folder;
      openId = null; classicOpen = null; showMailbox = false; flash = null;
      render();
      if (folder === 'classic' && classicCfg && !CLASSIC.length && !classicErr) void fetchClassic();
    }));

  document.querySelectorAll<HTMLElement>('[data-classic]').forEach((r) =>
    r.addEventListener('click', () => { classicOpen = r.dataset.classic ?? null; render(); }));

  document.getElementById('jsave')?.addEventListener('click', async () => {
    const host = (document.getElementById('jhost') as HTMLInputElement)?.value.trim() ?? '';
    const email = (document.getElementById('jmail') as HTMLInputElement)?.value.trim() ?? '';
    const token = (document.getElementById('jtok') as HTMLInputElement)?.value ?? '';
    if (!host || !email || !token) { flash = { text: 'Server, address and app password, please.', bad: true }; return render(); }
    classicCfg = { host: host.replace(/^https?:\/\//, '').replace(/\/+$/, ''), email, token };
    await (await storeForClassic()).set(JSON.stringify(classicCfg));
    await fetchClassic();
  });

  document.getElementById('jretry')?.addEventListener('click', () => void fetchClassic());

  document.getElementById('jforget')?.addEventListener('click', async () => {
    classicCfg = null; CLASSIC = []; classicErr = null; classicOpen = null;
    await (await storeForClassic()).set('');
    flash = { text: 'Forgotten on this device. Nothing was ever sent anywhere else.' };
    render();
  });

  document.getElementById('mailboxbtn')?.addEventListener('click', () => {
    showMailbox = true; openId = null; render(); void showContacts(); void findMask();
  });

  document.querySelectorAll<HTMLElement>('[data-open]').forEach((r) =>
    r.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.star) return;   // the star is its own control
      openId = Number(r.dataset.open);
      setFlag(openId, 'read', true);
      render();
    }));

  document.querySelectorAll<HTMLElement>('[data-star]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(b.dataset.star);
      setFlag(id, 'star', !hasFlag(id, 'star'));
      render();
    }));

  document.getElementById('closer')?.addEventListener('click', () => {
    openId = null; classicOpen = null; render();
  });

  document.getElementById('archive')?.addEventListener('click', () => {
    if (openId === null) return;
    setFlag(openId, 'archive', !hasFlag(openId, 'archive'));
    flash = { text: 'Archived here. The envelope is untouched on the chain.' };
    openId = null; render();
  });

  document.getElementById('trash')?.addEventListener('click', () => {
    if (openId === null) return;
    setFlag(openId, 'trash', true);
    flash = { text: 'Moved to Trash in this app. The envelope stays on the chain, which does not forget.' };
    openId = null; render();
  });

  document.getElementById('compose')?.addEventListener('click', () => {
    draft = { to: '', subject: '', body: '', replyTo: undefined };
    composing = true; render();
  });
  document.getElementById('ccancel')?.addEventListener('click', () => { composing = false; render(); });
  document.getElementById('send')?.addEventListener('click', () => void doSend());

  document.getElementById('reply')?.addEventListener('click', () => {
    const l = LETTERS.find((x) => x.id === openId);
    if (!l) return;
    draft = {
      to: l.outgoing ? l.to : l.from,
      subject: l.subject.startsWith('Re: ') ? l.subject : `Re: ${l.subject}`,
      body: '',
      replyTo: l.id,
    };
    composing = true; render();
  });

  const q = document.getElementById('q') as HTMLInputElement | null;
  q?.addEventListener('input', () => {
    query = q.value;
    const mid = document.querySelector('.mid');
    if (mid) mid.innerHTML = listPane();
    bind();
  });

  /* Pictures. The chooser is offered, and PASTING works too, because next door
     in chirp the file chooser turned out to open nothing at all inside the app
     while paste needed neither a chooser nor a permission. */
  const takeFiles = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith('image/'));
    if (!pics.length) return;
    busy = `Shrinking ${pics.length} picture${pics.length === 1 ? '' : 's'}…`;
    render();
    for (const f of pics) {
      try {
        const s = await shrink(f);
        pending.push({ name: f.name || 'picture.webp', type: s.type, bytes: s.bytes, url: dataUrl(s.bytes, s.type) });
      } catch (e) {
        flash = { text: `${f.name}: ${(e as Error).message}`, bad: true };
      }
    }
    busy = '';
    render();
  };

  (document.getElementById('attach') as HTMLInputElement | null)
    ?.addEventListener('change', (e) => void takeFiles([...((e.target as HTMLInputElement).files ?? [])]));

  document.querySelectorAll<HTMLElement>('[data-unpend]').forEach((b) =>
    b.addEventListener('click', () => {
      pending.splice(Number(b.dataset.unpend), 1);
      render();
    }));

  const body = document.getElementById('body') as HTMLTextAreaElement | null;
  body?.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((i) => i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter(Boolean) as File[];
    if (files.length) { e.preventDefault(); void takeFiles(files); }
  });
  body?.addEventListener('input', () => {
    draft.body = body.value;
    draft.subject = (document.getElementById('subject') as HTMLInputElement)?.value ?? '';
    draft.to = (document.getElementById('to') as HTMLInputElement)?.value ?? '';
    const size = sealedSize({ from: '', to: draft.to, subject: draft.subject, body: draft.body, sentAt: 0 });
    const el = document.getElementById('size');
    if (el) {
      el.textContent = `${size.toLocaleString('en')} of ${MAX_SEALED.toLocaleString('en')} bytes`;
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

  document.getElementById('publishmask')?.addEventListener('click', async () => {
    if (!BOX || !maskState) return;
    busy = `Publishing your key against mask ${maskState.mask}…`;
    maskSaid = null;
    render();
    const r = await publishKeyToMask(maskState.mask, hex(BOX.pub));
    busy = '';
    maskSaid = r.ok
      ? {
        text: maskState.handle
          ? `Done, and read back from the chain. People can write to @${maskState.handle} now.`
          : 'Done, and read back from the chain. Claim a handle in chirp and that name will reach you here.',
      }
      : { text: r.why, bad: true };
    render();
  });

  document.getElementById('publishname')?.addEventListener('click', async () => {
    if (!BOX) return;
    const name = (document.getElementById('myname') as HTMLInputElement)?.value.trim() ?? '';
    myName = name;
    if (!looksLikeName(name)) {
      nameState = { text: 'A name like alice.dot, please.', bad: true };
      return render();
    }
    busy = `Publishing your key under ${name}…`;
    nameState = null;
    render();
    const r = await publishKeyToName(name, hex(BOX.pub));
    busy = '';
    if (r.ok) {
      nameState = { text: `Done. People can write to ${name} now, and the record reads back from the chain.` };
      nameFallback = false;
    } else {
      nameState = { text: r.why, bad: true };
      // The command is offered ONLY once the host has actually refused. Leading
      // with it told a phone user to open a terminal they do not have.
      nameFallback = r.hostCannot;
    }
    render();
  });

  const nameInput = document.getElementById('myname') as HTMLInputElement | null;
  nameInput?.addEventListener('input', () => { myName = nameInput.value; });

  document.getElementById('copycmd')?.addEventListener('click', async () => {
    const cmd = document.getElementById('pubcmd')?.textContent ?? '';
    try { await navigator.clipboard.writeText(cmd); flash = { text: 'Command copied.' }; }
    catch { flash = { text: 'Could not reach the clipboard. The command is on screen.', bad: true }; }
    render();
  });

  document.getElementById('publish')?.addEventListener('click', async () => {
    if (!BOX) return;
    busy = 'Publishing…'; render();
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
    render(); void showContacts();
  });
}

/* ------------------------------------------------------------ classic mail */

async function storeForClassic() {
  const h = await import('@parity/product-sdk-host').catch(() => null);
  try {
    const s = h && (await h.getHostLocalStorage());
    if (s) return { get: () => s.readString(CLASSIC_KEY), set: (v: string) => s.writeString(CLASSIC_KEY, v) };
  } catch { /* fall through */ }
  return {
    get: async () => localStorage.getItem(CLASSIC_KEY) ?? '',
    set: async (v: string) => { localStorage.setItem(CLASSIC_KEY, v); },
  };
}

async function loadClassicConfig() {
  try {
    const raw = await (await storeForClassic()).get();
    classicCfg = raw ? (JSON.parse(raw) as JmapConfig) : null;
  } catch { classicCfg = null; }
}

async function fetchClassic() {
  if (!classicCfg) return;
  busy = `Reading ${classicCfg.email}…`;
  classicErr = null;
  render();
  const granted = await allowHost(classicCfg.host);
  if (!granted) {
    busy = '';
    classicErr = { why: 'the container would not allow a request to that host', at: classicCfg.host };
    return render();
  }
  const r = await jmapInbox(classicCfg);
  busy = '';
  if (r.ok) { CLASSIC = r.value; classicErr = null; }
  else { CLASSIC = []; classicErr = { why: r.why, at: r.at }; }
  render();
}

/** Find the mask this signer owns, once, when the Mailbox screen is opened. */
async function findMask() {
  if (maskState !== null) return;                  // already looked
  const me = await STORE.me();
  if (!me) { maskState = undefined; return render(); }
  maskState = await myMask(me);
  render();
}

async function showContacts() {
  const el = document.getElementById('contacts');
  if (!el || !(STORE instanceof LocalStore)) return;
  const people = await STORE.contacts();
  el.innerHTML = people.length
    ? `<ul class="chips">${people.map((p) =>
        `<li title="${esc(p.key)}">${avatar(p.name)}${esc(p.name)}</li>`).join('')}</ul>`
    : '<p class="dim small">Nobody yet.</p>';
}

/* --------------------------------------------------------------------- boot */

(async () => {
  render();
  BOX = await mailbox();

  // The chain if this context can actually READ it, this browser otherwise.
  // Tested by attempting a read rather than by asking whether a signer exists:
  // the gateway hands out a session with a signer and a provider that cannot
  // read a thing, and believing the signer there cost a day next door.
  const onChain = await ContractStore.open();
  if (onChain) STORE = onChain;

  await STORE.setKey(BOX.pub);
  await loadClassicConfig();
  console.info(`dotmail: ${SLOTS} slots, key from ${BOX.origin}, store ${STORE.kind}`);
  render();
  await refresh();
})();
