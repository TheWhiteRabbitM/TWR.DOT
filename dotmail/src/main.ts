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
  walletAddress, maskForHandle,
} from './names.ts';
import { whoIs, checkSender, nameNow, shortAddr, type Verdict } from './who.ts';
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

/* ------------------------------------------------------------------ senders
 *
 * The name on a letter is written by whoever sent it. The account that paid is
 * written by the chain. Those are not the same kind of thing and this app had
 * been showing them as though they were: the claim large, the fact small and
 * grey underneath.
 *
 * So each letter gets looked up once — who the payer is, and whether they hold
 * the name the letter is signed with — and the answer is cached by letter id.
 * The lookups are chain reads, so they cannot happen during a render; they run
 * after, and re-render only if something actually changed. Re-rendering on
 * every resolved letter would redraw the list forty times on a first scan.
 */
const SENDER = new Map<number, Verdict>();
/** How many times a letter has been looked up and taught us nothing. Without
 *  this, a chain that is simply unreachable makes every render fire sixty
 *  reads that will fail, for as long as the app is open. */
const tries = new Map<number, number>();
const GIVE_UP_AFTER = 3;
let resolving = false;

async function resolveSenders() {
  if (resolving) return;
  resolving = true;
  try {
    // Only what is on screen. Resolving a thousand letters to draw twenty is
    // the sort of politeness the chain does not thank you for.
    const shown = visible().flat().slice(0, 60);
    let learned = false;

    for (const l of shown) {
      if (l.outgoing) continue;                     // our own; nothing to check
      if (SENDER.has(l.id)) continue;
      const n = tries.get(l.id) ?? 0;
      if (n >= GIVE_UP_AFTER) continue;
      tries.set(l.id, n + 1);

      // Who paid, so a sender with no handle still gets a name rather than hex.
      const who = await whoIs(l.payer);
      const verdict = await checkSender(l.from, l.payer);

      // `unchecked` is not an answer, it is the absence of one, so it is not
      // stored: the next pass tries again rather than freezing a node hiccup
      // into a permanent shrug. But it does not count as having LEARNED
      // anything either, and saying it did is what made every render schedule
      // another one.
      if (verdict.kind !== 'unchecked') { SENDER.set(l.id, verdict); learned = true; }
      if (who.kind === 'person') learned = true;
    }
    if (learned) render();
  } finally {
    resolving = false;
  }
}

/** What to print where a name goes. Never forty-two characters, and never
 *  sixty-four: `shortAddr` shortens keys as well as addresses. */
const senderName = (l: Received) =>
  l.outgoing ? (shortAddr(l.to) || 'unknown') : nameNow(l.from, l.payer);

/**
 * The line under the name, which is where the actual FACT goes.
 *
 * The address is shown short with the whole thing on hover, because a reader
 * who wants to compare two payers can, and one who does not should not have to
 * read forty-two characters to get to the date.
 */
function senderLine(l: Received): string {
  if (l.outgoing) return `paid by you`;
  const v = SENDER.get(l.id);
  const paid = `paid by <code title="${esc(l.payer)}">${esc(shortAddr(l.payer))}</code>`;

  if (v?.kind === 'held') {
    return `<span class="ok">${paid}, who holds this handle</span>`;
  }
  if (v?.kind === 'selfaddressed') {
    return `<span class="ok">${paid}, and signed with that same account</span>`;
  }
  if (v?.kind === 'mismatch') {
    const real = v.realHolder
      ? `, and <code title="${esc(v.realHolder)}">${esc(shortAddr(v.realHolder))}</code> is who holds that name`
      : '';
    return `<span class="no">${paid}, which does not hold the name on this letter${real}</span>`;
  }
  return paid;
}

/**
 * The mark beside a sender.
 *
 * Green only when the chain confirmed the payer holds that name. A letter with
 * no mark is not accused of anything: most letters simply carry a name nobody
 * registered, and that is normal rather than suspicious.
 */
function senderMark(l: Received): string {
  const v = SENDER.get(l.id);
  if (!v) return '';
  if (v.kind === 'held') {
    return `<span class="vmark ok" title="The account that paid for this letter holds this handle in chirp's registry.">${icon.shield}</span>`;
  }
  // The name IS the paying account. Trivially true, and true is true: the
  // person reading has as much assurance here as with a registered handle.
  if (v.kind === 'selfaddressed') {
    return `<span class="vmark ok" title="This letter is signed with the account that paid for it.">${icon.shield}</span>`;
  }
  if (v.kind === 'mismatch') {
    return `<span class="vmark no" title="This letter is signed with a name the paying account does not hold.">${icon.warn}</span>`;
  }
  return '';
}

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

/**
 * Why this folder is empty, said accurately.
 *
 * It used to print "3,477 envelopes scanned" under every empty folder, which
 * reads as the REASON the folder is empty and almost never was. Starred is
 * empty because you have not starred anything. Trash is empty because you have
 * not binned anything. Neither has the faintest connection to how many
 * envelopes were opened, and putting the number there invited the reader to
 * conclude that a mailbox full of letters had come up with nothing.
 *
 * The scan is a real explanation in exactly two cases: no letters were found
 * at all, or the scan stopped early. So it is said in those two cases and
 * nowhere else.
 */
function whyEmpty(): string {
  const found = LETTERS.length;
  const q = query.trim();

  if (q) return `<p class="dim">Nothing here matches “${esc(q)}”.</p>`;

  if (found > 0) {
    // Letters exist; this particular folder just has none of them.
    const said: Partial<Record<Folder, string>> = {
      starred: 'Nothing starred yet. The star on a row puts it here.',
      archive: 'Nothing archived yet.',
      trash: 'Nothing in the bin.',
      sent: 'You have not sent anything from this mailbox yet.',
      inbox: 'Nothing waiting. Everything you can read is filed elsewhere.',
    };
    return `<p class="dim">${said[folder] ?? 'Nothing here.'}</p>`;
  }

  // Genuinely nothing found. NOW the scan is the explanation.
  if (!complete) {
    return `<p class="dim">The store stopped answering after ${scannedTo.toLocaleString('en')}
      envelope${scannedTo === 1 ? '' : 's'}, so this is not a finished search.</p>
      <p class="dim small">There may be letters for you further along that were never reached.</p>`;
  }
  return `<p class="dim">${scannedTo.toLocaleString('en')} envelope${scannedTo === 1 ? '' : 's'}
    tried, and none of them were for you.</p>
    <p class="dim small">No envelope names its recipient, so finding yours means trying each
    one. That is the cost of nobody being able to see who writes to you.</p>`;
}

function listPane(): string {
  const groups = visible();
  if (!groups.length) {
    const label = FOLDERS.find((f) => f.id === folder)?.label ?? '';
    return `<div class="list empty">
      <h2>Nothing in ${label}</h2>
      ${whyEmpty()}
    </div>`;
  }
  return `<div class="list">
    ${groups.map((g) => {
      const l = g[g.length - 1];
      const isRead = hasFlag(l.id, 'read');
      const who = senderName(l);
      const shown = folder === 'sent' ? `To ${who}` : who;
      return `<div class="rowitem ${isRead ? '' : 'unread'} ${openId === l.id ? 'sel' : ''}" data-open="${l.id}">
        <button class="star ${hasFlag(l.id, 'star') ? 'on' : ''}" data-star="${l.id}"
                aria-label="${hasFlag(l.id, 'star') ? 'Remove star' : 'Star'}">${icon.star}</button>
        ${avatar(who)}
        <span class="who">${esc(shown)}${senderMark(l)}${g.length > 1 ? ` <em>${g.length}</em>` : ''}</span>
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

/**
 * The whole conversation the open letter belongs to, across folders.
 *
 * Grouped from ALL letters, not from the current folder, so opening a received
 * letter still shows the replies you sent. It was written as a filter that
 * called `threads(LETTERS)` again for every letter in the mailbox, which is the
 * same grouping recomputed n times to produce the one answer it already had.
 */
function openThread(): Received[] {
  if (openId === null) return [];
  return threads(LETTERS).find((g) => g.some((x) => x.id === openId)) ?? [];
}
const openThreadIds = () => {
  const ids = openThread().map((l) => l.id);
  return ids.length ? ids : openId === null ? [] : [openId];
};

function readerPane(): string {
  if (openId === null) {
    return `<div class="reader blank"><div class="blankinner">
      ${logo(46)}
      <p>Pick a letter.</p>
      <p class="small">Nothing on this chain records that any of them were for you.</p>
    </div></div>`;
  }
  const thread = openThread();
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
      const who = senderName(l);
      // `esc` on a string containing `&rarr;` printed the entity itself. The
      // arrow is ours, not the sender's, so it goes in AFTER escaping.
      const line = l.outgoing ? `You &rarr; ${esc(who)}` : esc(who);
      return `
      <article class="msg">
        <div class="mhead">
          ${avatar(who)}
          <div>
            <div class="mwho">${line}${senderMark(l)}</div>
            <div class="mmeta">${senderLine(l)} &middot; ${when(l.receivedAt)}</div>
          </div>
        </div>
        <div class="mbody">${esc(l.body).replace(/\n/g, '<br>')}</div>
        ${attachmentsView(l)}
      </article>`;
    }).join('')}
    <div class="rfoot">
      <button class="btn solid" id="reply">${icon.reply} Reply</button>
      ${folder === 'trash' || folder === 'archive'
        ? `<button class="btn" id="restore">${icon.inbox} Move back to Inbox</button>`
        : ''}
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

/**
 * The size of the letter AS IT WILL BE SENT.
 *
 * The counter used to measure a different letter from the one `doSend` builds:
 * no `from`, no `replyTo`, no attachment list. All three are real bytes inside
 * the seal, so the number under the composer read comfortably under the limit
 * while the send refused with "Too long to seal" and no explanation of the
 * discrepancy. A budget you are shown has to be the budget you are charged.
 */
function draftSize(): number {
  return sealedSize({
    from: myHandleOrAddress(),
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    replyTo: draft.replyTo,
    attachments: pending.map((p) => ({
      name: p.name, type: p.type, size: p.bytes.length,
      group: 'g0000000', parts: Math.ceil(p.bytes.length / 9000),
    })),
    sentAt: Math.floor(Date.now() / 1000),
  });
}

/** Update the counter in place, without redrawing the field being typed in. */
function showSize() {
  const size = draftSize();
  const el = byId('size');
  if (el) {
    el.textContent = `${size.toLocaleString('en')} of ${MAX_SEALED.toLocaleString('en')} bytes`;
    el.classList.toggle('bad', size > MAX_SEALED);
  }
  const btn = byId('send') as HTMLButtonElement | null;
  if (btn) btn.disabled = size > MAX_SEALED;
}

function composeView(): string {
  const size = draftSize();
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
/**
 * Four states, not two. "Still looking" and "could not be read" were both
 * `null`, so a failed lookup rendered as a search that never ended — the exact
 * conflation this app keeps having to unpick.
 */
type MaskState =
  | { kind: 'searching' }
  /** The registry itself would not answer. */
  | { kind: 'failed' }
  /** No wallet account to search under — a different problem, and saying
   *  "could not read the registry" for it sent me looking in the wrong place
   *  for twenty minutes. */
  | { kind: 'nowallet' }
  | { kind: 'none' }
  | { kind: 'nosuchhandle'; handle: string }
  | { kind: 'found'; mask: number; handle: string };
let maskState: MaskState = { kind: 'searching' };
let handleTry = '';
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
    ${maskState.kind === 'searching' ? '<p class="dim">Looking for your mask…</p>'
      : maskState.kind === 'found' ? `<div class="note">${icon.shield}<div>
          <strong>Mask ${maskState.mask}${maskState.handle ? ` &middot; @${esc(maskState.handle)}` : ''}</strong>
          <span class="dim small" style="display:block;margin-top:3px">The same mask chirp and
          peoplebook know you by. Publishing your key against it makes one person one mailbox
          across all three, instead of a different you in each.</span>
        </div></div>
        <div class="rfoot"><button class="btn solid" id="publishmask">Publish against this mask</button></div>`
      : `
        <!-- Ask the person their own name instead of hunting for it. One read
             of the handle registry, no wallet account, no scan: the automatic
             route needs getLegacyAccounts, which this host does not really
             provide, and that is a limitation to state rather than retry. -->
        <p class="dim">${maskState.kind === 'nowallet'
          ? 'This host will not tell the app which wallet account you are using, so your mask cannot be found automatically.'
          : maskState.kind === 'failed'
            ? 'The mask registry did not answer. That is not the same as you not having a mask, so nothing is assumed.'
            : maskState.kind === 'nosuchhandle'
              ? `Nobody holds <strong>@${esc(maskState.handle)}</strong>. Check the spelling, or claim it in chirp.`
              : 'No mask found automatically.'}
        Type the handle you use in chirp and it will be looked up directly.</p>
        <div class="row2">
          <input id="handletry" value="${esc(handleTry)}" placeholder="your chirp handle, e.g. watanabe.01" autocomplete="off">
          <button class="btn solid" id="findbyhandle">Find my mask</button>
        </div>`}
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

  // Names come from the chain, so they cannot be fetched while drawing. This
  // runs after the frame is on screen and re-renders only if it learned
  // something, and it guards against re-entry, so the render it triggers does
  // not trigger another.
  void resolveSenders();
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
    // The HANDLE, which is how people know each other, not the H160, which is
    // how the chain does. `me()` returns the address, and using it put a forty
    // character hex string where a name belongs on every letter sent.
    //
    // It stays a CLAIM either way: the payer is recorded separately and is the
    // fact. But a claim people can read beats a fact nobody can.
    from: myHandleOrAddress(),
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

/**
 * Attach a listener at most once per element per event type.
 *
 * WHY THIS IS NOT PARANOIA
 *   `bind()` runs after every render, and the search box re-renders only the
 *   list and then calls `bind()` again. The header is not part of the list, so
 *   the search input itself was never replaced and collected another `input`
 *   listener each time. Each listener calls `bind()`, so each keystroke DOUBLED
 *   the count: measured 1, 2, 4, 8, 16, 32, 64 new listeners for the first
 *   seven characters. A fifteen character query would attach about thirty two
 *   thousand of them, each redrawing the whole list.
 *
 *   A full render replaces every node, so a fresh node has never been marked
 *   and binds normally. A node that SURVIVED a partial redraw carries its mark
 *   and is skipped. No bookkeeping to keep in step, and no way to forget.
 */
type Marked = Element & { _bound?: Set<string> };
function on(el: Element | null | undefined, type: string, fn: (e: Event) => void) {
  if (!el) return;
  const m = el as Marked;
  const seen = (m._bound ??= new Set<string>());
  if (seen.has(type)) return;
  seen.add(type);
  el.addEventListener(type, fn);
}
const onAll = (sel: string, type: string, fn: (el: HTMLElement, e: Event) => void) =>
  document.querySelectorAll<HTMLElement>(sel).forEach((el) => on(el, type, (e) => fn(el, e)));

const byId = (id: string) => document.getElementById(id);

function bind() {
  onAll('[data-folder]', 'click', (b) => {
    folder = b.dataset.folder as Folder;
    openId = null; classicOpen = null; showMailbox = false; flash = null;
    render();
    if (folder === 'classic' && classicCfg && !CLASSIC.length && !classicErr) void fetchClassic();
  });

  onAll('[data-classic]', 'click', (r) => { classicOpen = r.dataset.classic ?? null; render(); });

  on(byId('jsave'), 'click', async () => {
    const host = (document.getElementById('jhost') as HTMLInputElement)?.value.trim() ?? '';
    const email = (document.getElementById('jmail') as HTMLInputElement)?.value.trim() ?? '';
    const token = (document.getElementById('jtok') as HTMLInputElement)?.value ?? '';
    if (!host || !email || !token) { flash = { text: 'Server, address and app password, please.', bad: true }; return render(); }
    classicCfg = { host: host.replace(/^https?:\/\//, '').replace(/\/+$/, ''), email, token };
    await (await storeForClassic()).set(JSON.stringify(classicCfg));
    await fetchClassic();
  });

  on(byId('jretry'), 'click', () => void fetchClassic());

  on(byId('jforget'), 'click', async () => {
    classicCfg = null; CLASSIC = []; classicErr = null; classicOpen = null;
    await (await storeForClassic()).set('');
    flash = { text: 'Forgotten on this device. Nothing was ever sent anywhere else.' };
    render();
  });

  on(byId('mailboxbtn'), 'click', () => {
    showMailbox = true; openId = null; render(); void showContacts(); void findMask();
  });

  onAll('[data-open]', 'click', (r, e) => {
    if ((e.target as HTMLElement).dataset.star) return;   // the star is its own control
    openId = Number(r.dataset.open);
    setFlag(openId, 'read', true);
    render();
  });

  onAll('[data-star]', 'click', (b, e) => {
    e.stopPropagation();
    const id = Number(b.dataset.star);
    setFlag(id, 'star', !hasFlag(id, 'star'));
    render();
  });

  on(byId('closer'), 'click', () => { openId = null; classicOpen = null; render(); });

  /*
   * Archive and Trash move the WHOLE CONVERSATION, not the one letter that
   * happened to be open. Flagging a single letter left its thread in Inbox
   * minus one message, so archiving a three letter exchange made it come back
   * looking like a two letter one. No mail client has ever worked that way.
   */
  on(byId('archive'), 'click', () => {
    const ids = openThreadIds();
    if (!ids.length) return;
    const turningOn = !hasFlag(ids[0], 'archive');
    for (const id of ids) setFlag(id, 'archive', turningOn);
    flash = { text: turningOn ? 'Archived here. The envelopes are untouched on the chain.' : 'Back in Inbox.' };
    openId = null; render();
  });

  on(byId('trash'), 'click', () => {
    const ids = openThreadIds();
    if (!ids.length) return;
    for (const id of ids) setFlag(id, 'trash', true);
    flash = { text: 'Moved to Trash in this app. The envelopes stay on the chain, which does not forget.' };
    openId = null; render();
  });

  /* Trash was one way: the button set the flag and nothing anywhere cleared
   * it, so a letter binned by mistake was gone from the app for good. */
  on(byId('restore'), 'click', () => {
    const ids = openThreadIds();
    if (!ids.length) return;
    for (const id of ids) { setFlag(id, 'trash', false); setFlag(id, 'archive', false); }
    flash = { text: 'Back where it was.' };
    openId = null; render();
  });

  on(byId('compose'), 'click', () => {
    draft = { to: '', subject: '', body: '', replyTo: undefined };
    composing = true; render();
  });
  on(byId('ccancel'), 'click', () => { composing = false; render(); });
  on(byId('send'), 'click', () => void doSend());

  on(byId('reply'), 'click', () => {
    // The LAST letter in the conversation, not the one that happened to be
    // clicked. Replying to the opening message of a long thread addressed the
    // answer to whoever started it rather than whoever last spoke.
    const thread = openThread();
    const l = thread[thread.length - 1] ?? LETTERS.find((x) => x.id === openId);
    if (!l) return;
    draft = {
      to: l.outgoing ? l.to : l.from,
      subject: l.subject.startsWith('Re: ') ? l.subject : `Re: ${l.subject}`,
      body: '',
      replyTo: l.id,
    };
    composing = true; render();
  });

  const q = byId('q') as HTMLInputElement | null;
  on(q, 'input', () => {
    query = q!.value;
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

  on(byId('attach'), 'change', (e) =>
    void takeFiles([...((e.target as HTMLInputElement).files ?? [])]));

  onAll('[data-unpend]', 'click', (b) => {
    pending.splice(Number(b.dataset.unpend), 1);
    render();
  });

  const body = byId('body') as HTMLTextAreaElement | null;
  on(body, 'paste', (e) => {
    const files = [...((e as ClipboardEvent).clipboardData?.items ?? [])]
      .filter((i) => i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter(Boolean) as File[];
    if (files.length) { e.preventDefault(); void takeFiles(files); }
  });

  /*
   * EVERY field syncs the draft, not just the body.
   *
   * `render()` rebuilds the composer from `draft`, and only the body input
   * wrote to it. So any redraw while writing reset To and Subject to empty:
   * measured, with a folder click standing in for the redraw. It got worse
   * when the sender lookup started re-rendering on its own, which it does a
   * second or two after a scan, exactly while somebody is typing a subject.
   */
  const sync = () => {
    draft.body = (byId('body') as HTMLTextAreaElement | null)?.value ?? draft.body;
    draft.subject = (byId('subject') as HTMLInputElement | null)?.value ?? draft.subject;
    draft.to = (byId('to') as HTMLInputElement | null)?.value ?? draft.to;
    showSize();
  };
  on(body, 'input', sync);
  on(byId('subject'), 'input', sync);
  on(byId('to'), 'input', sync);

  on(byId('copykey'), 'click', async () => {
    if (!BOX) return;
    try { await navigator.clipboard.writeText(hex(BOX.pub)); flash = { text: 'Key copied.' }; }
    catch { flash = { text: 'Could not reach the clipboard. The key is on screen to copy by hand.', bad: true }; }
    render();
  });

  on(byId('retrymask'), 'click', () => void findMask(true));

  const ht = document.getElementById('handletry') as HTMLInputElement | null;
  on(ht, 'input', () => { handleTry = ht!.value; });
  on(ht, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void findByHandle(ht!.value.trim());
  });
  on(byId('findbyhandle'), 'click', () => {
    void findByHandle((document.getElementById('handletry') as HTMLInputElement)?.value.trim() ?? '');
  });

  on(byId('publishmask'), 'click', async () => {
    if (!BOX || maskState.kind !== 'found') return;
    const { mask, handle } = maskState;
    busy = `Publishing your key against mask ${mask}…`;
    maskSaid = null;
    render();
    const r = await publishKeyToMask(mask, hex(BOX.pub));
    busy = '';
    maskSaid = r.ok
      ? {
        text: handle
          ? `Done, and read back from the chain. People can write to @${handle} now.`
          : 'Done, and read back from the chain. Claim a handle in chirp and that name will reach you here.',
      }
      : { text: r.why, bad: true };
    render();
  });

  on(byId('publishname'), 'click', async () => {
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
  on(nameInput, 'input', () => { myName = nameInput!.value; });

  on(byId('copycmd'), 'click', async () => {
    const cmd = document.getElementById('pubcmd')?.textContent ?? '';
    try { await navigator.clipboard.writeText(cmd); flash = { text: 'Command copied.' }; }
    catch { flash = { text: 'Could not reach the clipboard. The command is on screen.', bad: true }; }
    render();
  });

  on(byId('publish'), 'click', async () => {
    if (!BOX) return;
    busy = 'Publishing…'; render();
    const r = await STORE.setKey(BOX.pub);
    busy = '';
    flash = r.ok ? { text: 'Key published. People can write to you now.' } : { text: r.why ?? 'It did not publish.', bad: true };
    render();
  });

  on(byId('addc'), 'click', async () => {
    const name = (document.getElementById('cname') as HTMLInputElement)?.value.trim() ?? '';
    const key = (document.getElementById('ckey') as HTMLInputElement)?.value.trim() ?? '';
    if (!name || !looksLikeKey(key)) {
      flash = { text: 'A name and a 64-character hex key, please.', bad: true };
      return render();
    }
    if (STORE instanceof LocalStore) {
      // keyFromHex, not a hand-rolled split: somebody pasting a key WITH the
      // 0x prefix would otherwise get 33 shifted bytes and a contact nobody
      // could ever write to.
      await STORE.addContact(name, keyFromHex(key));
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

/**
 * The name a letter is signed with.
 *
 * The HANDLE when we know it, because that is how people know each other. It
 * was `STORE.me()` before, which is the H160, so every letter arrived signed
 * with forty characters of hex where a name belongs.
 *
 * It is a CLAIM either way. The payer is recorded separately and is the fact,
 * and the reader shows both. But a claim somebody can read beats a fact nobody
 * can.
 */
function myHandleOrAddress(): string {
  if (maskState.kind === 'found' && maskState.handle) return maskState.handle;
  return myAddress || 'unknown';
}
let myAddress = '';

/**
 * Find the mask, under the WALLET account.
 *
 * Not `STORE.me()`, which is the product account the host derives per app: the
 * mask chirp knows somebody by belongs to the wallet behind both apps, so
 * searching under dotmail's own account could only ever come back empty.
 */
async function findMask(force = false) {
  if (!force && maskState.kind !== 'searching') return;
  maskState = { kind: 'searching' };
  render();

  const wallet = await walletAddress();
  // No wallet is a DIFFERENT problem from a registry that will not answer, and
  // reporting the second for the first sent me looking in the wrong place.
  if (!wallet) { maskState = { kind: 'nowallet' }; return render(); }

  const found = await myMask(wallet);
  maskState = found === null ? { kind: 'failed' }
    : found === undefined ? { kind: 'none' }
    : { kind: 'found', mask: found.mask, handle: found.handle };
  render();
}

/** The reliable route: the person types the name they already know. */
async function findByHandle(handle: string) {
  handleTry = handle;
  if (!looksLikeHandle(handle)) {
    maskSaid = { text: 'A chirp handle, like watanabe.01.', bad: true };
    return render();
  }
  // Said IN the panel, not only in the banner at the top of the screen: on a
  // phone that banner is off-screen while you are reading this section, so the
  // button looked dead while it was working.
  maskSaid = { text: `Looking up @${handle}…` };
  maskState = { kind: 'searching' };
  busy = `Looking up @${handle}…`;
  render();

  const got = await maskForHandle(handle);
  busy = '';
  maskState = got === null ? { kind: 'failed' }
    : got === undefined ? { kind: 'nosuchhandle', handle }
    : { kind: 'found', mask: got.mask, handle };
  maskSaid = got === null
    ? { text: 'The chain did not answer within fifteen seconds. Nothing is assumed from that.', bad: true }
    : got === undefined
      ? { text: `Nobody holds @${handle}.`, bad: true }
      : { text: `Found: mask ${got.mask}.` };
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
  myAddress = (await STORE.me()) ?? '';
  await loadClassicConfig();
  // Look for the mask at BOOT, not only when the Mailbox screen is opened:
  // otherwise the first letter of a session is signed with an address because
  // nobody had been to that screen yet.
  void findMask();
  console.info(`dotmail: ${SLOTS} slots, key from ${BOX.origin}, store ${STORE.kind}`);
  render();
  await refresh();
})();
